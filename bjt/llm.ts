/**
 * Thin wrapper over the Anthropic Messages API.
 *
 * Six call shapes are used across the tool:
 *   * generateStructured  — the generators, constrained to an item JSON schema
 *   * sanityCheck         — the proofreader (one flag per rule, on a small model)
 *   * answerChoice        — the answerability gate / calibration (pick 1 of N)
 *   * judgeSynthetic      — the discriminator loop (real vs synthetic + why)
 *   * answerFromImage     — the 画像把握 picture gate (pick 1 of N from a picture)
 *   * reviewSceneImage    — the scene art gate (one flag per rule in the brief)
 *
 * All of them use structured output (`output_config.format`) so we never parse
 * free text. The SDK is the pipeline's one runtime dependency and is imported
 * with this module, but no client is made until the first call, so the offline
 * commands (selftest, checkbatch) run without an API key present.
 *
 * Every call to the API is async: the six call shapes, `_structured`, and the
 * `seams.sleep` between retries.
 */
import { existsSync, readFileSync } from "node:fs";
import Anthropic, { AnthropicError, APIConnectionError, APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import * as config from "./config.ts";
import { unreadable, writeAtomic } from "./files.ts";
import { eprint, errText, fixed, g, get, isDict, KeyError, len, max, OverflowError, repr, RuntimeError, sorted, str, strip, thousands, time, toFloat, toInt, truthy, TypeError_, ValueError } from "./py.ts";
import { dumps, loads } from "./pyjson.ts";

export class LLMError extends RuntimeError {}

/** The account cannot pay for the call. Nothing else will succeed either.
 *
 *  A run that meets this should stop, not carry on through forty more slots
 *  of the same refusal. Raised as its own class so the callers that tolerate
 *  a failed call (one shelf, one probe) can let this one through — and they
 *  must: it is an `LLMError`, so a bare `catch` of `LLMError` swallows it.
 *  Every tolerant catch site lets `LLMBillingError` through first. */
export class LLMBillingError extends LLMError {}

export const _BILLING_SIGNS: readonly string[] = ["credit balance", "insufficient_quota", "billing"];

/** The reply stopped at its token ceiling (or the model's context) before
 *  it was finished. Paid for, and not an answer: a judge's reply cut off
 *  mid-thought is a trial that got no answer, never a wrong one, and a draft
 *  cut off mid-item is a generation that failed. Its own class so the log
 *  says which, and so the ceiling that caused it can be looked at. */
export class LLMTruncatedError extends LLMError {}

/** stop_reason values that mean the reply was cut off rather than finished. */
export const _TRUNCATED: readonly string[] = ["max_tokens", "model_context_window_exceeded"];

/** This process has spent what it was allowed to. Raised *before* the
 *  call that would go over: a request is refused unless what has been spent
 *  plus the most that request can cost fits under the ceiling, so a run never
 *  ends above it (from 2026-10-06, when a night ended at $0.54 of $0.50, the
 *  last response no longer counts as free). A subclass of the billing error on purpose: every caller that
 *  stops for an empty account stops for this too, keeping what it wrote. */
export class LLMSpendLimitError extends LLMBillingError {}

// ----- the spend ledger --------------------------------------------------
//
// Dollars per million tokens (input, output), by model name prefix, as each
// provider's price list has them; the longest prefix that matches wins, so
// `claude-opus-5-5` is not priced as `claude-opus-5` and `claude-sonnet-4-6`
// is not priced as the Sonnet 5 family. Cache writes cost a quarter more than
// plain input and cache reads a tenth of it (a few newer models read the cache
// for less; a tenth over-prices them, which is the safe side). A model not in
// the table is priced at UNKNOWN_MODEL_USD_PER_MTOK, dearer than anything in
// it: the ledger exists to stop a run, and a guess that is too low is the one
// kind of wrong it must not be.
export const PRICES_USD_PER_MTOK: Readonly<Record<string, readonly [number, number]>> = {
  "claude-fable-5-1": [10.0, 50.0],
  "claude-fable-5": [10.0, 50.0],
  "claude-opus-5-5": [4.0, 20.0],
  "claude-opus-5": [5.0, 25.0],
  "claude-opus-4-8": [5.0, 25.0],
  "claude-opus-4-7": [5.0, 25.0],
  "claude-opus-4-6": [5.0, 25.0],
  "claude-sonnet-5-5": [2.0, 10.0],
  "claude-sonnet-5": [2.0, 10.0],
  "claude-sonnet-4-6": [3.0, 15.0],
  "claude-haiku-4-5": [1.0, 5.0],
  "jev": [0.042, 0.0], // TypeSafe AI bills input only (bjt/jev.ts)
};
/** For a model the table does not name. Deliberately above every row. */
export const UNKNOWN_MODEL_USD_PER_MTOK: readonly [number, number] = [15.0, 75.0];
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.10;

/** What a response reports it used, in the API's names: the SDK's `usage`,
 *  or a stand-in with the same fields (a timed-out request, Jev). A field
 *  that is missing or null counts as nothing. */
export type UsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** (input, output) dollars per million tokens: the longest matching
 *  prefix's row, or the unknown-model price. */
export function ratesFor(model: string): readonly [number, number] {
  const matches = Object.keys(PRICES_USD_PER_MTOK).filter((prefix) => model.startsWith(prefix));
  if (matches.length === 0) {
    return UNKNOWN_MODEL_USD_PER_MTOK;
  }
  return PRICES_USD_PER_MTOK[max(matches, (p) => len(p))];
}

/** `int(getattr(usage, name, None) or 0)`: one count from a usage. */
function _tokens(usage: UsageLike | null | undefined, name: keyof UsageLike): number {
  const value: unknown = usage === null || usage === undefined ? null : usage[name];
  return Math.trunc(Number(truthy(value) ? value : 0));
}

/** What one response cost, from the usage the API reports on it. */
export function priceUsd(model: string, usage: UsageLike | null | undefined): number {
  const [perIn, perOut] = ratesFor(model);
  const plain = _tokens(usage, "input_tokens");
  const written = _tokens(usage, "cache_creation_input_tokens");
  const read = _tokens(usage, "cache_read_input_tokens");
  const out = _tokens(usage, "output_tokens");
  return (
    plain * perIn
    + written * perIn * CACHE_WRITE_MULTIPLIER
    + read * perIn * CACHE_READ_MULTIPLIER
    + out * perOut
  ) / 1_000_000;
}

/** Python's name for the type of a JSON value, for a TypeError's message. */
function _typeName(v: unknown): string {
  if (v === null || v === undefined) return "NoneType";
  if (Array.isArray(v)) return "list";
  if (typeof v === "object") return "dict";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  return Number.isInteger(v) ? "int" : "float";
}

/** `data[key]` on a JSON value: a KeyError when a dict lacks it, a
 *  TypeError when it is not a dict. */
function _item(data: unknown, key: string): unknown {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError_(`'${_typeName(data)}' object is not subscriptable`);
  }
  if (!Object.prototype.hasOwnProperty.call(data, key)) throw new KeyError(key);
  return (data as Record<string, unknown>)[key];
}

