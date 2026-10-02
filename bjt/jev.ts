/**
 * Jev, TypeSafe AI's decision model, as an instrument for the difficulty probe.
 *
 * A prototype, used only when `BJT_DIFFICULTY_MODEL` names it (`jev-latest`).
 *
 * Jev writes no text. It is given a state and a question whose answers we name,
 * and it returns a probability for every answer. That is exactly the difficulty
 * probe's question — which of these four is right? — with a better-shaped reply:
 * the probe otherwise asks a small model five times and counts, so its rate can
 * only be 0, 0.2 … 1.0, while one Jev call gives the probability it puts on the key.
 *
 * It is kept to the probe on purpose. The gate, the proofreader, the dedupe check
 * and the discriminator each owe the next draft a sentence saying why, and Jev
 * has no sentences to give; the gate also wants a strong reader, and Jev is built
 * to be fast. And like every model here it runs in the batch job and never while
 * somebody is practising.
 *
 * **The request and the reply.** The shape below is TypeSafe's published
 * example, and the live service answers in it: the first comparison run sent 20
 * questions and got 20 well-formed replies.
 *
 *     POST {config.JEV_URL}   Authorization: Bearer $TYPESAFE_API_KEY
 *     {"model": "jev-latest", "state": "...",
 *      "questions": {"answer": {"type": "choice", "instructions": "...",
 *                               "criteria": {"option_1": "...", ...}}}}
 *     → {"model": "jev-1.13.0",
 *        "answers": {"answer": {"type": "choice", "choice": "option_1",
 *                               "probabilities": {"option_1": 0.88, ...},
 *                               "confidence": 0.81}},
 *        "usage": {"input_tokens": 318, "output_tokens": 34}}
 *
 * So every departure from that shape is an `LLMError`, which the probe reports as
 * unmeasured and never as a rate.
 *
 * **The same ceilings as every other call.** `llm.state.spend.checkCeilings()` runs
 * before the request and the reply is priced into `llm.state.spend` after it, so a run
 * that mixes Jev with the Anthropic models has one bill and one set of limits.
 * Jev bills $0.042 per million input tokens and nothing for output (TypeSafe's
 * usage page), which is its row in `llm.PRICES_USD_PER_MTOK`. A question is about
 * 700 tokens, so a call costs about $0.00003 and rating the whole bank costs well
 * under a cent: the first comparison was 20 calls, 14,040 tokens and $0.0005.
 * A reply that reports no usage is priced on the request's size in bytes, which
 * is more than its size in tokens. The output and effort ceilings have nothing to
 * cap: Jev neither writes nor thinks at length.
 *
 * `choiceProbabilities` is async: it makes the request.
 */
import * as config from "./config.ts";
import * as http from "./http.ts";
import * as llm from "./llm.ts";
import { errText, KeyError, repr, sum, TypeError_, zip } from "./py.ts";
import { dumps, loads } from "./pyjson.ts";

/** The name the one question is sent under, and read back from. */
export const QUESTION = "answer";

export const INSTRUCTIONS = (
  "The state is a question from a business-Japanese proficiency test, with "
  + "everything the candidate sees or hears. Which option is the correct answer?"
);

export function isJev(model: string): boolean {
  return model.startsWith("jev");
}

export function optionKeys(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `option_${i + 1}`);
}

export function requestBody(question: string, options: string[], model: string): Record<string, any> {
  const keys = optionKeys(options.length);
  return {
    model: model,
    state: question,
    questions: { [QUESTION]: {
      type: "choice",
      instructions: INSTRUCTIONS,
      criteria: Object.fromEntries(zip(keys, options, { strict: true })),
    } },
  };
}

/** Python's name for the type of a parsed JSON value, as its errors say it. */
function _typeName(v: unknown): string {
  if (v === null || v === undefined) return "NoneType";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "string") return "str";
  if (Array.isArray(v)) return "list";
  return "dict";
}

/** `container[key]` with a string key, failing as Python's subscript does: a
 *  KeyError for a dict without it, a TypeError for anything that is not a
 *  dict. */
function _subscript(container: unknown, key: string): unknown {
  const kind = _typeName(container);
  if (kind === "dict") {
    const d = container as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(d, key)) throw new KeyError(key);
    return d[key];
  }
  if (kind === "str") throw new TypeError_("string indices must be integers, not 'str'");
  if (kind === "list") throw new TypeError_("list indices must be integers or slices, not str");
  throw new TypeError_(`'${kind}' object is not subscriptable`);
}

