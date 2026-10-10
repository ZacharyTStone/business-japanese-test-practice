/**
 * Jev as the difficulty probe's instrument (bjt/jev.ts), and `bjt probe --compare`.
 *
 * Nothing here reaches TypeSafe: the one HTTP seam, `bjt.http.request`, is replaced.
 * What is under test is what this repository owes any model it calls — the
 * ceilings before the call, the bill after it, an unreadable reply that becomes
 * "unmeasured" and never a rate — and that a comparison writes nothing.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import * as backfill from "../bjt/backfill.ts";
import * as batch from "../bjt/batch.ts";
import * as cli from "../bjt/cli/index.ts";
import * as answerability from "../bjt/fidelity/answerability.ts";
import * as difficulty from "../bjt/fidelity/difficulty.ts";
import * as fixtures from "../bjt/fixtures.ts";
import * as http from "../bjt/http.ts";
import * as jev from "../bjt/jev.ts";
import * as llm from "../bjt/llm.ts";
import * as pipeline from "../bjt/pipeline.ts";
import { deepcopy, max, sorted, sum } from "../bjt/py.ts";
import { dumps } from "../bjt/pyjson.ts";
import * as withdrawn from "../bjt/withdrawn.ts";
import { goiCorrectText, goiItem, store } from "./conftest.ts";
import { capture, delEnv, patch, setConfig, setEnv, tmpPath } from "./helpers.ts";

// These tests exercise the pass-rate probe ("trials"); the confidence
// probe, the default since 2026-10-10, has its own in confidence.test.ts.
beforeEach(() => {
  setConfig({ DIFFICULTY_METHOD: "trials" });
});

type Item = Record<string, any>;

const ROOT = path.resolve(import.meta.dirname, "..");
const JEV = "jev-latest";

function _reply(probs: Record<string, any>, usage: Record<string, any> | null = null): Uint8Array {
  const body: Item = { "model": "jev-1.13.0",
                       "answers": { [jev.QUESTION]: { "type": "choice", "choice": max(Object.keys(probs), (k) => probs[k]),
                                                      "probabilities": probs, "confidence": 0.8 } } };
  if (usage !== null) {
    body["usage"] = usage;
  }
  return new TextEncoder().encode(dumps(body));
}

/** `ledger`: a fresh bill for the test. */
function ledger(): llm.Spend {
  const fresh = new llm.Spend();
  patch(llm.state, "spend", fresh);
  return fresh;
}

/** `keyed`: a key in the environment. */
function keyed(): void {
  setEnv("TYPESAFE_API_KEY", "test-key");
}

type Wire = {
  sent: [string, any, Record<string, string> | null | undefined][];
  reply: Uint8Array;
  error: Error | null;
};

/** `wire`: the transport. Set `.reply` (bytes) or `.error` (an exception);
 *  every request is kept in `.sent` as (url, parsed body, headers). */
function wire(): Wire {
  const state: Wire = { sent: [], reply: _reply({ "option_1": 0.7, "option_2": 0.1,
                                                  "option_3": 0.1, "option_4": 0.1 },
                                                { "input_tokens": 300, "output_tokens": 30 }),
                        error: null };

  patch(http, "request", async (method: string, url: string, opts: { body?: Uint8Array | string | null; headers?: Record<string, string> | null } = {}) => {
    const data = typeof opts.body === "string" ? opts.body : new TextDecoder().decode(opts.body ?? new Uint8Array());
    state.sent.push([url, JSON.parse(data), opts.headers]);
    if (state.error !== null) {
      throw state.error;
    }
    return state.reply;
  });
  return state;
}

function expectApprox(got: number[], want: number[]): void {
  expect(got.length).toBe(want.length);
  got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 6));
}

// ----- the request and the reply --------------------------------------------------