/** `float(v)` of a JSON value. */
function _float(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return Number(v);
  if (typeof v === "string") return toFloat(v);
  throw new TypeError_(`float() argument must be a string or a real number, not '${_typeName(v)}'`);
}

/** `int(v)` of a JSON value: a float truncates. An infinity is an
 *  OverflowError, which an unreadable ledger is not caught as, exactly as in
 *  Python. */
function _int(v: unknown): number {
  if (typeof v === "number") {
    if (Number.isNaN(v)) throw new ValueError("cannot convert float NaN to integer");
    if (!Number.isFinite(v)) throw new OverflowError("cannot convert float infinity to integer");
    return Math.trunc(v);
  }
  if (typeof v === "boolean") return Number(v);
  if (typeof v === "string") return toInt(v);
  throw new TypeError_(`int() argument must be a string, a bytes-like object or a real number, not '${_typeName(v)}'`);
}

/** The errors a ledger that cannot be read raises: Python's (OSError,
 *  ValueError, TypeError, KeyError) — a file the system will not give us, a
 *  body that is not JSON, a field that is missing or not a number. */
function _ledgerUnreadable(e: unknown): boolean {
  return unreadable(e) || e instanceof ValueError || e instanceof TypeError_
    || e instanceof TypeError || e instanceof KeyError;
}


/** Everything this process has spent on the API, priced as it went.
 *
 *  One per process (`state.spend`, below). Anything that wants the bill for a
 *  run — the nightly summary, `bjt batch`'s last line — reads it; the ceilings
 *  in config are enforced against it before every call.
 *
 *  Two counts, because they differ exactly when something goes wrong:
 *  `attempts` is every request sent, counted before it is sent — a retry, a
 *  request that timed out, one that failed — and it is what the call ceiling
 *  holds; `calls` is every response priced.
 *
 *  **One job, one budget.** The nightly job runs `bjt nightly` and then `bjt
 *  scenes` as two processes, and each used to start with a fresh allowance
 *  and a fresh clock: two fifty-cent ceilings and two half-hours for one
 *  fifty-cent night. With `BJT_SPEND_LEDGER` naming a file, the process
 *  starts from what the file says was spent (dollars, calls, requests) and
 *  when (the clock's start), and writes its totals back after every request
 *  and every priced response and when it exits — atomically, so the next
 *  step never reads half a file. Everything that spends reads this one
 *  object (`llm.state.spend`): the Anthropic calls, Jev, and the picture
 *  job's image requests, so they share it too. A file that cannot be read is
 *  not an empty ledger: nothing is spent until it is fixed. Unset, a process
 *  has its own ceilings, as it always had. */
