/**
 * The ceilings: what stops a broken night from being an expensive one.
 *
 * Each one is independent of the others on purpose: a dollar ceiling measured
 * from real usage, a call ceiling that needs no price table, a cap on output and
 * effort per call, a cap on the night's size, and a bill in every summary — a
 * bug in any one of them is caught by the rest.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as cli from "../bjt/cli/index.ts";
import * as config from "../bjt/config.ts";
import * as llm from "../bjt/llm.ts";
import * as pipeline from "../bjt/pipeline.ts";
import * as plan from "../bjt/plan.ts";
import { store } from "./conftest.ts";
import { capture, patch, setConfig, useRealSeams } from "./helpers.ts";

function _usage(kw: llm.UsageLike): llm.UsageLike {
  return { ...kw };
}

/** `pytest.approx`: equal within a millionth of the expected value. */
function _approx(received: number, expected: number, message: string = ""): void {
  expect(Math.abs(received - expected), `${message} ${received} ≈ ${expected}`.trim())
    .toBeLessThanOrEqual(Math.max(1e-6 * Math.abs(expected), 1e-12));
}

/** `ledger`: a fresh bill for the test. */
function ledgerFixture(): llm.Spend {
  const fresh = new llm.Spend();
  patch(llm.state, "spend", fresh);
  return fresh;
}

/** `answers`: a client whose every reply is a small, well-formed structured
 *  answer, reporting a usage. Returns the list of requests it saw. */
