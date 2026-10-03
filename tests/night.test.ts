/**
 * A night that hits its ceiling keeps what it already paid for.
 *
 * The spend, call and minute ceilings stop a run with an `LLMSpendLimitError`.
 * The shelf that was being written when it came had kept items in memory only,
 * and the stop threw them away: the most expensive way for the cheapest guard to
 * fire. These hold `runBatch` to bundling what it kept before it passes the
 * stop on, and `runNight` to publishing that bundle and ending the night.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as batch from "../bjt/batch.ts";
import * as cli from "../bjt/cli/index.ts";
import * as fixtures from "../bjt/fixtures.ts";
import * as llm from "../bjt/llm.ts";
import * as pipeline from "../bjt/pipeline.ts";
import * as plan from "../bjt/plan.ts";
import * as publish from "../bjt/publish.ts";
import { deepcopy } from "../bjt/py.ts";
import * as answerability from "../bjt/fidelity/answerability.ts";
import * as dedupe from "../bjt/fidelity/dedupe.ts";
import { store } from "./conftest.ts";
import { capture, patch, setConfig, tmpPath } from "./helpers.ts";

/** `night`: a bank in a temporary directory, a generator that writes the
 *  fixture, and no proofreader, gate or probe to fake. */
function night(tmp: string = tmpPath()): string {
  setConfig({ BATCH_DIR: tmp, SANITY_ENABLED: false, DIFFICULTY_ENABLED: false });
  patch(dedupe, "maxSimilarity", () => 0.0);
  return tmp;
}

/** A generator that writes `succeed` drafts and then meets the ceiling. */
function _writer(succeed: number): number[] {
  const calls: number[] = [];

  const generate = async () => {
    calls.push(1);
    if (calls.length > succeed) {
      throw new llm.LLMSpendLimitError("spend ceiling reached: $0.50 of $0.50");
    }
    return deepcopy(fixtures.FIXTURES["goi_bunpou"]);
  };

  patch(llm, "generateStructured", generate);
  return calls;
}

/** `path.with_suffix(".sql")`. */
function _withSuffix(p: string, suffix: string): string {
  return path.join(path.dirname(p), path.basename(p, path.extname(p)) + suffix);
}