export class Spend {
  calls: number;
  attempts: number;
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  usd: number;
  usd_by_model: Record<string, number>;
  calls_by_model: Record<string, number>;
  /** When the run's clock started, in epoch seconds: this process's start,
   *  or the first step of the job's when a ledger carries it. */
  started: number;
  /** The shared ledger file, or null for a process on its own. */
  ledger: string | null;
  /** What earlier steps of the job had spent when this one started. */
  carried_usd: number;
  carried_calls: number;
  /** Why the ledger could not be read, when it could not. Checked before
   *  every request: an unreadable ledger spends nothing. */
  ledger_error: string | null;

  constructor(init: {
    calls?: number;
    attempts?: number;
    input_tokens?: number;
    cache_write_tokens?: number;
    cache_read_tokens?: number;
    output_tokens?: number;
    usd?: number;
    usd_by_model?: Record<string, number>;
    calls_by_model?: Record<string, number>;
    started?: number;
    ledger?: string | null;
    carried_usd?: number;
    carried_calls?: number;
    ledger_error?: string | null;
  } = {}) {
    this.calls = init.calls ?? 0;
    this.attempts = init.attempts ?? 0;
    this.input_tokens = init.input_tokens ?? 0;
    this.cache_write_tokens = init.cache_write_tokens ?? 0;
    this.cache_read_tokens = init.cache_read_tokens ?? 0;
    this.output_tokens = init.output_tokens ?? 0;
    this.usd = init.usd ?? 0.0;
    this.usd_by_model = init.usd_by_model ?? {};
    this.calls_by_model = init.calls_by_model ?? {};
    this.started = init.started ?? time();
    this.ledger = init.ledger ?? null;
    this.carried_usd = init.carried_usd ?? 0.0;
    this.carried_calls = init.carried_calls ?? 0;
    this.ledger_error = init.ledger_error ?? null;
  }

  /** The process's ledger: shared through `BJT_SPEND_LEDGER` when set. */
  static fromEnvironment(): Spend {
    const raw = strip(process.env[LEDGER_ENV] ?? "");
    const out = new Spend({ ledger: raw ? raw : null });
    out.load();
    return out;
  }

  /** Start from the shared ledger, if there is one and it exists. */
  load(): void {
    if (this.ledger === null || !existsSync(this.ledger)) {
      return;
    }
    let usd: number, calls: number, attempts: number, started: number;
    try {
      const data: unknown = loads(readFileSync(this.ledger, "utf8"));
      [usd, calls] = [_float(_item(data, "usd")), _int(_item(data, "calls"))];
      [attempts, started] = [_int(_item(data, "attempts")), _float(_item(data, "started_at"))];
      if (![usd, calls, attempts, started].every((x) => Number.isFinite(x) && x >= 0)) {
        throw new ValueError("a negative or non-finite number");
      }
    } catch (e) {
      if (!_ledgerUnreadable(e)) throw e;
      this.ledger_error = `the spend ledger ${this.ledger} cannot be read (${repr(e)})`;
      return;
    }
    this.usd += usd;
    this.calls += calls;
    this.attempts += attempts;
    this.started = Math.min(this.started, started);
    [this.carried_usd, this.carried_calls] = [usd, calls];
  }

  /** Write the totals to the shared ledger, whole or not at all. */
  save(): void {
    if (this.ledger === null || this.ledger_error !== null) {
      return;
    }
    // The dollars and the clock are floats in the file as in Python
    // (`0.0`, never `0`), so either language reads what the other wrote.
    writeAtomic(this.ledger, dumps({
      usd: this.usd, calls: this.calls,
      attempts: this.attempts, started_at: this.started,
    }, { floatKeys: LEDGER_FLOAT_KEYS }) + "\n");
  }

  get minutes(): number {
    return (time() - this.started) / 60;
  }

  add(model: string, usage: UsageLike | null | undefined): number {
    const cost = priceUsd(model, usage);
    this.calls += 1;
    this.input_tokens += _tokens(usage, "input_tokens");
    this.cache_write_tokens += _tokens(usage, "cache_creation_input_tokens");
    this.cache_read_tokens += _tokens(usage, "cache_read_input_tokens");
    this.output_tokens += _tokens(usage, "output_tokens");
    this.usd += cost;
    this.usd_by_model[model] = get(this.usd_by_model, model, 0.0) + cost;
    this.calls_by_model[model] = get(this.calls_by_model, model, 0) + 1;
    this.save();
    return cost;
  }

