/**
 * The difficulty probe. The model call is faked, so what is tested is the rate
 * arithmetic, that an unreachable model never yields a number, and — the part the
 * practice queue relies on — that a kept item ships with the probe's rate and an
 * item the probe could not measure falls back to the gate's.
 */
import { beforeEach, describe, expect, test } from "vitest";
import * as fixtures from "../bjt/fixtures.ts";
import * as llm from "../bjt/llm.ts";
import * as pipeline from "../bjt/pipeline.ts";
import { deepcopy } from "../bjt/py.ts";
import * as difficulty from "../bjt/fidelity/difficulty.ts";
import { goiCorrectText, goiItem, store } from "./conftest.ts";
import { patch, setConfig } from "./helpers.ts";

type Answer = (question: string, options: string[], opts?: { model?: string | null }) => Promise<Record<string, any>>;

/** A stand-in for llm.answerChoice that answers the full view from a
 *  fixed pattern of right/wrong per trial, and records the model asked. */
function _answerer(pattern: boolean[], seen: [string | null, string][] | null = null): Answer {
  const calls = pattern[Symbol.iterator]();

  return async (question, options, opts = {}) => {
    const model = opts.model ?? null;
    if (seen !== null) {
      seen.push([model, question]);
    }
    const next = calls.next();
    if (next.done) {
      throw new Error("StopIteration");
    }
    const right = next.value;
    // The item is shuffled by the generator, so find the key by its text.
    const ci = options.indexOf(goiCorrectText());
    return { choice: right ? ci : (ci + 1) % 4, reason: "x" };
  };
}

/** The judge: full right, cold wrong when the item is to be kept; cold right
 *  (leaky) otherwise. The probe's calls are told apart by the model name. */
function _gateAnswerer(kept: boolean): Answer {
  return async (question, options, opts = {}) => {
    const ci = options.indexOf(goiCorrectText());
    if (opts.model === "weak-model") {
      throw new Error("AssertionError: the probe's calls must be stubbed separately");
    }
    const cold = question.includes("withheld");
    if (cold) {
      return { choice: !kept ? ci : (ci + 1) % 4, reason: "x" };
    }
    return { choice: ci, reason: "x" };
  };
}

function _route(gateAnswer: Answer, probeAnswer: Answer): Answer {
  return async (question, options, opts = {}) => {
    if (opts.model === "weak-model") {
      return probeAnswer(question, options, { model: opts.model });
    }
    return gateAnswer(question, options, { model: opts.model });
  };
}

/** `generated`: no proofreader, and a generator that writes the fixture. */
function generated(): void {
  setConfig({ SANITY_ENABLED: false });
  patch(llm, "generateStructured", async () => deepcopy(fixtures.FIXTURES["goi_bunpou"]));
}