describe("the request and the reply", () => {
  test("the question is the state and the options are the criteria", () => {
    const body = jev.requestBody("問題文", ["一", "二", "三", "四"], JEV);
    expect(body["model"] === JEV && body["state"] === "問題文").toBe(true);
    const q = body["questions"][jev.QUESTION];
    expect(q["type"]).toBe("choice");
    expect(Object.entries(q["criteria"])).toEqual([["option_1", "一"], ["option_2", "二"],
                                                   ["option_3", "三"], ["option_4", "四"]]);
  });

  /** TypeSafe's own example names an answer it was not offered; the share of
   *  ours is what a rate can be made of. */
  test("probabilities come back in option order over our options only", () => {
    const reply = JSON.parse(new TextDecoder().decode(_reply({ "option_2": 0.3, "option_1": 0.5, "option_3": 0.1,
                                                               "option_4": 0.0, "somewhere_else": 0.1 })));
    const probs = jev.probabilities(reply, 4);
    expectApprox(probs, [0.5 / 0.9, 0.3 / 0.9, 0.1 / 0.9, 0.0]);
    expect(sum(probs)).toBeCloseTo(1.0, 6);
  });

  test.each([
    [{ "option_1": 0.5, "option_2": 0.5, "option_3": 0.0 }],               // one missing
    [{ "option_1": 0.5, "option_2": 0.5, "option_3": 0.0, "option_4": -0.1 }],
    [{ "option_1": 0.5, "option_2": 0.5, "option_3": 0.0, "option_4": NaN }],
    [{ "option_1": 0.5, "option_2": 0.5, "option_3": 0.0, "option_4": "0.1" }],
    [{ "option_1": true, "option_2": 0, "option_3": 0, "option_4": 0 }],
    [{ "option_1": 0, "option_2": 0, "option_3": 0, "option_4": 0 }],        // nothing on ours
  ])("a reply that is not a distribution is an error not a guess %j", (probs) => {
    const reply = { "answers": { [jev.QUESTION]: { "probabilities": probs } } };
    expect(() => jev.probabilities(reply, 4)).toThrow(llm.LLMError);
  });

  test.each([[{}], [{ "answers": {} }], [{ "answers": { "other": {} } }], [[]], ["x"]])(
    "a reply of another shape is an error %j", (reply) => {
      expect(() => jev.probabilities(reply, 4)).toThrow(llm.LLMError);
    });
});

// ----- the call ---------------------------------------------------------------------