  /** The ceilings, then one more request on the count. Called before
   *  every request any vendor is sent — each retry included — so the call
   *  ceiling counts what was asked for, not what came back. `reserveUsd` is
   *  the most this request can cost (`worstCaseUsd`); a caller that cannot
   *  bound it passes nothing and is held only to what is already spent. */
  beginRequest(reserveUsd: number = 0): void {
    this.checkCeilings(reserveUsd);
    this.attempts += 1;
    this.save();
  }

  /** Raise if the next call would be one too many, or could take the run
   *  past its budget. Called before it. */
  checkCeilings(reserveUsd: number = 0): void {
    if (this.ledger_error !== null) {
      throw new LLMSpendLimitError(
        `${this.ledger_error}; nothing is spent without knowing what was `
        + `spent (${LEDGER_ENV})`);
    }
    if (this.attempts >= config.RUN_MAX_CALLS) {
      throw new LLMSpendLimitError(
        `call ceiling reached: ${str(this.attempts)} requests this run `
        + `(BJT_RUN_MAX_CALLS=${str(config.RUN_MAX_CALLS)}); $${fixed(this.usd, 2)} spent`);
    }
    if (this.usd >= config.RUN_BUDGET_USD) {
      throw new LLMSpendLimitError(
        `spend ceiling reached: $${fixed(this.usd, 2)} of `
        + `$${fixed(config.RUN_BUDGET_USD, 2)} (BJT_RUN_BUDGET_USD) `
        + `in ${str(this.calls)} calls`);
    }
    if (reserveUsd > 0 && this.usd + reserveUsd > config.RUN_BUDGET_USD) {
      throw new LLMSpendLimitError(
        `spend ceiling reached: $${fixed(this.usd, 2)} spent and the next request `
        + `may cost up to $${fixed(reserveUsd, 2)}, over `
        + `$${fixed(config.RUN_BUDGET_USD, 2)} (BJT_RUN_BUDGET_USD) `
        + `in ${str(this.calls)} calls`);
    }
    if (this.minutes >= config.RUN_MAX_MINUTES) {
      throw new LLMSpendLimitError(
        `time ceiling reached: ${fixed(this.minutes, 0)} minutes this run `
        + `(BJT_RUN_MAX_MINUTES=${g(config.RUN_MAX_MINUTES)}); `
        + `$${fixed(this.usd, 2)} spent in ${str(this.calls)} calls`);
    }
  }

  /** The bill, as a few lines for a summary. */
  report(): string {
    const lines = [
      `Spent $${fixed(this.usd, 2)} of the $${fixed(config.RUN_BUDGET_USD, 2)} ceiling in `
      + `${str(this.calls)} call(s) (${str(this.attempts)} request(s) sent) over `
      + `${fixed(this.minutes, 0)} minute(s): `
      + `${thousands(this.input_tokens)} input, `
      + `${thousands(this.cache_write_tokens)} cache-write, ${thousands(this.cache_read_tokens)} `
      + `cache-read, ${thousands(this.output_tokens)} output token(s).`,
    ];
    if (truthy(this.carried_calls) || truthy(this.carried_usd)) {
      lines.push(`- earlier steps of this job (${LEDGER_ENV}): `
                 + `$${fixed(this.carried_usd, 2)} in ${str(this.carried_calls)} call(s)`);
    }
    for (const model of sorted(Object.keys(this.usd_by_model), { key: (m) => this.usd_by_model[m], reverse: true })) {
      lines.push(`- ${model}: $${fixed(this.usd_by_model[model], 2)} `
                 + `in ${str(this.calls_by_model[model])} call(s)`);
    }
    return lines.join("\n");
  }
}

/** Names the JSON file one job's processes share their spend through. */
export const LEDGER_ENV = "BJT_SPEND_LEDGER";

/** The ledger's two float fields (pyjson `floatKeys`). */
const LEDGER_FLOAT_KEYS: ReadonlySet<string> = new Set(["usd", "started_at"]);

/** What a client must offer: the one method `_structured` calls. The SDK's
 *  `Anthropic` is one; a test's fake is another. */
export type MessagesClient = {
  messages: { create(params: any): unknown };
};

/** The module's mutable state (Python's module globals `_client` and
 *  `spend`): replaced by tests, read here at call time. */
export const state = {
  client: null as Anthropic | null,
  spend: Spend.fromEnvironment(),
};

/** Run when the process exits (Python's `atexit`). */
export function _saveOnExit(): void {
  // Whatever `spend` is by then; a process that made no request still
  // passes on when the job's clock started.
  state.spend.save();
}

process.on("exit", () => {
  try {
    _saveOnExit();
  } catch (e) {
    // As Python's atexit does: said on stderr, and the exit status left alone.
    eprint(`Exception ignored in exit handler _saveOnExit: ${e instanceof Error && e.stack ? e.stack : str(e)}`);
  }
});

export const _EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