function answersFixture(): Record<string, any>[] {
  const seen: Record<string, any>[] = [];

  const client = {
    messages: {
      create: async (kw: Record<string, any>) => {
        seen.push(kw);
        return {
          stop_reason: "end_turn", stop_details: null,
          content: [{ type: "text", text: '{"choice": 0, "reason": "x"}' }],
          usage: _usage({ input_tokens: 1000, output_tokens: 200,
                          cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
        };
      },
    },
  };

  patch(llm.seams, "getClient", () => client);
  return seen;
}

/** Python's `str.count`. */
function _count(text: string, sub: string): number {
  return text.split(sub).length - 1;
}

/** `text.index(sub, start)`: a failure when it is not there at all. */
function _index(text: string, sub: string, start: number = 0): number {
  const i = text.indexOf(sub, start);
  expect(i, `${JSON.stringify(sub)} is in the text`).toBeGreaterThanOrEqual(0);
  return i;
}

describe("pricing", () => {
  test("a response is priced from its usage", () => {
    const u = _usage({ input_tokens: 1_000_000, output_tokens: 1_000_000,
                       cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
    _approx(llm.priceUsd("claude-opus-5", u), 30.0);
    _approx(llm.priceUsd("claude-sonnet-5", u), 12.0);
    _approx(llm.priceUsd("claude-haiku-4-5", u), 6.0);
  });

  test("cache writes and reads are priced as the list has them", () => {
    const u = _usage({ input_tokens: 0, output_tokens: 0,
                       cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 });
    // Sonnet: $2 input → $2.50 to write a million, $0.20 to read a million.
    _approx(llm.priceUsd("claude-sonnet-5", u), 2.70);
  });

  test.each([
    // A million in and a million out, at each family's list price.
    ["claude-fable-5-1", 60.0],
    ["claude-fable-5", 60.0],
    ["claude-opus-5-5", 24.0],
    ["claude-opus-5", 30.0],
    ["claude-opus-4-8", 30.0],
    ["claude-opus-4-7", 30.0],
    ["claude-opus-4-6", 30.0],
    ["claude-sonnet-5-5", 12.0],
    ["claude-sonnet-5", 12.0],
    ["claude-sonnet-4-6", 18.0],
    ["claude-haiku-4-5", 6.0],
  ] as [string, number][])("every model in use is priced at its list price [%s]", (model, dollars) => {
    const u = _usage({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
    _approx(llm.priceUsd(model, u), dollars);
  });

  /** Sonnet 4.6 is dearer than the Sonnet 5 family, and Opus 5.5 cheaper
   *  than Opus 5: a shorter prefix matching first priced both wrongly. */
  test("the longest prefix wins", () => {
    expect(llm.ratesFor("claude-sonnet-4-6")).toEqual([3.0, 15.0]);
    expect(llm.ratesFor("claude-opus-5-5")).toEqual([4.0, 20.0]);
    expect(llm.ratesFor("claude-fable-5-1")).toEqual([10.0, 50.0]);
  });

  test("an unknown model is priced above every known one", () => {
    const u = _usage({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
    _approx(llm.priceUsd("claude-something-new", u), 90.0);
    _approx(llm.priceUsd("claude-opus", u), 90.0, "a family name is not a model");
    const rows = Object.values(llm.PRICES_USD_PER_MTOK);
    expect(llm.UNKNOWN_MODEL_USD_PER_MTOK[0]).toBeGreaterThan(Math.max(...rows.map((r) => r[0])));
    expect(llm.UNKNOWN_MODEL_USD_PER_MTOK[1]).toBeGreaterThan(Math.max(...rows.map((r) => r[1])));
  });

  /** A default that falls through to the unknown price would make every
   *  night look five times dearer than it is and stop it early. */
  test("the configured models are all in the table", () => {
    for (const model of [config.GEN_MODEL, config.JUDGE_MODEL, config.SANITY_MODEL,
                         config.DIFFICULTY_MODEL]) {
      expect(llm.ratesFor(model), model).not.toEqual(llm.UNKNOWN_MODEL_USD_PER_MTOK);
    }
  });

  test("a usage with missing fields still prices", () => {
    expect(llm.priceUsd("claude-opus-5", _usage({ output_tokens: null }))).toBe(0.0);
    expect(llm.priceUsd("claude-opus-5", null)).toBe(0.0);
  });
});

// ----- the ledger ---------------------------------------------------------

describe("the ledger", () => {
  test("every call is added to the ledger", async () => {
    const ledger = ledgerFixture();
    answersFixture();
    await llm.answerChoice("q", ["a", "b"], { model: "claude-opus-5" });
    await llm.answerChoice("q", ["a", "b"], { model: "claude-haiku-4-5" });
    expect(ledger.calls).toBe(2);
    expect(ledger.input_tokens === 2000 && ledger.output_tokens === 400).toBe(true);
    _approx(ledger.usd, 0.005 + 0.005 + 0.001 + 0.001);
    expect(new Set(Object.keys(ledger.calls_by_model))).toEqual(new Set(["claude-opus-5", "claude-haiku-4-5"]));
    expect(ledger.report().includes("claude-opus-5") && ledger.report().includes("$0.01")).toBe(true);
  });

  test("the dollar ceiling stops the next call not the last", async () => {
    ledgerFixture();
    const answers = answersFixture();
    // Each Opus call above costs one cent; a ceiling of 2.5 cents allows
    // three (the third crosses it) and refuses the fourth before it is made.
    setConfig({ RUN_BUDGET_USD: 0.025 });
    for (let i = 0; i < 3; i++) {
      await llm.answerChoice("q", ["a", "b"], { model: "claude-opus-5" });
    }
    const err = await llm.answerChoice("q", ["a", "b"], { model: "claude-opus-5" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(llm.LLMSpendLimitError);
    expect(answers.length, "the refused call never reached the API").toBe(3);
    const text = (err as Error).message;
    expect(text.includes("spend ceiling") && text.includes("BJT_RUN_BUDGET_USD")).toBe(true);
  });

  test("the call ceiling needs no price table", async () => {
    ledgerFixture();
    const answers = answersFixture();
    setConfig({ RUN_MAX_CALLS: 2, RUN_BUDGET_USD: 1000.0 });
    await llm.answerChoice("q", ["a"], { model: "claude-opus-5" });
    await llm.answerChoice("q", ["a"], { model: "claude-opus-5" });
    const err = await llm.answerChoice("q", ["a"], { model: "claude-opus-5" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(llm.LLMSpendLimitError);
    expect(answers.length === 2 && (err as Error).message.includes("call ceiling")).toBe(true);
  });

  test("a paid for refusal is still on the bill", async () => {
    const ledger = ledgerFixture();
    const client = {
      messages: {
        create: async () => ({ stop_reason: "refusal", stop_details: "no", content: [],
                               usage: _usage({ input_tokens: 500, output_tokens: 0 }) }),
      },
    };

    patch(llm.seams, "getClient", () => client);
    await expect(llm.answerChoice("q", ["a"], { model: "claude-opus-5" })).rejects.toThrow(llm.LLMError);
    expect(ledger.calls).toBe(1);
    _approx(ledger.usd, 0.0025);
  });

  /** The nightly loop and runBatch already stop for an empty account; the
   *  ceiling reuses that path rather than adding a second one to forget. */
  test("the spend limit is a billing error so the run stops", async () => {
    const s = store();
    capture();
    expect(llm.LLMSpendLimitError.prototype instanceof llm.LLMBillingError).toBe(true);
    const calls: number[] = [];

    const over = async (): Promise<Record<string, any>> => {
      calls.push(1);
      throw new llm.LLMSpendLimitError("spend ceiling reached");
    };

    patch(llm, "generateStructured", over);
    setConfig({ SANITY_ENABLED: false });
    await expect(pipeline.runBatch(s, "goi_bunpou", "J2", 4, { gate: false, sanityCheck: false }))
      .rejects.toThrow(llm.LLMBillingError);
    expect(calls.length).toBe(1);
  });
});

// ----- per call -----------------------------------------------------------

describe("per call", () => {
  test("no call may ask for more output than the ceiling", () => {
    setConfig({ MAX_TOKENS_CEILING: 4000 });
    let p = llm.requestParams("claude-sonnet-5", "s", "u", { "type": "object" },
                              { maxTokens: 64000, effort: "medium" });
    expect(p["max_tokens"]).toBe(4000);
    p = llm.requestParams("claude-sonnet-5", "s", "u", { "type": "object" },
                          { maxTokens: 1200, effort: "medium" });
    expect(p["max_tokens"]).toBe(1200);
  });

  test("no generation may think harder than the ceiling", () => {
    setConfig({ EFFORT_CEILING: "high" });
    for (const [asked, got] of [["low", "low"], ["high", "high"], ["xhigh", "high"], ["max", "high"]]) {
      const p = llm.requestParams("claude-opus-5", "s", "u", { "type": "object" },
                                  { maxTokens: 100, effort: asked });
      expect(p["output_config"]["effort"], asked).toBe(got);
    }
    setConfig({ EFFORT_CEILING: "medium" });
    expect(llm.clampEffort("high")).toBe("medium");
    expect(llm.clampEffort("nonsense")).toBe("medium");
  });

  test("the generator env cannot lift the effort ceiling", async () => {
    const seen: Record<string, any> = {};

    const client = {
      messages: {
        create: async (kw: Record<string, any>) => {
          Object.assign(seen, kw);
          throw new Anthropic.APIConnectionError({ message: undefined });
        },
      },
    };

    patch(llm.seams, "getClient", () => client);
    setConfig({ GEN_EFFORT: "max" }); // as BJT_GEN_EFFORT=max would
    setConfig({ EFFORT_CEILING: "high" });
    await expect(llm.generateStructured("s", "u", { "type": "object" })).rejects.toThrow(llm.LLMError);
    expect(seen["output_config"]["effort"]).toBe("high");
    expect(seen["max_tokens"]).toBeLessThanOrEqual(config.MAX_TOKENS_CEILING);
  });
});

// ----- per night ----------------------------------------------------------

describe("per night", () => {
  test("the night is clamped to its ceiling", () => {
    const cap = capture();
    setConfig({ NIGHT_MAX_BUDGET: 24, NIGHT_MAX_PER_SLOT: 6 });
    expect(cli.clampNight(12, 4)).toEqual([12, 4]);
    expect(cli.clampNight(99, 99)).toEqual([24, 6]);
    expect(cli.clampNight(-3, 0)).toEqual([0, 0]);
    expect(cap.readouterr().err).toContain("clamped");
  });

  test("the summary carries the bill", () => {
    const ledger = ledgerFixture();
    ledger.add("claude-sonnet-5", _usage({ input_tokens: 100_000, output_tokens: 10_000 }));
    const text = cli._nightlySummary([], ["x: y"], { spend: ledger });
    expect(text).toContain("What tonight cost");
    expect(text.includes("$0.30") && text.includes("claude-sonnet-5")).toBe(true);
  });

  test("the time ceiling stops the next call", async () => {
    const ledger = ledgerFixture();
    const answers = answersFixture();
    setConfig({ RUN_MAX_MINUTES: 30 });
    await llm.answerChoice("q", ["a"], { model: "claude-sonnet-5" });
    ledger.started -= 31 * 60; // thirty-one minutes ago
    const err = await llm.answerChoice("q", ["a"], { model: "claude-sonnet-5" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(llm.LLMSpendLimitError);
    expect(answers.length === 1 && (err as Error).message.includes("time ceiling")).toBe(true);
  });

  /** pytest's `unmocked_seams`: the real `getClient`, building the real SDK
   *  client, whose settings are read back from it. (Python replaced the SDK
   *  module with a fake that recorded its keyword arguments; the TypeScript
   *  SDK's client keeps both, and its timeout is in milliseconds.) */
  test("the client has a timeout and few retries", () => {
    useRealSeams();
    patch(llm.state, "client", null);
    const client = llm.seams.getClient() as unknown as { timeout: number; maxRetries: number };
    // The SDK retries nothing: every retry is made by llm._structured, through
    // the ceilings and onto the request count (tests/retries.test.ts).
    expect({ timeout: client.timeout, max_retries: client.maxRetries })
      .toEqual({ timeout: config.API_TIMEOUT_SECONDS * 1000, max_retries: 0 });
    expect(config.API_TIMEOUT_SECONDS <= 600 && config.API_MAX_RETRIES <= 2).toBe(true);
  });

  test("the defaults are the stated ones", () => {
    expect(config.RUN_BUDGET_USD).toBe(2.0);
    expect(config.RUN_MAX_CALLS).toBe(500);
    expect(config.RUN_MAX_MINUTES).toBe(30);
    expect(config.MAX_TOKENS_CEILING).toBe(8000);
    expect(config.EFFORT_CEILING).toBe("high");
    expect([config.NIGHT_MAX_BUDGET, config.NIGHT_MAX_PER_SLOT]).toEqual([24, 6]);
  });
});

// ----- the workflow -------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, "..");

function _nightly(): string {
  return readFileSync(path.join(ROOT, ".github/workflows/nightly.yml"), "utf8");
}

/** One step of the nightly job, from its name to the next step. */
function _step(text: string, name: string): string {
  const start = _index(text, `name: ${name}`);
  return text.slice(start, _index(text, "- name:", start + 1));
}

describe("the workflow", () => {
  /** The guards that live in YAML rather than code, asserted so that an
   *  edit to the workflow cannot drop one without a test noticing. Read as
   *  text, not parsed: the check needs no YAML library, and the file is
   *  simple enough for a line to say what it means. */
  test("the workflow keeps its guards", () => {
    const text = _nightly();

    const clock = /^\s+timeout-minutes:\s*(\d+)\s*$/m.exec(text);
    expect(clock, "the job has a clock").not.toBeNull();
    expect(Number(clock![1]), "a night is minutes, not hours").toBeLessThanOrEqual(60);
    expect(Number(clock![1]), "the process stops itself first").toBeGreaterThan(config.RUN_MAX_MINUTES);

    expect(/^\s+BJT_RUN_BUDGET_USD:/m.test(text), "the dollar ceiling is set for the run").toBe(true);
    expect(/^\s+max_usd:/m.test(text)).toBe(true);

    const keep = _index(text, "name: keep tonight's work whatever happens next");
    const keepBlock = text.slice(keep, _index(text, "- name:", keep + 1));
    expect(/if:\s*always\(\)/.test(keepBlock), "the artifact is saved even when a later step fails").toBe(true);
    expect(keepBlock).toContain("batches");

    const pr = _index(text, "name: open the night's pull request");
    const prBlock = text.slice(pr, _index(text, "\n  verify:", pr));
    expect(prBlock.includes("git rebase") && prBlock.includes("git fetch origin"),
           "tonight's commit sits on today's main").toBe(true);

    // Nobody reviews a night any more (2026-10-02), so the merge is guarded by
    // the checks instead: it waits for the whole `checks` workflow on tonight's
    // branch, and it does not merge into a `main` that moved while it ran.
    const verify = text.slice(_index(text, "\n  verify:"), _index(text, "\n  publish:"));
    expect(verify, "the night is checked by the checks workflow").toContain("uses: ./.github/workflows/checks.yml");
    expect(verify, "on tonight's branch, not on main").toContain("needs.nightly.outputs.branch");
    const publish = text.slice(_index(text, "\n  publish:"), _index(text, "\n  held:"));
    expect(/needs:\s*\[nightly, verify\]/.test(publish), "the merge waits for the checks").toBe(true);
    expect(publish, "a main that moved meanwhile is not merged into").toContain('"$now" != "$BASE"');
    expect(_index(publish, "gh pr merge"), "deploy after the merge")
      .toBeLessThan(_index(publish, "gh workflow run deploy-db.yml"));

    // What a night may spend is bounded by the ceilings above and nothing
    // else: no check on other branches decides whether it runs, so a leftover
    // branch cannot hold a night back.
    const unlocked = _index(text, "name: which of tonight's work is unlocked");
    const unlockedBlock = text.slice(unlocked, _index(text, "- name:", unlocked + 1));
    expect(unlockedBlock).not.toContain("content/nightly-*");
  });

  /** The nights run on a schedule, and they stay very cheap. A scheduled
   *  night is one nobody is watching, so both prices it can run at are held
   *  here — the env fallback, which is what a schedule pays because a schedule
   *  has no inputs, and the `max_usd` default, which is what a manual run pays
   *  when nobody types a number. An edit that makes the nights dear has to
   *  change this test to do it. */
  test("the nights run on a schedule and stay cheap", () => {
    const text = _nightly();

    const on = text.slice(_index(text, "\non:\n"), _index(text, "\nconcurrency:"));
    expect(/^  schedule:\n(?:\s*#.*\n)*\s+- cron: "[^"]+"/m.test(on), "the nights are on").toBe(true);

    const fallback = /^\s+BJT_RUN_BUDGET_USD:.*\|\|\s*'([\d.]+)'/m.exec(text);
    expect(fallback, "BJT_RUN_BUDGET_USD falls back to a literal when no input is given").not.toBeNull();
    expect(Number(fallback![1])).toBeLessThanOrEqual(0.5);

    const block = /^ {6}max_usd:\n(?: {8}.*\n)+/m.exec(text);
    expect(block, "workflow_dispatch has an input named max_usd").not.toBeNull();
    const dflt = /default:\s*"([\d.]+)"/.exec(block![0]);
    expect(dflt !== null && Number(dflt[1]) <= 0.5).toBe(true);
  });

  /** The difficulty probe rides the nightly job — the same ceilings, the same
   *  artifact, checks and pull request — but only when somebody asks for it
   *  from the Actions tab: inputs exist only on a manual run, so a scheduled
   *  night can never turn into a probe. A probe run writes no items, draws no
   *  pictures and points the database at nothing.
   *
   *  The workflow runs the Node command line now: `node bjt/main.ts probe`
   *  where the Python test looked for `python -m bjt probe`. */
  test("the probe is a manual run that does nothing else", () => {
    const text = _nightly();
    const step = (name: string) => _step(text, name);

    const keys = step("which of tonight's work is unlocked");
    expect(keys).toContain('[ "$GITHUB_EVENT_NAME" = "workflow_dispatch" ] && '
                           + '[ "${{ github.event.inputs.probe }}" = "true" ]; then probe=true');
    expect(keys).toContain('if [ "$probe" = "true" ]; then\n            echo "art=false"');

    const probe = step("measure the difficulty the bank is missing");
    expect(probe).toContain("if: steps.keys.outputs.probe == 'true'");
    expect(probe).toContain("node bjt/main.ts probe --all");
    expect(probe).not.toContain("psql");
    expect(step("write tonight's items")).toContain("if: steps.keys.outputs.write == 'true'");
    // The ceilings are the job's env, so the probe runs under them like a night.
    expect(_index(text, "BJT_RUN_BUDGET_USD:")).toBeLessThan(_index(text, "name: measure the difficulty"));
  });

  /** A comparison run spends under the same ceilings and leaves nothing
   *  behind: no commit, no pull request, no pictures, no database write. The
   *  TYPESAFE key reaches only the steps that may call the probe, and which
   *  model is the probe is one repository variable for the whole job. */
  test("the jev comparison writes nothing and the key stays in its steps", () => {
    const text = _nightly();
    const step = (name: string) => _step(text, name);

    const keys = step("which of tonight's work is unlocked");
    expect(keys).toContain('if [ "$compare" = "true" ]; then\n            echo "go=false"');
    expect(keys, "compare wins over probe").toContain("compare=true; probe=false");

    const compare = step("compare the difficulty probe with Jev");
    expect(compare).toContain("if: steps.keys.outputs.compare == 'true'");
    expect(compare).toContain("node bjt/main.ts probe --all --compare jev-latest");
    expect(compare, "the baseline is the default model").toContain('BJT_DIFFICULTY_MODEL: ""');
    for (const forbidden of ["psql", "git ", "gh pr"]) {
      expect(compare).not.toContain(forbidden);
    }
    expect(step("recount how hard each item is")).toContain("compare_jev != 'true'");

    const jobEnv = text.slice(_index(text, "timeout-minutes:"), _index(text, "    steps:"));
    expect(jobEnv).toContain("BJT_DIFFICULTY_MODEL: ${{ vars.BJT_DIFFICULTY_MODEL }}");
    expect(jobEnv).not.toContain("TYPESAFE");
    const holders = ["write tonight's items", "measure the difficulty the bank is missing",
                     "compare the difficulty probe with Jev"]
      .filter((name) => step(name).includes("TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}"));
    expect(holders.length).toBe(3);
    expect(_count(text, "secrets.TYPESAFE_API_KEY"), "three steps and the presence check").toBe(4);
  });

  /** `plan.ts` and `nightly.yml` each hold their own copy of the same three
   *  numbers (as a default in code and as a YAML `workflow_dispatch` default
   *  plus its `||` env fallback). Bumping one side alone raises no runtime
   *  error: it would just make a scheduled or default-input run write a
   *  different night than `bjt plan` reports. */
  test("the workflow agrees with plan on a nights size", () => {
    const text = _nightly();

    const dispatchDefault = (key: string): string => {
      const block = new RegExp(`^ {6}${key}:\\n(?: {8}.*\\n)+`, "m").exec(text);
      expect(block, `workflow_dispatch has an input named ${key}`).not.toBeNull();
      const dflt = /default:\s*"(\d+)"/.exec(block![0]);
      expect(dflt, `${key} has a numeric default`).not.toBeNull();
      return dflt![1];
    };

    const envFallback = (name: string): string => {
      const line = new RegExp(`^\\s+${name}:.*\\|\\|\\s*'(\\d+)'`, "m").exec(text);
      expect(line, `${name} falls back to a literal when no input is given`).not.toBeNull();
      return line![1];
    };

    expect(dispatchDefault("budget")).toBe(String(plan.DEFAULT_BUDGET));
    expect(dispatchDefault("per_slot")).toBe(String(plan.DEFAULT_PER_SLOT));
    expect(dispatchDefault("reading_min")).toBe(String(plan.DEFAULT_READING_MIN));

    expect(envFallback("BUDGET")).toBe(String(plan.DEFAULT_BUDGET));
    expect(envFallback("PER_SLOT")).toBe(String(plan.DEFAULT_PER_SLOT));
    expect(envFallback("READING_MIN")).toBe(String(plan.DEFAULT_READING_MIN));
  });
});
