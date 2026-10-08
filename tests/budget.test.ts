/**
 * The guards that keep a bad night from being an expensive one.
 *
 * Three of them: a shelf that discards three drafts in a row is abandoned
 * rather than paid for three more times; an
 * account that cannot pay ends the run rather than failing every remaining
 * shelf the same way; and the generator's prompt is sent in the shape that
 * caches, at the effort the bill can afford.
 */
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import * as config from "../bjt/config.ts";
import * as fixtures from "../bjt/fixtures.ts";
import * as llm from "../bjt/llm.ts";
import * as pipeline from "../bjt/pipeline.ts";
import * as plan from "../bjt/plan.ts";
import { deepcopy } from "../bjt/py.ts";
import * as schemas from "../bjt/schemas.ts";
import * as answerability from "../bjt/fidelity/answerability.ts";
import * as dedupe from "../bjt/fidelity/dedupe.ts";
import { type Generator, type Item } from "../bjt/generators/base.ts";
import { getGenerator } from "../bjt/generators/index.ts";
import type * as seedtable from "../bjt/seedtable.ts";
import { store } from "./conftest.ts";
import { patch, setConfig, tmpPath } from "./helpers.ts";

/** `quiet`: no proofreader, no probe, three trials a side. */
function quiet(): void {
  setConfig({ SANITY_ENABLED: false, DIFFICULTY_ENABLED: false, GATE_TRIALS: 3 });
}

/** What the SDK raises for a status the server sent. */
function _status(code: number, message: string): Error {
  return Anthropic.APIError.generate(code, undefined, message, new Headers());
}

function _always(itemType = "goi_bunpou"): () => Item {
  return () => deepcopy(fixtures.FIXTURES[itemType]);
}