/** Never harder than config.EFFORT_CEILING, whatever was asked for. */
export function clampEffort(effort: string): string {
  if (!_EFFORTS.includes(effort) || !_EFFORTS.includes(config.EFFORT_CEILING)) {
    return _EFFORTS.includes(effort) ? effort : "medium";
  }
  return _EFFORTS[Math.min(_EFFORTS.indexOf(effort), _EFFORTS.indexOf(config.EFFORT_CEILING))];
}

function _getClient(): MessagesClient {
  if (state.client === null) {
    // No retries in the SDK: a retry it makes is a request nobody counts
    // and nobody checks a ceiling before. `_structured` retries instead,
    // the same number of times, each one through `spend.beginRequest`.
    // (The SDK's timeout is in milliseconds; the setting is in seconds.)
    state.client = new Anthropic({ timeout: config.API_TIMEOUT_SECONDS * 1000, maxRetries: 0 });
  }
  return state.client;
}

// ----- retries ---------------------------------------------------------------

/** The statuses the SDK itself would retry: a timeout, a conflict, a rate
 *  limit, and anything the server got wrong. */
export const _RETRY_STATUSES: readonly number[] = [408, 409, 429];

/** The wait before a retry, in seconds: doubling from the first, never more
 *  than the last, or what the server's retry-after asks when that is shorter
 *  than a minute. `seams.sleep` is the seam the tests replace. */
export const _BACKOFF_FIRST = 0.5;
export const _BACKOFF_MAX = 8.0;

function _sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/** The two places this module touches the world, replaceable in tests:
 *  the Anthropic client (Python's `_get_client`) and the wait between
 *  retries (`_sleep`). */
export const seams = {
  getClient: _getClient as () => MessagesClient,
  sleep: _sleep as (seconds: number) => Promise<void>,
};

/** The HTTP status an error carries (the SDK's `status`), or null. */
export function _statusOf(exc: unknown): number | null {
  const code: unknown = exc !== null && typeof exc === "object" ? (exc as { status?: unknown }).status : undefined;
  return typeof code === "number" && Number.isInteger(code) ? code : null;
}

/** An error from the API or the SDK's transport: an outage, a refusal, a
 *  status the server sent, a connection that failed — and no credentials,
 *  which the SDK reports as a plain Error when it resolves them. These are
 *  the failures a caller may tolerate. Anything else (a parameter this SDK
 *  does not know, a bug of ours) is a crash, and is thrown as itself:
 *  wrapped as an `LLMError` it would read as an outage, and every tolerant
 *  call site would turn a broken run into a quiet one. */
export function _isApiFailure(exc: unknown): boolean {
  if (exc instanceof AnthropicError) {
    return true;
  }
  return exc instanceof Error && errText(exc).includes("authentication method");
}

/** No reply at all: the connection failed or the request timed out. (In the
 *  TypeScript SDK a connection error is an `APIError` with no status.) */
export function _isConnectionError(exc: unknown): boolean {
  return exc instanceof APIConnectionError;
}

export function _isTimeout(exc: unknown): boolean {
  return exc instanceof APIConnectionTimeoutError;
}

export function _retryable(exc: unknown): boolean {
  const status = _statusOf(exc);
  if (status !== null) {
    return _RETRY_STATUSES.includes(status) || status >= 500;
  }
  return _isConnectionError(exc);
}

export function _backoff(retry: number, exc: unknown): number {
  let wait = Math.min(_BACKOFF_MAX, _BACKOFF_FIRST * 2 ** retry) * (0.75 + Math.random() / 4);
  // The SDK keeps the response's headers on the error itself (a fetch
  // `Headers`); a fake may give a plain object.
  const headers: unknown = exc !== null && typeof exc === "object" ? (exc as { headers?: unknown }).headers : undefined;
  let raw: unknown = "";
  if (headers !== null && typeof headers === "object") {
    const getter = (headers as { get?: unknown }).get;
    raw = typeof getter === "function"
      ? (getter as (name: string) => unknown).call(headers, "retry-after") ?? ""
      : get(headers as Record<string, unknown>, "retry-after", "");
  }
  let asked: number | null;
  try {
    asked = _float(raw);
  } catch (e) {
    if (!(e instanceof TypeError_ || e instanceof ValueError)) throw e;
    asked = null;
  }
  if (asked !== null && 0 <= asked && asked <= 60) {
    wait = asked;
  }
  return wait;
}

/** What a request that timed out may have cost: its whole output ceiling,
 *  and an input counted a token per character (more than Japanese or English
 *  takes) with a picture at the most a picture is. The server may well have
 *  finished it and billed it; a ledger that priced it at nothing would let a
 *  run of timeouts spend without limit. */
