/**
 * A gate whose judge did not answer has checked nothing.
 *
 * Scored as a wrong answer, an unanswered cold trial reads as a clean cold side,
 * and two of them settled "not leaky" before the full side was asked; an item
 * whose judge was down all night walked through. These hold the gate, the
 * pipeline and the model wrapper to "unchecked": not kept, and nothing told to
 * the next draft, because nothing was found.
 */
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import * as fixtures from "../bjt/fixtures.ts";
import * as llm from "../bjt/llm.ts";
import * as pipeline from "../bjt/pipeline.ts";
import { deepcopy, errText } from "../bjt/py.ts";
import * as schemas from "../bjt/schemas.ts";
import * as answerability from "../bjt/fidelity/answerability.ts";
import { Generator } from "../bjt/generators/base.ts";
import type * as seedtable from "../bjt/seedtable.ts";
import { goiItem, store } from "./conftest.ts";
import { patch, setConfig, tmpPath } from "./helpers.ts";

type Item = Record<string, any>;

function _judge(
  item: Item,
  opts: { coldFails?: boolean; fullFails?: boolean; asked?: string[] | null } = {},
): (question: string, options: string[], o?: { model?: string | null }) => Promise<Item> {
  const ci = schemas.correctIndex(item["options"]);
  const correct = item["options"][ci]["text"];
  const asked = opts.asked ?? null;

  return async (question, options) => {
    const cold = question.includes("withheld");
    if (asked !== null) {
      asked.push(cold ? "cold" : "full");
    }
    if ((cold && opts.coldFails) || (!cold && opts.fullFails)) {
      throw new llm.LLMError("API request failed: overloaded");
    }
    const key = options.indexOf(correct);
    return { choice: cold ? (key + 1) % 4 : key, reason: "x" };
  };
}

describe("unchecked gate", () => {
  // three_trials (autouse)
  beforeEach(() => {
    setConfig({ GATE_TRIALS: 3, SANITY_ENABLED: false, DIFFICULTY_ENABLED: false });
  });

  test("a failing cold trial leaves the item unchecked", async () => {
    const item = goiItem();
    const asked: string[] = [];
    patch(llm, "answerChoice", _judge(item, { coldFails: true, asked }));
    const res = await answerability.runGate(item);
    expect(res.verdict).toBe(answerability.UNCHECKED);
    expect(res.kept).toBe(false);
    expect(res.cold_success_rate === null && res.full_success_rate === null).toBe(true);
    // One unanswered trial settles it: nothing after it is bought, and the
    // full side is never asked on the strength of a cold side nobody read.
    expect(asked).toEqual(["cold"]);
  });

  test("a failing full trial leaves the item unchecked", async () => {
    const item = goiItem();
    patch(llm, "answerChoice", _judge(item, { fullFails: true }));
    const res = await answerability.runGate(item);
    expect(res.verdict).toBe(answerability.UNCHECKED);
    // Two clean cold trials settle the cold side; the first full trial fails.
    expect(res.trials.map((t) => t.side)).toEqual(["full", "cold", "cold"]);
  });

  test("an unchecked draft is not kept and tells the next one nothing", async () => {
    const s = store();
    const item = deepcopy(fixtures.FIXTURES["goi_bunpou"]);
    patch(llm, "generateStructured", async () => deepcopy(item));
    patch(llm, "answerChoice", _judge(item, { coldFails: true }));

    const [, iid, kept, detail, reason] = await pipeline.generateAndGate(s, "goi_bunpou", "J2", { gate: true });
    expect(kept).toBe(false);
    expect(reason, "an outage is not a fault for the next draft to fix").toBeNull();
    expect(detail).toContain("verdict=unchecked");
    expect(s.getItem(iid)!["gate_verdict"]).toBe("unchecked");
  });

  test("a gate result that claims kept over an unanswered trial is not trusted", async () => {
    const s = store();
    const item = deepcopy(fixtures.FIXTURES["goi_bunpou"]);
    patch(llm, "generateStructured", async () => deepcopy(item));
    patch(answerability, "runGate", async () => new answerability.GateResult({
      cold_success_rate: 0.0, full_success_rate: 1.0, verdict: "kept", trials: [
        new answerability.Trial({ side: "cold", trial: 0, chosen: null, correct: false }),
        new answerability.Trial({ side: "full", trial: 0, chosen: 1, correct: true })] }));
    const [, , kept, , reason] = await pipeline.generateAndGate(s, "goi_bunpou", "J2", { gate: true });
    expect(!kept && reason === null).toBe(true);
  });

  test("a run of unchecked drafts sends no feedback", async () => {
    const tmp = tmpPath();
    const s = store(tmp);
    const item = deepcopy(fixtures.FIXTURES["goi_bunpou"]);
    const told: (string | null)[] = [];

    const generate = async function (
      this: Generator,
      opts: { level?: string | null; cell?: seedtable.Cell | null; feedback?: string | null } = {},
    ): Promise<Item> {
      told.push(opts.feedback ?? null);
      return deepcopy(item);
    };

    patch(Generator.prototype, "generate", generate);
    patch(llm, "answerChoice", _judge(item, { coldFails: true }));
    setConfig({ SLOT_PATIENCE: 3 });
    const [p, kept] = await pipeline.runBatch(s, "goi_bunpou", "J2", 1, {
      gate: true, sanityCheck: false, out: path.join(tmp, "b.json") });
    expect([p, kept]).toEqual([null, 0]);
    expect(told).toEqual([null, null, null]);
  });

  test("a reply cut off at its ceiling is its own error and is billed", async () => {
    const fresh = new llm.Spend();
    patch(llm.state, "spend", fresh);

    const client = {
      messages: {
        create: async () => ({
          stop_reason: "max_tokens", stop_details: null,
          content: [{ type: "text", text: '{"choice": 1, "reason": "becau' }],
          usage: { input_tokens: 100, output_tokens: 1500 },
        }),
      },
    };

    patch(llm.seams, "getClient", () => client);
    const err = await llm.answerChoice("q", ["a", "b"], { model: "claude-sonnet-5" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(llm.LLMTruncatedError);
    expect(errText(err)).toContain("max_tokens");
    expect(err).toBeInstanceOf(llm.LLMError);
    expect(fresh.calls === 1 && fresh.usd > 0).toBe(true);
  });

  test("a truncated judge reply is an unanswered trial", async () => {
    const cutOff = async () => {
      throw new llm.LLMTruncatedError("reply cut off (max_tokens)");
    };

    patch(llm, "answerChoice", cutOff);
    expect((await answerability.runGate(goiItem())).verdict).toBe(answerability.UNCHECKED);
  });
});
