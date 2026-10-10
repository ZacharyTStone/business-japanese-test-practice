/**
 * The confidence probe (bjt/fidelity/difficulty.ts, the default since
 * 2026-10-10): a probability on every option, once per rotation of the
 * options, and the rate is the mean probability on the key. The model is
 * faked, so what is tested is the arithmetic, that the rotation cancels a
 * habit of trusting one position, that a reply which is not a distribution
 * never becomes a rate, and that the bank is re-measured a bundle at a time
 * rather than left holding two kinds of number.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import * as backfill from "../bjt/backfill.ts";
import * as batch from "../bjt/batch.ts";
import * as cli from "../bjt/cli/index.ts";
import * as difficulty from "../bjt/fidelity/difficulty.ts";
import * as llm from "../bjt/llm.ts";
import * as schemas from "../bjt/schemas.ts";
import * as textutil from "../bjt/textutil.ts";
import * as withdrawn from "../bjt/withdrawn.ts";
import type { Item } from "../bjt/types.ts";
import { goiItem } from "./conftest.ts";
import { capture, fakeMessages, patch, setConfig, tmpPath } from "./helpers.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

beforeEach(() => {
  setConfig({ DIFFICULTY_ENABLED: true, DIFFICULTY_METHOD: "confidence", DIFFICULTY_MODEL: "claude-haiku-4-5" });
});

type Confidence = (question: string, options: string[], opts?: { model?: string | null }) => Promise<number[]>;

/** A stand-in for llm.choiceConfidence that records the order it was shown
 *  and answers with `reply(shown)`. */
function confident(reply: (shown: string[]) => number[], seen: string[][] = []): string[][] {
  const fake: Confidence = async (_question, options) => {
    seen.push([...options]);
    return reply(options);
  };
  patch(llm, "choiceConfidence", fake);
  return seen;
}

describe("the confidence probe", () => {
  test("the rate is the mean probability on the key, over every rotation", async () => {
    const item = goiItem();
    const options = textutil.optionTexts(item);
    const key = options[schemas.correctIndex(item["options"])];
    const seen = confident((shown) => shown.map((o) => (o === key ? 0.7 : 0.1)));

    const res = await difficulty.measure(item);

    expect(res.measured).toBe(true);
    expect(res.rate).toBe(0.7);
    expect(res.trials.length).toBe(4);
    expect(res.trials.every((t) => t.correct)).toBe(true);
    // Each option sits in each position exactly once.
    for (let pos = 0; pos < 4; pos++) {
      expect(new Set(seen.map((order) => order[pos])).size).toBe(4);
    }
  });

  test("a habit of trusting the first option cancels out", async () => {
    // 0.4 on whatever is shown first, 0.2 on the rest: the key is first in
    // one rotation of four, so its mean is (0.4 + 3 × 0.2) / 4.
    confident((shown) => shown.map((_o, i) => (i === 0 ? 0.4 : 0.2)));
    const res = await difficulty.measure(goiItem());
    expect(res.rate).toBe(0.25);
  });

  test("a torn model is not a perfect score", async () => {
    // Right every time, but never sure: a pass rate would say 1.0.
    const item = goiItem();
    const options = textutil.optionTexts(item);
    const key = options[schemas.correctIndex(item["options"])];
    confident((shown) => shown.map((o) => (o === key ? 0.55 : 0.15)));
    const res = await difficulty.measure(item);
    expect(res.trials.every((t) => t.correct)).toBe(true);
    expect(res.rate).toBe(0.55);
  });

  test("one reply that is not a distribution leaves the item unmeasured", async () => {
    let n = 0;
    patch(llm, "choiceConfidence", async () => {
      n += 1;
      if (n === 2) throw new llm.LLMError("expected 4 probabilities, got [1]");
      return [0.25, 0.25, 0.25, 0.25];
    });
    const res = await difficulty.measure(goiItem());
    expect(res.measured).toBe(false);
    expect(res.rate).toBeNull();
    expect(res.notes).toContain("expected 4 probabilities");
    expect(n, "no call after the one that failed").toBe(2);
  });

  test("an account that cannot pay stops the run rather than the item", async () => {
    patch(llm, "choiceConfidence", async () => {
      throw new llm.LLMBillingError("credit balance is too low");
    });
    await expect(difficulty.measure(goiItem())).rejects.toThrow(llm.LLMBillingError);
  });

  test("it costs one call per option, and the method names the kind of number", () => {
    expect(difficulty.callsPerItem()).toBe(4);
    expect(difficulty.method()).toBe("confidence");
    expect(difficulty.method("jev-latest")).toBe("jev");
    setConfig({ DIFFICULTY_METHOD: "trials", DIFFICULTY_TRIALS: 5 });
    expect(difficulty.callsPerItem()).toBe(5);
  });
});