export function _worstCaseUsage(system: string, user: string | unknown[], maxTokens: number): UsageLike {
  let chars = len(system);
  const blocks: unknown[] = Array.isArray(user) ? user : [{ type: "text", text: user }];
  for (const block of blocks) {
    if (isDict(block) && get(block, "type") === "image") {
      chars += _IMAGE_TOKENS_MAX;
    } else if (isDict(block)) {
      chars += len(str(get(block, "text", "")));
    } else {
      chars += len(str(block));
    }
  }
  return { input_tokens: chars, output_tokens: maxTokens };
}

/** The most one request can cost: `_worstCaseUsage` priced, with the whole
 *  input as a cache write (the dearest way an input token is billed). What
 *  the spend ceiling reserves before the request is sent. */
export function worstCaseUsd(model: string, system: string, user: string | unknown[],
                             maxTokens: number): number {
  const usage = _worstCaseUsage(system, user, maxTokens);
  const [perIn] = ratesFor(model);
  const inTokens = _tokens(usage, "input_tokens");
  return priceUsd(model, { output_tokens: usage.output_tokens })
    + inTokens * perIn * Math.max(1, CACHE_WRITE_MULTIPLIER) / 1_000_000;
}

/** The most input tokens one picture can be, at the API's largest image size. */
export const _IMAGE_TOKENS_MAX = 5000;

/** The parameters of one Messages request, shaped for the model.
 *
 *  The thinking and effort controls are a property of the model family, not of
 *  the call. Opus and Sonnet take adaptive thinking and an effort level; Haiku
 *  4.5 takes neither — it wants a fixed thinking budget, and sending it the
 *  adaptive form or an effort level is a 400 on every call, which the
 *  proofreader and the difficulty probe would report as not having run. The
 *  calls Haiku makes here are small judgements with a small ceiling, and they
 *  do not need thinking at all, so for Haiku the two keys are simply left out. */
export function requestParams(
  model: string,
  system: string,
  user: string | unknown[],
  schema: Record<string, unknown>,
  opts: { maxTokens: number; effort: string },
): Record<string, any> {
  // Two ceilings no caller can lift: output per call, and how hard the
  // model may think. They cap the cost of one call the way the spend ledger
  // caps the cost of a run.
  const maxTokens = Math.min(opts.maxTokens, config.MAX_TOKENS_CEILING);
  const effort = clampEffort(opts.effort);
  const params: Record<string, any> = {
    model: model,
    max_tokens: maxTokens,
    output_config: { format: { type: "json_schema", schema: schema } },
    // The system prompt is the stable half of every request — the task
    // spec, the role list, the few-shot examples, the level descriptor —
    // and it is identical across every attempt at a shelf. Marking it
    // cacheable means the second attempt onward reads it at a tenth of the
    // price. Below the model's minimum cacheable size the marker is simply
    // ignored, so a short prompt costs nothing extra.
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  };
  if (!model.startsWith("claude-haiku")) {
    params.thinking = { type: "adaptive" };
    params.output_config.effort = effort;
  }
  return params;
}

/** How `stop_details` reads in a message: an object as its fields
 *  (`type='refusal' explanation='…'`, as the Python SDK prints it), anything
 *  else as itself. */
function _detailsText(details: unknown): string {
  if (isDict(details)) {
    return Object.entries(details).map(([k, v]) => `${k}=${repr(v)}`).join(" ");
  }
  return str(details);
}

/** One structured-output request. Returns the parsed JSON object.
 *
 *  A transient failure (a timeout, a dropped connection, a rate limit, an
 *  overloaded server) is retried here, up to config.API_MAX_RETRIES times,
 *  and every attempt goes through the ceilings and onto the count first. */
export async function _structured(
  system: string,
  user: string | unknown[],
  schema: Record<string, unknown>,
  model: string,
  opts: { maxTokens?: number; effort?: string } = {},
): Promise<any> {
  const maxTokens = opts.maxTokens ?? 8000;
  const effort = opts.effort ?? "high";
  // The ceilings are checked before the call, never after: a run that is
  // over its budget, or that this request could take over it, makes no
  // further request, not one more.
  const params = requestParams(model, system, user, schema, { maxTokens, effort });
  const reserve = worstCaseUsd(model, system, user, params.max_tokens);
  state.spend.checkCeilings(reserve);
  const client = seams.getClient();
  let retry = 0;
  let resp: any;
  while (true) {
    state.spend.beginRequest(reserve);
    try {
      resp = await client.messages.create(params);
      break;
    } catch (e) { // surface API errors with context
      if (!_isApiFailure(e)) {
        throw e;
      }
      if (_isTimeout(e)) {
        // Sent, and perhaps finished and billed with nobody listening.
        state.spend.add(model, _worstCaseUsage(system, user, params.max_tokens));
      }
      if (_retryable(e) && retry < config.API_MAX_RETRIES) {
        await seams.sleep(_backoff(retry, e));
        retry += 1;
        continue;
      }
      if (_BILLING_SIGNS.some((sign) => errText(e).toLowerCase().includes(sign))) {
        throw new LLMBillingError(`API request failed: ${errText(e)}`, { cause: e });
      }
      throw new LLMError(`API request failed: ${errText(e)}`, { cause: e });
    }
  }

  // Priced from what the API says it used, before anything else can fail:
  // a refusal or a malformed reply was paid for too.
  state.spend.add(model, resp?.usage ?? null);

  if (resp.stop_reason === "refusal") {
    throw new LLMError(`model refused the request (${_detailsText(resp.stop_details)})`);
  }
  if (_TRUNCATED.includes(resp.stop_reason)) {
    throw new LLMTruncatedError(
      `reply cut off (${str(resp.stop_reason)}) at a ceiling of `
      + `${params.max_tokens} output tokens`);
  }

  let text: unknown = null;
  for (const b of resp.content) {
    if (b?.type === "text") {
      text = b.text;
      break;
    }
  }
  if (!truthy(text)) {
    throw new LLMError("no text block in response");
  }
  try {
    return loads(text as string);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    throw new LLMError(`structured output was not valid JSON: ${errText(e)}`, { cause: e });
  }
}