/** `repr(exc)` as Python prints the two lookups' errors. */
function _excRepr(e: Error): string {
  const name = e instanceof TypeError_ ? "TypeError" : e.name;
  return `${name}(${repr(e.message)})`;
}

/** The reply's probability for each of our `n` options, in option order.
 *
 *  Renormalised over our options, so a reply that also names an answer we did
 *  not offer (TypeSafe's own example does) still reads as a distribution over
 *  ours. Anything that is not a finite, non-negative number for every option
 *  we sent is an error rather than a guess. */
export function probabilities(reply: unknown, n: number): number[] {
  let raw: unknown[];
  try {
    const probs = _subscript(_subscript(_subscript(reply, "answers"), QUESTION), "probabilities");
    raw = optionKeys(n).map((k) => _subscript(probs, k));
  } catch (e) {
    if (!(e instanceof KeyError || e instanceof TypeError_)) throw e;
    throw new llm.LLMError(`Jev reply has no probability for every option: ${_excRepr(e)}`, { cause: e });
  }
  if (!raw.every((p) => typeof p === "number" && Number.isFinite(p) && p >= 0)) {
    throw new llm.LLMError(`Jev reply has a probability that is not one: ${repr(raw)}`);
  }
  const nums = raw as number[];
  const total = sum(nums);
  if (total <= 0) {
    throw new llm.LLMError("Jev reply puts no probability on any option we sent");
  }
  return nums.map((p) => p / total);
}

/** A whole, non-negative number of tokens, as `isinstance(x, int)` (and not
 *  a bool) and `x >= 0` say it. */
function _isCount(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

/** What the ledger prices, in the shape `llm.priceUsd` reads. */
export function usageOf(reply: unknown, sent: Uint8Array): llm.UsageLike {
  const usage = _typeName(reply) === "dict" ? (reply as Record<string, unknown>)["usage"] ?? null : null;
  if (_typeName(usage) !== "dict") {
    return { input_tokens: sent.length, output_tokens: 0 };
  }
  const u = usage as Record<string, unknown>;
  const tokensIn = u["input_tokens"];
  if (!_isCount(tokensIn)) {
    return { input_tokens: sent.length, output_tokens: 0 };
  }
  let tokensOut = u["output_tokens"];
  if (!_isCount(tokensOut)) {
    tokensOut = 0;
  }
  return { input_tokens: tokensIn, output_tokens: tokensOut as number };
}

/** Python's `json.loads` of bytes: UTF-8, a leading byte-order mark allowed,
 *  anything that does not decode an error. */
const _decoder = new TextDecoder("utf-8", { fatal: true });

/** Ask Jev which option is right; its probability for each, in order. */
export async function choiceProbabilities(
  question: string,
  options: string[],
  opts: { model?: string | null } = {},
): Promise<number[]> {
  const model = opts.model || config.DIFFICULTY_MODEL;
  // Before the call, never after, as in llm._structured.
  llm.state.spend.checkCeilings();
  const key = process.env.TYPESAFE_API_KEY ?? "";
  if (!key) {
    throw new llm.LLMError("TYPESAFE_API_KEY is not set");
  }
  llm.state.spend.beginRequest();
  const data = new TextEncoder().encode(dumps(requestBody(question, options, model), { ensureAscii: false }));
  const headers = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };
  let body: Uint8Array;
  try {
    body = await http.request("POST", config.JEV_URL, { body: data, headers: headers,
                                                        timeout: config.API_TIMEOUT_SECONDS });
  } catch (e) {
    if (!(e instanceof http.RequestFailed)) throw e;
    if (e.status === 402 || llm._BILLING_SIGNS.some((sign) => e.detail.toLowerCase().includes(sign))) {
      throw new llm.LLMBillingError(`Jev request failed: ${errText(e)}`, { cause: e });
    }
    throw new llm.LLMError(`Jev request failed: ${errText(e)}`, { cause: e });
  }

  let reply: unknown;
  try {
    reply = loads(_decoder.decode(body));
  } catch (e) {
    // TextDecoder's refusal of bytes that are not UTF-8 is a TypeError;
    // JSON.parse's of text that is not JSON a SyntaxError.
    if (!(e instanceof SyntaxError || e instanceof TypeError)) throw e;
    // Paid for all the same, so on the bill before the error.
    llm.state.spend.add(model, usageOf({}, data));
    throw new llm.LLMError(`Jev reply was not JSON: ${errText(e)}`, { cause: e });
  }
  llm.state.spend.add(model, usageOf(reply, data));
  return probabilities(reply, options.length);
}