describe("budget", () => {
  describe("with quiet", () => {
    beforeEach(() => {
      quiet();
    });

    test("a shelf that keeps discarding is abandoned after three", async () => {
      const s = store();
      const generations: number[] = [];
      patch(llm, "generateStructured", async () => {
        generations.push(1);
        return _always()();
      });
      // The cold side always picks the key: every draft is leaky.
      patch(llm, "answerChoice", async () => ({
        choice: schemas.correctIndex(fixtures.FIXTURES["goi_bunpou"]["options"]), reason: "x",
      }));
      setConfig({ SLOT_PATIENCE: 3 });

      const [p, kept] = await pipeline.runBatch(s, "goi_bunpou", "J2", 4, { gate: true, sanityCheck: false });

      expect(p === null && kept === 0).toBe(true);
      // Four items asked for would have allowed twelve attempts; three were spent.
      expect(generations.length).toBe(3);
    });

    test("a keep resets the patience", async () => {
      const tmp = tmpPath();
      const s = store(tmp);
      const verdicts = [false, false, true, false, false, true][Symbol.iterator]();
      const generations: number[] = [];

      const gate = async (_item: Item) => {
        const leaky = !verdicts.next().value;
        return new answerability.GateResult({
          cold_success_rate: leaky ? 1.0 : 0.0,
          full_success_rate: leaky ? null : 1.0,
          verdict: leaky ? "discarded:leaky" : "kept", trials: [] });
      };

      patch(llm, "generateStructured", async () => {
        generations.push(1);
        return _always()();
      });
      patch(answerability, "runGate", gate);
      setConfig({ SLOT_PATIENCE: 3 });
      // Two discards, a keep, two discards, a keep: never three in a row, so the
      // shelf runs to its two items on six attempts.
      patch(dedupe, "maxSimilarity", () => 0.0);

      // force, because two copies of one fixture are a near-duplicate pair and
      // the bundle check would (rightly) refuse them; the loop is what is tested.
      const [, kept] = await pipeline.runBatch(s, "goi_bunpou", "J2", 2, {
        gate: true, sanityCheck: false, force: true, out: path.join(tmp, "b.json") });
      expect(kept === 2 && generations.length === 6).toBe(true);
    });

    test("an empty account ends the run at once", async () => {
      const s = store();
      const calls: number[] = [];

      const broke = async () => {
        calls.push(1);
        throw new llm.LLMBillingError("API request failed: Your credit balance is too low");
      };

      patch(llm, "generateStructured", broke);
      await expect(pipeline.runBatch(s, "goi_bunpou", "J2", 4, { gate: true, sanityCheck: false }))
        .rejects.toThrow(llm.LLMBillingError);
      expect(calls.length, "one refusal is enough; the rest are not tried").toBe(1);
    });

    test("a discard is explained to the next draft", async () => {
      // The second draft for a shelf is told why the first was rejected, so it
      // is not written blind and does not fail the same way.
      const tmp = tmpPath();
      const s = store(tmp);
      const prompts: string[] = [];

      const fake = async (system: string, user: string) => {
        prompts.push(user);
        return deepcopy(fixtures.FIXTURES["goi_bunpou"]);
      };

      const verdicts = [true, false][Symbol.iterator]();  // leaky, then kept

      const gate = async (_item: Item) => {
        const leaky = verdicts.next().value;
        return new answerability.GateResult({
          cold_success_rate: leaky ? 1.0 : 0.0,
          full_success_rate: leaky ? null : 1.0,
          verdict: leaky ? "discarded:leaky" : "kept", trials: [] });
      };

      patch(llm, "generateStructured", fake);
      patch(answerability, "runGate", gate);
      const [, kept] = await pipeline.runBatch(s, "goi_bunpou", "J2", 1, {
        gate: true, sanityCheck: false, out: path.join(tmp, "b.json") });
      expect(kept === 1 && prompts.length === 2).toBe(true);
      expect(prompts[0]).not.toContain("REJECTED");
      expect(prompts[1].includes("REJECTED by review") && prompts[1].includes("stem hidden")).toBe(true);
    });

    test("a refused draft is retried on the same cell with the judges words", async () => {
      // The situation was fine; the options gave it away. So the next draft is
      // the same cell, told how the reviewer found the answer.
      const tmp = tmpPath();
      const s = store(tmp);
      const cellsSeen: string[] = [];

      const fake = async (system: string, user: string) => {
        cellsSeen.push(user.includes("機能") ? user.split("機能").at(-1)!.split("\n")[0] : user.slice(0, 40));
        return deepcopy(fixtures.FIXTURES["goi_bunpou"]);
      };

      const answers = [0, 0, 1, 1][Symbol.iterator]();  // cold: right, right (leaky); then wrong, wrong

      const judge = async (question: string, options: string[]) => {
        const ci = options.indexOf(fixtures.FIXTURES["goi_bunpou"]["options"].find(
          (o: Item) => o["role"] === "correct")["text"]);
        if (question.includes("withheld")) {
          return { choice: answers.next().value === 0 ? ci : (ci + 1) % 4,
                   reason: "only option B is in humble form" };
        }
        return { choice: ci, reason: "x" };
      };

      patch(llm, "generateStructured", fake);
      patch(llm, "answerChoice", judge);
      const prompts: [string | null, string | null | undefined][] = [];
      const cls = getGenerator("goi_bunpou").constructor as { prototype: Generator };
      const realUserPrompt = cls.prototype.userPrompt;

      const spy = function (
        this: Generator, level: string, avoid: string[],
        opts: { cell?: seedtable.Cell | null; feedback?: string | null } = {},
      ): string {
        const cell = opts.cell ?? null;
        prompts.push([cell ? cell.id : null, opts.feedback ?? null]);
        return realUserPrompt.call(this, level, avoid, opts);
      };

      patch(cls.prototype, "userPrompt", spy);
      const [, kept] = await pipeline.runBatch(s, "goi_bunpou", "J2", 1, {
        gate: true, sanityCheck: false, out: path.join(tmp, "b.json") });
      expect(kept === 1 && prompts.length === 2).toBe(true);
      expect(prompts[0][0], "the same cell, not the next one").toBe(prompts[1][0]);
      expect(prompts[0][1]).toBeNull();
      expect(prompts[1][1]).toContain("only option B is in humble form");
      expect(prompts[1][1]).toContain("stem hidden");
    });
  });

  test("a billing refusal is told apart from other failures", async () => {
    const boom = {
      messages: {
        create: async () => {
          throw _status(400, "Error code: 400 - Your credit balance is too low to access the Anthropic API.");
        },
      },
    };

    patch(llm.seams, "getClient", () => boom);
    await expect(llm.answerChoice("q", ["a", "b"], { model: "claude-opus-5" })).rejects.toThrow(llm.LLMBillingError);

    const down = {
      messages: {
        create: async () => {
          throw _status(529, "Error code: 529 - overloaded");
        },
      },
    };

    patch(llm.seams, "getClient", () => down);
    const err = await llm.answerChoice("q", ["a", "b"], { model: "claude-opus-5" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(llm.LLMError);
    expect(err).not.toBeInstanceOf(llm.LLMBillingError);
  });

  test("the generator prompt is cacheable and at the configured effort", async () => {
    const seen: Record<string, any> = {};

    const client = {
      messages: {
        create: async (kw: Record<string, any>) => {
          Object.assign(seen, kw);
          throw _status(400, "stop here");
        },
      },
    };

    patch(llm.seams, "getClient", () => client);
    setConfig({ GEN_EFFORT: "medium" });
    await expect(llm.generateStructured("the stable half", "the question", { type: "object" }))
      .rejects.toThrow(llm.LLMError);
    expect(seen["system"]).toEqual([{ type: "text", text: "the stable half",
                                      cache_control: { type: "ephemeral" } }]);
    expect(seen["output_config"]["effort"]).toBe("medium");
  });

  test("the defaults are the cheaper ones", () => {
    // Sonnet writes and Sonnet judges; Opus is one env var away, not the default.
    expect(config.GEN_MODEL).toBe("claude-sonnet-5");
    expect(config.JUDGE_MODEL).toBe("claude-sonnet-5");
    expect(config.GEN_EFFORT).toBe("medium");
    expect(config.IMAGE_QUALITY).toBe("medium");
    expect(config.SLOT_PATIENCE).toBe(3);
    expect([plan.DEFAULT_BUDGET, plan.DEFAULT_PER_SLOT, plan.DEFAULT_READING_MIN]).toEqual([2, 1, 1]);
  });
});