export async function generateStructured(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  opts: { model?: string | null } = {},
): Promise<Record<string, any>> {
  return _structured(system, user, schema, opts.model || config.GEN_MODEL,
                     { maxTokens: 8000, effort: config.GEN_EFFORT });
}

/** The schema of a one-flag-per-rule review: a boolean per rule, described
 *  as `flag` says, then a `notes` string. Shared by the proofreader and the
 *  scene reviewer, whose callers own the rule lists. */
function _flagSchema(rules: Record<string, string>, flag: (fault: string) => string,
                     notes: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [rule, fault] of Object.entries(rules)) {
    properties[rule] = { type: "boolean", description: flag(fault) };
  }
  properties["notes"] = { type: "string", description: notes };
  return {
    type: "object",
    additionalProperties: false,
    required: [...Object.keys(rules), "notes"],
    properties: properties,
  };
}

/** A picture as a content block of the user turn. */
function _imageBlock(image: Uint8Array, mediaType: string): Record<string, unknown> {
  return { type: "image", source: { type: "base64", media_type: mediaType,
                                    data: Buffer.from(image).toString("base64") } };
}

// ----- the proofreader --------------------------------------------------

/** Read one finished item and say which of the rules it breaks.
 *
 *  Returns {rule: bool, ..., "notes": str}; a true flag means the fault is
 *  present. Same shape as `reviewSceneImage`, for the same reason: the caller
 *  owns the rule list (`sanity.RULES`, key → fault in words) so the schema and
 *  the wording the model is judged against cannot drift apart.
 *
 *  Small model, low effort, small ceiling — this is the cheap pass that runs on
 *  every item before the expensive one runs on any of them. Deliberately NOT
 *  asked to re-answer the question: an item is meant to be hard, and a cheap
 *  model's disagreement about which 敬語 form fits is not evidence of a defect. */
export async function sanityCheck(
  renderedItem: string,
  rules: Record<string, string>,
  opts: { model?: string | null } = {},
): Promise<Record<string, any>> {
  const schema = _flagSchema(rules, (fault) => `true if this fault is present: ${fault}`,
                             "one sentence on anything you flagged");
  const user = (
    "Proofread the finished test item below. It is meant to be difficult, and a "
    + "hard item is not a broken one — flag a rule only when the fault is actually "
    + "there, not when you would have written the item differently. The distractors "
    + "are wrong on purpose — but wrong the way real people are wrong, so a "
    + "distractor nobody would ever say is a fault. Set every flag you are unsure "
    + "about to false.\n\n"
    + renderedItem
  );
  const system = (
    "You are the proofreader for a business-Japanese test bank. You are a native "
    + "reader of Japanese and you check finished items for defects: a marked answer "
    + "that cannot be right, a second answer that is just as right, an explanation "
    + "that does not match the marked answer, broken Japanese, Japanese no native "
    + "would say, a situation that does not hang together, options that do not "
    + "answer the question. You report faults, not preferences."
  );
  return _structured(system, user, schema, opts.model || config.SANITY_MODEL,
                     { maxTokens: 1200, effort: "low" });
}

// ----- answering (gate + calibration) -----------------------------------

export const _ANSWER_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["choice", "reason"],
  properties: {
    choice: { type: "integer", description: "0-based index of the chosen option" },
    reason: { type: "string", description: "one short sentence of justification" },
  },
};

/** Pick one option. Used by the answerability gate and calibration.
 *
 *  Returns {"choice": int, "reason": str}. Low effort: this is a judgement call,
 *  not a generation task, and we run it many times. */