describe("the reply", () => {
  /** A reply carrying `probabilities`, as the API would send it. */
  function replying(probabilities: unknown): void {
    fakeMessages(async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ probabilities, reason: "x" }) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }));
  }

  test("is normalised to sum to one", async () => {
    replying([2, 1, 1, 0]);
    expect(await llm.choiceConfidence("q", ["a", "b", "c", "d"], { model: "claude-haiku-4-5" }))
      .toEqual([0.5, 0.25, 0.25, 0]);
  });

  test.each([
    ["too few", [1, 0, 0]],
    ["a negative", [1.2, -0.2, 0, 0]],
    ["not numbers", ["a", "b", "c", "d"]],
    ["all zero", [0, 0, 0, 0]],
  ])("with %s is refused", async (_what, probabilities) => {
    replying(probabilities);
    await expect(llm.choiceConfidence("q", ["a", "b", "c", "d"], { model: "claude-haiku-4-5" }))
      .rejects.toThrow(llm.LLMError);
  });
});

describe("the bank holds one kind of number", () => {
  const SHELF = "hyougen_J3_001.json";

  /** One committed bundle in a batches/ of its own, its rates of the old kind. */
  function oldBank(): string {
    const d = path.join(tmpPath(), "batches");
    mkdirSync(d);
    const bundle = JSON.parse(readFileSync(path.join(ROOT, "batches", SHELF), "utf8"));
    for (const it of bundle["items"]) {
      it["model_p_correct"] = 1.0;
    }
    batch.save(bundle, { path: path.join(d, SHELF) });
    writeFileSync(path.join(d, withdrawn.LEDGER_NAME), "# nothing withdrawn\n", "utf8");
    setConfig({ BATCH_DIR: d });
    patch(llm.state, "spend", new llm.Spend());
    return d;
  }

  function measuredAt(rate: number, seen: string[]): void {
    patch(difficulty, "measure", async (item: Item) => {
      seen.push(item["seed_cell"]["id"]);
      llm.state.spend.beginRequest();
      llm.state.spend.add("claude-haiku-4-5", { input_tokens: 100, output_tokens: 10 });
      return new difficulty.DifficultyResult({ rate, model: "claude-haiku-4-5", measured: true });
    });
  }

  test("a bundle of another kind is measured again, whole, and marked", async () => {
    const d = oldBank();
    const seen: string[] = [];
    measuredAt(0.42, seen);
    capture();
    const n = batch.load(path.join(d, SHELF))["items"].length;

    expect(await cli.main({ argv: ["probe", "--all"] })).toBe(0);

    const after = batch.load(path.join(d, SHELF));
    expect(seen.length).toBe(n);
    expect(after["items"].map((it: Item) => it["model_p_correct"])).toEqual(Array(n).fill(0.42));
    expect(after[backfill.METHOD_KEY]).toBe("confidence");
    // And then there is nothing to do.
    expect(await cli.main({ argv: ["probe", "--all"] })).toBe(0);
    expect(seen.length).toBe(n);
  });

  test("a run stopped inside a bundle leaves no rate of the old kind", async () => {
    const d = oldBank();
    const seen: string[] = [];
    measuredAt(0.42, seen);
    capture();
    setConfig({ RUN_MAX_CALLS: 1 });

    expect(await cli.main({ argv: ["probe", "--all"] })).toBe(0);

    const rates = batch.load(path.join(d, SHELF))["items"].map((it: Item) => it["model_p_correct"] ?? null);
    expect(rates[0]).toBe(0.42);
    expect(rates.slice(1).every((r: number | null) => r === null)).toBe(true);

    // The next run fills exactly what is missing.
    patch(llm.state, "spend", new llm.Spend());
    setConfig({ RUN_MAX_CALLS: 100 });
    expect(await cli.main({ argv: ["probe", "--all"] })).toBe(0);
    expect(new Set(seen).size).toBe(rates.length);
    expect(seen.length).toBe(rates.length);
  });
});