describe("night", () => {
  test("the ceiling ends the shelf but not what it kept", async () => {
    const tmp = tmpPath();
    const s = store(tmp);
    const dir = night(tmp);
    _writer(2);
    // force: two copies of one fixture are a near-duplicate pair the bundle
    // check (rightly) refuses; what is tested is that they reach it at all.
    const stop = await pipeline.runBatch(s, "goi_bunpou", "J2", 4, {
      gate: false, sanityCheck: false, force: true, out: path.join(dir, "b.json") })
      .catch((e: unknown) => e);
    expect(stop).toBeInstanceOf(pipeline.ShelfStopped);
    const stopped = stop as pipeline.ShelfStopped;
    // Still a billing error, so every caller that ends a run for one ends it.
    expect(stopped).toBeInstanceOf(llm.LLMBillingError);
    expect(stopped.kept).toBe(2);
    expect(stopped.path !== null && existsSync(stopped.path)).toBe(true);
    expect(batch.load(stopped.path!)["items"].length).toBe(2);
  });

  test("a shelf stopped before it kept anything writes nothing", async () => {
    const tmp = tmpPath();
    const s = store(tmp);
    const dir = night(tmp);
    _writer(0);
    const stop = await pipeline.runBatch(s, "goi_bunpou", "J2", 4, { gate: false, sanityCheck: false })
      .catch((e: unknown) => e);
    expect(stop).toBeInstanceOf(pipeline.ShelfStopped);
    const stopped = stop as pipeline.ShelfStopped;
    expect([stopped.path, stopped.kept]).toEqual([null, 0]);
    expect(readdirSync(dir).filter((n) => n.endsWith(".json"))).toEqual([]);
  });

  test("the night publishes the stopped shelf and goes no further", async () => {
    const tmp = tmpPath();
    const s = store(tmp);
    night(tmp);
    const calls = _writer(1);
    const order = [new plan.WorkItem({ item_type: "goi_bunpou", level: "J2", n: 2, have: 0, cells_left: 50 }),
                   new plan.WorkItem({ item_type: "hyougen", level: "J2", n: 1, have: 0, cells_left: 50 })];

    const result = await pipeline.runNight(s, order, { gate: false, sanityCheck: false });

    expect(result.written.map(([t, lv, n]) => [t, lv, n])).toEqual([["goi_bunpou", "J2", 1]]);
    const p = result.written[0][3];
    expect(existsSync(_withSuffix(p, ".sql")), "the stopped shelf's SQL is written too").toBe(true);
    expect(result.stopped ?? "").toContain("spend ceiling");
    expect(result.failures.some((f) => f.includes("everything after it"))).toBe(true);
    expect(calls.length, "the second shelf was never started").toBe(2);
  });

  test("a night with no stop runs every shelf", async () => {
    const tmp = tmpPath();
    const s = store(tmp);
    night(tmp);
    _writer(99);
    const order = [new plan.WorkItem({ item_type: "goi_bunpou", level: "J2", n: 1, have: 0, cells_left: 50 }),
                   new plan.WorkItem({ item_type: "hyougen", level: "J2", n: 1, have: 0, cells_left: 50 })];
    patch(llm, "generateStructured", async (system: string) => deepcopy(
      fixtures.FIXTURES[system.includes("表現") ? "hyougen" : "goi_bunpou"]));
    const result = await pipeline.runNight(s, order, { gate: false, sanityCheck: false });
    expect(result.stopped).toBeNull();
    expect(result.written.map(([t]) => t)).toEqual(["goi_bunpou", "hyougen"]);
  });

  test("a shelf that writes nothing says why", async () => {
    // "discarded:leaky" said that the options gave the answer away, never how,
    // and the night's pull request said only "nothing passed the gates".
    const tmp = tmpPath();
    const s = store(tmp);
    night(tmp);
    patch(llm, "generateStructured", async () => deepcopy(fixtures.FIXTURES["goi_bunpou"]));
    patch(answerability, "runGate", async () => new answerability.GateResult({
      cold_success_rate: 1.0, full_success_rate: null, verdict: "discarded:leaky",
      trials: [new answerability.Trial({ side: "cold", trial: 0, chosen: 0, correct: true,
                                         reason: "the key is the only option in the past tense" })] }));
    const cap = capture();
    const order = [new plan.WorkItem({ item_type: "goi_bunpou", level: "J2", n: 1, have: 0, cells_left: 50 })];

    const result = await pipeline.runNight(s, order, { gate: true, sanityCheck: false });

    expect(result.written).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("goi_bunpou J2: nothing passed the gates — the last draft: ");
    expect(result.failures[0]).toContain("the key is the only option in the past tense");
    expect(cap.readouterr().out).toContain("why: a reviewer picked the correct option");
  });

  test("the nightly command reports the stopped shelf as written", async () => {
    const tmp = tmpPath();
    store(tmp);
    night(tmp);
    _writer(1);
    patch(plan, "workOrder", () => [
      new plan.WorkItem({ item_type: "goi_bunpou", level: "J2", n: 2, have: 0, cells_left: 50 })]);
    setConfig({ DB_PATH: path.join(tmp, "night.db") });

    const summary = path.join(tmp, "summary.md");
    expect(await cli.main({ argv: ["nightly", "--no-gate", "--no-sanity", "--summary", summary] })).toBe(0);
    const text = readFileSync(summary, "utf8");
    expect(text).toContain("1 × goi_bunpou J2");
    expect(text).toContain("stopped at 1 of 2");
  });

  test("the published sql matches what publish writes", async () => {
    const tmp = tmpPath();
    const s = store(tmp);
    night(tmp);
    _writer(1);
    const order = [new plan.WorkItem({ item_type: "goi_bunpou", level: "J2", n: 2, have: 0, cells_left: 50 })];
    const result = await pipeline.runNight(s, order, { gate: false, sanityCheck: false });
    const p = result.written[0][3];
    const bundle = JSON.parse(readFileSync(p, "utf8"));
    expect(readFileSync(_withSuffix(p, ".sql"), "utf8"))
      .toBe(publish.bundleSql(bundle, path.basename(p, path.extname(p))));
  });
});