describe("difficulty", () => {
  // probe_on (autouse)
  beforeEach(() => {
    setConfig({
      DIFFICULTY_ENABLED: true,
      DIFFICULTY_TRIALS: 5,
      DIFFICULTY_MODEL: "weak-model",
      GATE_TRIALS: 3,
    });
  });

  // ----- the rate -----------------------------------------------------------

  test("rate is the fraction of trials answered correctly", async () => {
    const seen: [string | null, string][] = [];
    patch(llm, "answerChoice", _answerer([true, true, false, true, false], seen));
    const res = await difficulty.measure(goiItem());
    expect(res.measured).toBe(true);
    expect(res.rate).toBeCloseTo(3 / 5);
    expect(res.model).toBe("weak-model");
    expect(res.trials.length === 5 && res.trials.every((t) => t.side === "difficulty")).toBe(true);
    expect(res.detail().includes("weak-model") && res.detail().includes("60%")).toBe(true);
  });

  test("probe asks the difficulty model the full view", async () => {
    // The weak model, not the judge — and the stimulus, not the cold view:
    // a cold-view pass rate would be a leakage number, not a difficulty.
    const item = goiItem();
    const seen: [string | null, string][] = [];
    patch(llm, "answerChoice", _answerer(Array(5).fill(true), seen));
    await difficulty.measure(item);
    expect(new Set(seen.map(([m]) => m))).toEqual(new Set(["weak-model"]));
    expect(seen.every(([, q]) => q.includes(item["stem"]))).toBe(true);
    expect(seen.some(([, q]) => q.includes("withheld"))).toBe(false);
  });

  test("unreachable model is not measured", async () => {
    // An outage yields no rate at all. Zero would tell the queue the item is
    // impossible; one would tell it the item is trivial; both are lies.
    const boom = async () => {
      throw new llm.LLMError("api down");
    };

    patch(llm, "answerChoice", boom);
    const res = await difficulty.measure(goiItem());
    expect(res.measured).toBe(false);
    expect(res.rate).toBeNull();
    expect(res.notes).toContain("did not run");
    expect(res.detail()).toBe("difficulty=unmeasured");
  });

  test("one failed trial leaves the item unmeasured", async () => {
    // A refusal is not a wrong answer. Counting it as one would call the item
    // harder than it is, so a short measurement is no measurement.
    const calls = [true, true, null, true, true][Symbol.iterator]();

    const flaky = async (question: string, options: string[]) => {
      const right = calls.next().value;
      if (right === null) {
        throw new llm.LLMError("refused");
      }
      return { choice: options.indexOf(goiCorrectText()), reason: "x" };
    };

    patch(llm, "answerChoice", flaky);
    const res = await difficulty.measure(goiItem());
    expect(res.measured === false && res.rate === null).toBe(true);
  });

  test("switched off does not call the model", async () => {
    const called: number[] = [];
    setConfig({ DIFFICULTY_ENABLED: false });
    patch(llm, "answerChoice", async () => {
      called.push(1);
      return {};
    });
    const res = await difficulty.measure(goiItem());
    expect(called).toEqual([]);
    expect(res.measured).toBe(false);
    expect(res.detail()).toBe("difficulty=skipped");
  });

  // ----- what ships -----------------------------------------------------------

  test("kept item ships with the probes rate not the gates", async () => {
    const s = store();
    generated();
    const probeCalls: [string | null, string][] = [];
    patch(llm, "answerChoice", _route(
      _gateAnswerer(true),
      _answerer([true, false, false, true, false], probeCalls)));

    const [item, iid, kept, detail] = await pipeline.generateAndGate(s, "goi_bunpou", "J2", { gate: true });

    expect(kept).toBe(true);
    expect(probeCalls.length).toBe(5);
    expect(item["model_p_correct"]).toBeCloseTo(2 / 5);
    const stored = s.getItem(iid)!;
    expect(stored["full_success_rate"], "the gate's own number is untouched").toBe(1.0);
    expect(detail).toContain("difficulty=40% (weak-model)");
    const sides = s.conn.prepare("SELECT side FROM gate_trials WHERE item_id=?").all(iid).map((r) => r["side"]);
    // Two agreeing full trials settle the gate; the probe always runs its five.
    expect(sides.filter((x) => x === "difficulty").length === 5
           && sides.filter((x) => x === "full").length === 2).toBe(true);
  });

  test("unmeasured item falls back to the gates rate", async () => {
    const s = store();
    generated();
    const down = async () => {
      throw new llm.LLMError("api down");
    };

    patch(llm, "answerChoice", _route(_gateAnswerer(true), down));

    const [item, iid, kept, detail] = await pipeline.generateAndGate(s, "goi_bunpou", "J2", { gate: true });

    expect(kept).toBe(true);
    expect(item["model_p_correct"]).toBe(1.0);
    expect(detail).toContain("difficulty=unmeasured");
    const sides = s.conn.prepare("SELECT side FROM gate_trials WHERE item_id=?").all(iid).map((r) => r["side"]);
    expect(sides, "an unmeasured probe leaves no trials behind").not.toContain("difficulty");
  });

  test("switched off leaves the gates rate and makes no call", async () => {
    const s = store();
    generated();
    setConfig({ DIFFICULTY_ENABLED: false });
    const probeCalls: [string | null, string][] = [];
    patch(llm, "answerChoice", _route(
      _gateAnswerer(true), _answerer(Array(5).fill(true), probeCalls)));

    const [item, , kept, detail] = await pipeline.generateAndGate(s, "goi_bunpou", "J2", { gate: true });

    expect(kept).toBe(true);
    expect(probeCalls).toEqual([]);
    expect(item["model_p_correct"]).toBe(1.0);
    expect(detail).not.toContain("difficulty=");
  });

  test("discarded item is never probed", async () => {
    // Cheapest-first: the probe is spend, and a discarded item ships nowhere.
    const s = store();
    generated();
    const probeCalls: [string | null, string][] = [];
    patch(llm, "answerChoice", _route(
      _gateAnswerer(false), _answerer(Array(5).fill(true), probeCalls)));

    const [, , kept, detail] = await pipeline.generateAndGate(s, "goi_bunpou", "J2", { gate: true });

    expect(!kept && detail.includes("discarded:leaky")).toBe(true);
    expect(probeCalls).toEqual([]);
    expect(detail).not.toContain("difficulty=");
  });

  test("probe runs when the gate is skipped", async () => {
    // No gate means no full-view rate to fall back on, which is exactly when a
    // cheap measurement is worth the most.
    const s = store();
    generated();
    const probeCalls: [string | null, string][] = [];
    patch(llm, "answerChoice", _route(
      _gateAnswerer(true), _answerer([true, true, true, true, false], probeCalls)));

    const [item, iid, kept] = await pipeline.generateAndGate(s, "goi_bunpou", "J2", { gate: false });

    expect(kept && probeCalls.length === 5).toBe(true);
    expect(item["model_p_correct"]).toBeCloseTo(4 / 5);
    expect(s.getItem(iid)!["full_success_rate"]).toBeNull();
  });

  test("quality summary reads the probes trials", async () => {
    const s = store();
    generated();
    patch(llm, "answerChoice", _route(
      _gateAnswerer(true), _answerer([true, false, true, false, true])));
    await pipeline.generateAndGate(s, "goi_bunpou", "J2", { gate: true });
    const rows = s.difficultySummary();
    expect(rows).toEqual([{ item_type: "goi_bunpou", avg_rate: expect.closeTo(3 / 5), n: 1 }]);
  });
});