export async function answerChoice(
  question: string,
  options: string[],
  opts: { model?: string | null } = {},
): Promise<Record<string, any>> {
  const numbered = options.map((t, i) => `${i}. ${str(t)}`).join("\n");
  const user = (
    `${question}\n\nOptions:\n${numbered}\n\n`
    + "Choose the single best option and return its 0-based index."
  );
  const system = (
    "You are a highly proficient reader of Japanese taking a business-Japanese "
    + "proficiency test. Answer to the best of your ability. If the information "
    + "given is insufficient to determine the answer, pick your best guess anyway."
  );
  return _structured(system, user, _ANSWER_SCHEMA, opts.model || config.JUDGE_MODEL, { maxTokens: 1500, effort: "low" });
}

// ----- discriminator judge ----------------------------------------------

/** Ask a judge to label each item real (official) or synthetic (generated),
 *  and to state the tells it used.
 *
 *  Returns {"labels": ["official"|"synthetic", ...], "reasons": [str, ...]}. */
export async function judgeSynthetic(
  renderedItems: string[],
  opts: { model?: string | null } = {},
): Promise<Record<string, any>> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["labels", "reasons"],
    properties: {
      labels: {
        type: "array",
        items: { type: "string", enum: ["official", "synthetic"] },
      },
      reasons: {
        type: "array",
        items: { type: "string" },
        description: "Concrete tells you used to separate synthetic from official items.",
      },
    },
  };
  const blocks = renderedItems.map((txt, i) => `=== Item ${i} ===\n${str(txt)}`).join("\n\n");
  const user = (
    "Below are BJT-style items. Some are from official sample material, some were "
    + "generated by a model. For each item, label it 'official' or 'synthetic'. Then "
    + "list the concrete tells that let you separate the synthetic ones — if you cannot "
    + "tell them apart, say so.\n\n" + blocks
  );
  const system = "You are an expert BJT item writer with an eye for synthetic-item tells.";
  return _structured(system, user, schema, opts.model || config.JUDGE_MODEL, { maxTokens: 4000, effort: "high" });
}

// ----- answering from a picture ------------------------------------------

/** Look at a picture and pick which of the options describes it.
 *
 *  The visual half of the answerability gate for 画像把握 (bjt/scene_art.ts):
 *  the same shape as `answerChoice`, with the picture where the stem would
 *  be. Low effort, small ceiling, run a few times per draft like the text
 *  gate; the draft ships only if every trial picks the marked option. */
export async function answerFromImage(
  image: Uint8Array,
  mediaType: string,
  question: string,
  options: string[],
  opts: { model?: string | null } = {},
): Promise<Record<string, any>> {
  const numbered = options.map((t, i) => `${i}. ${str(t)}`).join("\n");
  const content = [
    _imageBlock(image, mediaType),
    { type: "text", text: (
      `${question}\n\nOptions:\n${numbered}\n\n`
      + "Look at the picture and choose the single option that describes what it "
      + "shows. Return its 0-based index."
    ) },
  ];
  const system = (
    "You are a highly proficient reader of Japanese taking a business-Japanese "
    + "listening test in which a picture is shown and four descriptions are heard. "
    + "Answer from what is actually visible. If none fits well, pick the closest."
  );
  return _structured(system, content, _ANSWER_SCHEMA, opts.model || config.JUDGE_MODEL,
                     { maxTokens: 1500, effort: "low" });
}

// ----- scene artwork review ---------------------------------------------

/** Look at one draft and say which of the brief's rules it breaks.
 *
 *  Returns {rule: bool, ..., "notes": str}; a true flag means the rule is
 *  broken. The rules are named by the caller so the schema and the verdict
 *  stay in one place (`scene_art.RULES`, key → fault in words). Strict on purpose: a picture that
 *  is doubtful on any rule is a picture the whole bank inherits. */
export async function reviewSceneImage(
  image: Uint8Array,
  mediaType: string,
  brief: string,
  rules: Record<string, string>,
  opts: { model?: string | null } = {},
): Promise<Record<string, any>> {
  const schema = _flagSchema(rules, (fault) => `true if the image has this fault: ${fault}`,
                             "one or two sentences on what you see");
  const content = [
    _imageBlock(image, mediaType),
    { type: "text", text: (
      "This image was drawn for the brief below. It will be shared by many "
      + "listening-comprehension items about the same setting, so it must show the "
      + "setting and nothing more specific. Check it against every clause of the "
      + "brief and set each flag to true only if that fault is actually present. "
      + "Be strict: readable text of any language, a logo, a recognisable real "
      + "person, or a picture that tells the viewer what is being said are each a "
      + "fault on their own.\n\n=== Brief ===\n" + brief
    ) },
  ];
  const system = ("You are the art reviewer for a shared illustration bank used by a "
                  + "business-Japanese listening test. You judge drafts against a written "
                  + "brief and report faults, not taste.");
  return _structured(system, content, schema, opts.model || config.JUDGE_MODEL,
                     { maxTokens: 1500, effort: "medium" });
}