describe("the call", () => {
  test("the call sends the key to the configured url", async () => {
    ledger();
    keyed();
    const w = wire();
    setConfig({ JEV_URL: "https://jev.example/v1/systemone" });
    const probs = await jev.choiceProbabilities("問題", ["a", "b", "c", "d"], { model: JEV });
    expectApprox(probs, [0.7, 0.1, 0.1, 0.1]);
    const [url, body, headers] = w.sent[0];
    expect(url).toBe("https://jev.example/v1/systemone");
    expect(headers!["Authorization"]).toBe("Bearer test-key");
    expect(body["model"]).toBe(JEV);
  });

  test("no key is an error and no request", async () => {
    ledger();
    const w = wire();
    delEnv("TYPESAFE_API_KEY");
    const err = await jev.choiceProbabilities("q", ["a", "b"], { model: JEV }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(llm.LLMError);
    expect((err as Error).message).toMatch(/TYPESAFE_API_KEY/);
    expect(w.sent).toEqual([]);
  });

  test("the ceilings are checked before the call", async () => {
    ledger();
    keyed();
    const w = wire();
    setConfig({ RUN_MAX_CALLS: 1 });
    await jev.choiceProbabilities("q", ["a", "b", "c", "d"], { model: JEV });
    await expect(jev.choiceProbabilities("q", ["a", "b", "c", "d"], { model: JEV })).rejects.toThrow(llm.LLMSpendLimitError);
    expect(w.sent.length, "the call past the ceiling was never made").toBe(1);
  });

  test("every reply is on the bill", async () => {
    const bill = ledger();
    keyed();
    wire();
    await jev.choiceProbabilities("q", ["a", "b", "c", "d"], { model: JEV });
    expect(bill.calls === 1).toBe(true);
    expect(bill.calls_by_model).toEqual({ [JEV]: 1 });
    expect(bill.input_tokens === 300 && bill.usd > 0).toBe(true);
  });

  /** $0.042 per million input tokens, output free (TypeSafe's usage page). */
  test("jev bills input only at typesafes rate", () => {
    const u = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
    expect(llm.priceUsd(JEV, u)).toBeCloseTo(0.042, 9);
  });

  test("jev does not change what an unknown model is priced as", () => {
    const u = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
    expect(llm.ratesFor("claude-something-new")).toEqual(llm.UNKNOWN_MODEL_USD_PER_MTOK);
    expect(llm.priceUsd("claude-something-new", u)).toBeGreaterThan(llm.priceUsd("claude-fable-5-1", u));
  });

  /** Bytes are more than tokens, so the estimate errs high. */
  test("a reply without usage is priced on the request size", async () => {
    const bill = ledger();
    keyed();
    const w = wire();
    w.reply = _reply({ "option_1": 1.0, "option_2": 0.0 });
    await jev.choiceProbabilities("日本語の問題", ["a", "b"], { model: JEV });
    const sent = new TextEncoder().encode(dumps(jev.requestBody("日本語の問題", ["a", "b"], JEV), { ensureAscii: false }));
    expect(bill.input_tokens === sent.length && bill.usd > 0).toBe(true);
  });

  test("a reply that is not json is billed and then an error", async () => {
    const bill = ledger();
    keyed();
    const w = wire();
    w.reply = new TextEncoder().encode("<html>gateway</html>");
    const err = await jev.choiceProbabilities("q", ["a", "b"], { model: JEV }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(llm.LLMError);
    expect((err as Error).message).toMatch(/not JSON/);
    expect(bill.calls === 1 && bill.usd > 0).toBe(true);
  });

  function _httpError(code: number, body: Uint8Array): http.RequestFailed {
    const detail = new TextDecoder().decode(body);
    return new http.RequestFailed(`POST https://x → HTTP ${code}: ${detail}`, { status: code, detail: detail });
  }

  test("an account that cannot pay stops the run", async () => {
    ledger();
    keyed();
    const w = wire();
    w.error = _httpError(402, new TextEncoder().encode('{"error": "insufficient_quota"}'));
    await expect(jev.choiceProbabilities("q", ["a", "b"], { model: JEV })).rejects.toThrow(llm.LLMBillingError);
  });

  test("any other failure is an ordinary error", async () => {
    ledger();
    keyed();
    const w = wire();
    w.error = _httpError(500, new TextEncoder().encode("upstream timeout"));
    const err = await jev.choiceProbabilities("q", ["a", "b"], { model: JEV }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(llm.LLMError);
    expect(err).not.toBeInstanceOf(llm.LLMBillingError);
    w.error = new http.RequestFailed("POST https://x failed: egress blocked",
                                     { status: null, detail: "egress blocked" });
    await expect(jev.choiceProbabilities("q", ["a", "b"], { model: JEV })).rejects.toThrow(llm.LLMError);
  });
});

// ----- the probe ----------------------------------------------------------------

/** `jev_probe`: Jev as the probe's model. */
function jevProbe(): void {
  setConfig({ DIFFICULTY_ENABLED: true, DIFFICULTY_TRIALS: 5, DIFFICULTY_MODEL: JEV });
}

type Ask = (question: string, options: string[], opts?: { model?: string | null }) => Promise<number[]>;

/** Jev's stand-in: `pKey` on the correct option, the rest shared out. */
function _probabilitiesForKey(pKey: number, seen: [string | null, string][] | null = null): Ask {
  return async (question, options, opts = {}) => {
    if (seen !== null) {
      seen.push([opts.model ?? null, question]);
    }
    const ci = options.indexOf(goiCorrectText());
    const rest = (1 - pKey) / (options.length - 1);
    return options.map((_, i) => (i === ci ? pKey : rest));
  };
}

describe("the probe", () => {
  /** The nightly workflow passes a repository variable that may not exist,
   *  which reaches the process as an empty string. */
  test.each([["", "claude-haiku-4-5"], ["  ", "claude-haiku-4-5"],
             ["jev-latest", "jev-latest"]])("an empty difficulty model means the default [%j]", (value, expected) => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    env["BJT_DIFFICULTY_MODEL"] = value;
    delete env["BJT_SANITY_MODEL"];
    const out = spawnSync(process.execPath, [
      "--input-type=module", "-e",
      "const config = await import('./bjt/config.ts'); process.stdout.write(config.DIFFICULTY_MODEL + '\\n');",
    ], { env: env, encoding: "utf8", cwd: ROOT, timeout: 60_000 });
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout.trim()).toBe(expected);
  });

  test("the rate is the probability on the key", async () => {
    jevProbe();
    const seen: [string | null, string][] = [];
    patch(jev, "choiceProbabilities", _probabilitiesForKey(0.62, seen));
    const res = await difficulty.measure(goiItem());
    expect(res.measured).toBe(true);
    expect(res.rate).toBeCloseTo(0.62, 6);
    expect(res.model === JEV && res.detail().includes(`(${JEV})`)).toBe(true);
    expect(seen.length, "one call, whatever DIFFICULTY_TRIALS says").toBe(1);
    expect(res.trials.length === 1 && res.trials[0].side === difficulty.SIDE).toBe(true);
    expect(res.trials[0].correct, "the most likely option was the key").toBe(true);
  });

  test("jev sits the full view like the probe it replaces", async () => {
    jevProbe();
    const item = goiItem();
    const seen: [string | null, string][] = [];
    patch(jev, "choiceProbabilities", _probabilitiesForKey(0.4, seen));
    await difficulty.measure(item);
    expect(seen).toHaveLength(1);
    const [[, question]] = seen;
    expect(question.includes(item["stem"]) && !question.includes("withheld")).toBe(true);
  });

  test("a low probability on the key is recorded as a miss", async () => {
    jevProbe();
    patch(jev, "choiceProbabilities", _probabilitiesForKey(0.1));
    const res = await difficulty.measure(goiItem());
    expect(res.rate).toBeCloseTo(0.1, 6);
    expect(res.trials[0].correct === false && res.trials[0].chosen !== null).toBe(true);
  });

  test("a failed call is unmeasured never a rate", async () => {
    jevProbe();
    patch(jev, "choiceProbabilities", async () => {
      throw new llm.LLMError("unreachable");
    });
    const res = await difficulty.measure(goiItem());
    expect(res.measured === false && res.rate === null).toBe(true);
    expect(res.detail()).toBe("difficulty=unmeasured");
    // The backfill's "cannot be reached" count reads exactly this.
    expect(res.trials.map((t) => t.chosen)).toEqual([null]);
  });

  test("the probe costs its trials per item and jev one call", () => {
    setConfig({ DIFFICULTY_TRIALS: 5, DIFFICULTY_MODEL: "claude-haiku-4-5" });
    expect(difficulty.callsPerItem()).toBe(5);
    expect(difficulty.callsPerItem({ model: JEV })).toBe(1);
  });

  /** The whole path to a bundle: the gate on the judge, then the probe on Jev. */
  test("a kept item ships with jevs probability", async () => {
    const s = store();
    jevProbe();
    setConfig({ SANITY_ENABLED: false });
    patch(llm, "generateStructured", async () => deepcopy(fixtures.FIXTURES["goi_bunpou"]));

    const judge = async (question: string, options: string[], opts: { model?: string | null } = {}) => {
      const ci = options.indexOf(goiCorrectText());
      return { "choice": question.includes("withheld") ? (ci + 1) % 4 : ci, "reason": "x" };
    };

    patch(llm, "answerChoice", judge);
    patch(jev, "choiceProbabilities", _probabilitiesForKey(0.55));

    const [item, , kept, detail] = await pipeline.generateAndGate(s, "goi_bunpou", "J2", { gate: true });
    expect(kept).toBe(true);
    expect(item["model_p_correct"]).toBeCloseTo(0.55, 6);
    expect(detail).toContain(`difficulty=55% (${JEV})`);
  });
});

// ----- the comparison ------------------------------------------------------------

const SHELVES = ["hyougen_J3_001.json", "sougou_dokkai_J1_001.json"] as const;

/** `bank`: the two bundles in a batches/ of their own, nothing withdrawn, the
 *  probe on its default model, and a fresh bill. */
function bank(): string {
  const d = path.join(tmpPath(), "batches");
  mkdirSync(d);
  for (const name of SHELVES) {
    writeFileSync(path.join(d, name), readFileSync(path.join(ROOT, "batches", name)));
  }
  writeFileSync(path.join(d, withdrawn.LEDGER_NAME), "# nothing withdrawn\n", "utf8");
  setConfig({ BATCH_DIR: d, DIFFICULTY_ENABLED: true, DIFFICULTY_MODEL: "claude-haiku-4-5", DIFFICULTY_TRIALS: 5 });
  patch(llm.state, "spend", new llm.Spend());
  return d;
}

function _snapshot(d: string): Record<string, Buffer> {
  return Object.fromEntries(sorted(readdirSync(d)).map((name) => [name, readFileSync(path.join(d, name))]));
}

type Measure = (item: Item, opts?: { model?: string | null }) => Promise<difficulty.DifficultyResult>;

/** difficulty.measure's stand-in: a fixed rate per model, in turn. */
function _measureByModel(rates: Record<string, (number | null)[]>, seen: (string | null)[]): Measure {
  const streams = Object.fromEntries(Object.entries(rates).map(([m, r]) => [m, r[Symbol.iterator]()]));

  return async (item, opts = {}) => {
    const model = opts.model ?? null;
    seen.push(model);
    const next = streams[model as string].next();
    if (next.done) {
      throw new Error("StopIteration");
    }
    const rate = next.value;
    if (rate === null) {
      return new difficulty.DifficultyResult({ model: model ?? "", trials: [
        new answerability.Trial({ side: "difficulty", trial: 0, chosen: null, correct: false })] });
    }
    return new difficulty.DifficultyResult({ rate: rate, model: model ?? "", measured: true, trials: [
      new answerability.Trial({ side: "difficulty", trial: 0, chosen: 0, correct: rate >= 0.5 })] });
  };
}

describe("the comparison", () => {
  test("spearman is ±1 on monotone ranks and null without an order", () => {
    expect(backfill.spearman([0.1, 0.2, 0.3, 0.4], [0.2, 0.4, 0.6, 0.9])).toBeCloseTo(1.0, 6);
    expect(backfill.spearman([0.1, 0.2, 0.3], [0.9, 0.5, 0.1])).toBeCloseTo(-1.0, 6);
    expect(backfill.spearman([1.0, 1.0, 0.6, 0.2], [0.9, 0.8, 0.5, 0.1])).toBeCloseTo(0.9486833, 6);
    expect(backfill.spearman([1.0, 1.0, 1.0], [0.1, 0.5, 0.9]), "no order on one side").toBeNull();
    expect(backfill.spearman([0.1, 0.2], [0.1, 0.2]), "too few to mean anything").toBeNull();
  });

  test("the sample takes a type at a time", () => {
    bank();
    const got = backfill.sample(batch.bundles(), 3);
    expect(got.map((it) => it["item_type"])).toEqual(["hyougen", "sougou_dokkai", "hyougen"]);
    expect(backfill.sample(batch.bundles(), 100).length).toBe(4);
  });

  test("a comparison writes nothing", async () => {
    const d = bank();
    const before = _snapshot(d);
    const seen: (string | null)[] = [];
    patch(difficulty, "measure", _measureByModel(
      { "claude-haiku-4-5": [1.0, 0.6, 0.8, 0.2], [JEV]: [0.9, 0.4, 0.7, 0.3] }, seen));
    setEnv("TYPESAFE_API_KEY", "k");
    const summary = path.join(tmpPath(), "s.md");
    capture();

    expect(await cli.main({ argv: ["probe", "--all", "--compare", JEV, "--summary", summary] })).toBe(0);
    expect(_snapshot(d)).toEqual(before);
    expect(seen, "the candidate first on every item").toEqual([JEV, "claude-haiku-4-5", JEV, "claude-haiku-4-5",
                                                               JEV, "claude-haiku-4-5", JEV, "claude-haiku-4-5"]);
    const text = readFileSync(summary, "utf8");
    expect(text).toContain(`| item | type | claude-haiku-4-5 | ${JEV} |`);
    expect(text).toContain("rank agreement (Spearman) over the 4 item(s) both measured: +1.00");
    expect(text).toContain("Nothing was written");
  });

  test("an unreachable candidate costs no baseline calls and stops", async () => {
    bank();
    const seen: (string | null)[] = [];
    patch(difficulty, "measure",
          _measureByModel({ [JEV]: [null, null, null, null], "claude-haiku-4-5": [] }, seen));
    const cmp = await backfill.compareBank(batch.bundles(), JEV, { limit: 4, log: () => {} });
    expect(seen).toEqual(Array(backfill.UNREACHABLE_PATIENCE).fill(JEV));
    expect(cmp.stopped !== null && cmp.stopped.includes("could not be reached")).toBe(true);
    expect(cmp.rows.every(([, , b]) => !b.measured)).toBe(true);
  });

  test("a comparison stops at the ceiling", async () => {
    bank();
    const seen: (string | null)[] = [];
    patch(difficulty, "measure", _measureByModel(
      { "claude-haiku-4-5": [1.0, 1.0, 1.0, 1.0], [JEV]: [0.5, 0.5, 0.5, 0.5] }, seen));
    setConfig({ RUN_MAX_CALLS: 0 });
    const cmp = await backfill.compareBank(batch.bundles(), JEV, { log: () => {} });
    expect(seen).toEqual([]);
    expect(cmp.rows).toEqual([]);
    expect(cmp.stopped).toContain("ceiling");
  });

  test("compare dry run counts both instruments and spends nothing", async () => {
    bank();
    const cap = capture();
    patch(difficulty, "measure", async () => {
      throw new Error("AssertionError: --dry-run must not reach the model");
    });
    expect(await cli.main({ argv: ["probe", "--all", "--compare", JEV, "--dry-run", "--limit", "3"] })).toBe(0);
    const out = cap.readouterr().out;
    expect(out.split("would compare on").length - 1).toBe(3);
    expect(out).toContain("18 call(s) in all, 5 per item to claude-haiku-4-5 and 1 to jev-latest");
    expect(out).toContain("does not resume");
  });

  test("compare refuses what cannot mean anything", async () => {
    bank();
    const cap = capture();
    patch(difficulty, "measure", async () => {
      throw new Error("AssertionError: nothing may be measured");
    });
    delEnv("TYPESAFE_API_KEY");

    expect(await cli.main({ argv: ["probe", "--all", "--compare", "claude-haiku-4-5"] })).toBe(2);
    expect(await cli.main({ argv: ["probe", "--all", "--limit", "3"] })).toBe(2);
    expect(await cli.main({ argv: ["probe", "--all", "--compare", JEV, "--limit", "0"] })).toBe(2);
    expect(await cli.main({ argv: ["probe", "--all", "--compare", JEV] })).toBe(1);
    expect(cap.readouterr().err).toContain("TYPESAFE_API_KEY");
  });
});
