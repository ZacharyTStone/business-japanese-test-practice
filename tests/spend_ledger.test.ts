/**
 * One job, one budget, one clock: `BJT_SPEND_LEDGER`.
 *
 * The nightly job runs `bjt nightly` and then `bjt scenes`, two processes, and
 * each used to start with its own fifty cents and its own half-hour. With the
 * ledger set, the second starts where the first stopped.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import * as http from "../bjt/http.ts";
import * as jev from "../bjt/jev.ts";
import * as llm from "../bjt/llm.ts";
import { time } from "../bjt/py.ts";
import { delEnv, patch, setConfig, setEnv, tmpPath } from "./helpers.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

/** `shared`: the job's ledger file, named in the environment (not yet made). */
function sharedFixture(tmp: string = tmpPath()): string {
  const p = path.join(tmp, "night", "spend.json");
  setEnv(llm.LEDGER_ENV, p);
  return p;
}

function _usage(i: number = 100_000, o: number = 10_000): llm.UsageLike {
  return { input_tokens: i, output_tokens: o };
}

const readJson = (p: string): Record<string, any> => JSON.parse(readFileSync(p, "utf8"));

describe("spend ledger", () => {
  test("the second process starts where the first stopped", () => {
    const shared = sharedFixture();
    const first = llm.Spend.fromEnvironment();
    first.beginRequest();
    first.add("claude-sonnet-5", _usage());
    const data = readJson(shared);
    expect(Object.keys(data).sort()).toEqual(["attempts", "calls", "started_at", "usd"]);
    expect(data["usd"]).toBeCloseTo(0.3);
    expect(data["calls"]).toBe(1);
    expect(data["attempts"]).toBe(1);
    expect(data["started_at"]).toBe(first.started);

    const second = llm.Spend.fromEnvironment();  // what a fresh process builds at import
    expect(second.usd).toBeCloseTo(0.3);
    expect([second.calls, second.attempts]).toEqual([1, 1]);
    expect(second.started, "one clock for the job").toBe(first.started);
    expect(second.report()).toContain("earlier steps of this job");

    setConfig({ RUN_BUDGET_USD: 0.25 });
    expect(() => second.checkCeilings()).toThrow(llm.LLMSpendLimitError);
    expect(() => second.checkCeilings()).toThrow(/spend ceiling/);
  });

  test("the clock is the jobs not the process", () => {
    sharedFixture();
    setConfig({ RUN_MAX_MINUTES: 30 });
    const first = llm.Spend.fromEnvironment();
    first.started = time() - 31 * 60;
    first.save();
    const err = (() => {
      try {
        llm.Spend.fromEnvironment().checkCeilings();
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(llm.LLMSpendLimitError);
    expect((err as Error).message).toMatch(/time ceiling/);
  });

  test("the call ceiling is shared", () => {
    sharedFixture();
    setConfig({ RUN_MAX_CALLS: 2 });
    const first = llm.Spend.fromEnvironment();
    first.beginRequest();
    first.beginRequest();
    const next = llm.Spend.fromEnvironment();
    expect(() => next.beginRequest()).toThrow(llm.LLMSpendLimitError);
    expect(() => next.beginRequest()).toThrow(/call ceiling/);
  });

  test("an unreadable ledger spends nothing", () => {
    const shared = sharedFixture();
    mkdirSync(path.dirname(shared), { recursive: true });
    writeFileSync(shared, "{not json", "utf8");
    const spend = llm.Spend.fromEnvironment();
    expect(() => spend.beginRequest()).toThrow(llm.LLMSpendLimitError);
    expect(() => spend.beginRequest()).toThrow(/cannot be read/);
    expect(readFileSync(shared, "utf8"), "an unreadable ledger is left for a person").toBe("{not json");
  });

  test.each([
    '{"usd": -1, "calls": 0, "attempts": 0, "started_at": 1}',
    '{"usd": 0.1, "calls": 0}',
    '{"usd": NaN, "calls": 0, "attempts": 0, "started_at": 1}',
  ])("a ledger with a wrong number is unreadable %s", (body) => {
    const shared = sharedFixture();
    mkdirSync(path.dirname(shared), { recursive: true });
    writeFileSync(shared, body, "utf8");
    expect(() => llm.Spend.fromEnvironment().checkCeilings()).toThrow(llm.LLMSpendLimitError);
  });

  test("unset is a process on its own", () => {
    const tmp = tmpPath();
    delEnv(llm.LEDGER_ENV);
    const spend = llm.Spend.fromEnvironment();
    spend.beginRequest();
    spend.add("claude-sonnet-5", _usage());
    expect(spend.ledger).toBeNull();
    expect(readdirSync(tmp)).toEqual([]);
  });

  test("the write is whole or nothing", () => {
    const shared = sharedFixture();
    const spend = llm.Spend.fromEnvironment();
    for (let n = 0; n < 5; n++) {
      spend.beginRequest();
      spend.add("claude-haiku-4-5", _usage(10, 10));
    }
    expect(readdirSync(path.dirname(shared)), "no temp file left behind").toEqual([path.basename(shared)]);
    expect(readJson(shared)["attempts"]).toBe(5);
  });

  test("jev is held to the shared ledger", async () => {
    sharedFixture();
    const first = llm.Spend.fromEnvironment();
    first.beginRequest();
    first.add("claude-sonnet-5", _usage(1_000_000, 0));
    setConfig({ RUN_BUDGET_USD: 1.0 });
    patch(llm.state, "spend", llm.Spend.fromEnvironment());
    setEnv("TYPESAFE_API_KEY", "k");
    const posted: unknown[][] = [];
    patch(http, "request", async (...a: unknown[]) => {
      posted.push(a);
      return new TextEncoder().encode("{}");
    });
    await expect(jev.choiceProbabilities("q", ["a", "b"], { model: "jev-latest" })).rejects.toThrow(llm.LLMSpendLimitError);
    expect(posted).toEqual([]);
  });

  /** One step of the job as a process of its own: `code` is the body of a
   *  module that has `llm` (bjt/llm.ts) and `print` (bjt/py.ts) imported. */
  function _run(code: string, ledger: string): SpawnSyncReturns<string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      if (["ANTHROPIC_", "OPENAI_", "TYPESAFE_", "R2_", "CLOUDFLARE_"].some((p) => k.startsWith(p))) continue;
      env[k] = v;
    }
    env[llm.LEDGER_ENV] = ledger;
    env["BJT_RUN_BUDGET_USD"] = "0.5";
    const script = path.join(path.dirname(ledger), `step-${readdirSync(path.dirname(ledger)).length}.ts`);
    writeFileSync(script, (
      `import * as llm from ${JSON.stringify(pathToFileURL(path.join(ROOT, "bjt", "llm.ts")).href)};\n`
      + `import { print } from ${JSON.stringify(pathToFileURL(path.join(ROOT, "bjt", "py.ts")).href)};\n`
      + code
    ), "utf8");
    return spawnSync(process.execPath, [script], { cwd: ROOT, env: env, encoding: "utf8", timeout: 60_000 });
  }

  test("two real processes share one night", () => {
    // Two processes, as the workflow's two steps are: the first spends
    // forty cents and exits; the second may not spend the other fifty.
    const ledger = path.join(tmpPath(), "spend.json");
    const first = _run(
      "llm.state.spend.beginRequest();\n"
      + "llm.state.spend.add('claude-sonnet-5', { input_tokens: 200_000, output_tokens: 0 });\n"
      + "llm.state.spend.beginRequest();\n"
      + "llm.state.spend.add('claude-sonnet-5', { input_tokens: 0, output_tokens: 0 });\n", ledger);
    expect(first.status, first.stderr).toBe(0);
    expect(readJson(ledger)["usd"]).toBeCloseTo(0.4);

    const second = _run(
      "llm.state.spend.beginRequest();\n"
      + "llm.state.spend.add('claude-sonnet-5', { input_tokens: 100_000, output_tokens: 0 });\n"
      + "try {\n"
      + "  llm.state.spend.beginRequest();\n"
      + "} catch (e) {\n"
      + "  if (!(e instanceof llm.LLMSpendLimitError)) throw e;\n"
      + "  print('stopped:', e);\n"
      + "}\n", ledger);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("stopped: spend ceiling reached: $0.60 of $0.50");
    const data = readJson(ledger);
    expect(data["calls"] === 3 && data["attempts"] === 3).toBe(true);
  });
});
