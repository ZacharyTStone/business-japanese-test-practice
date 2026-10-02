/**
 * A stop-the-run error is never mistaken for a failed call.
 *
 * `LLMBillingError` (and the run's own ceiling, `LLMSpendLimitError`) is an
 * `LLMError`, so every call site that tolerates a failed call — the proofreader,
 * the gate's trials, the probe, the picture reader — would swallow it with a
 * bare `catch (LLMError)` and let the run carry on refusing itself. Each of them
 * lets it through; these hold them to that.
 */
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as cli from "../bjt/cli/index.ts";
import * as fixtures from "../bjt/fixtures.ts";
import * as jev from "../bjt/jev.ts";
import * as llm from "../bjt/llm.ts";
import * as pipeline from "../bjt/pipeline.ts";
import { deepcopy } from "../bjt/py.ts";
import * as scene_art from "../bjt/scene_art.ts";
import * as scenes from "../bjt/scenes.ts";
import * as answerability from "../bjt/fidelity/answerability.ts";
import * as difficulty from "../bjt/fidelity/difficulty.ts";
import * as sanity from "../bjt/fidelity/sanity.ts";
import { goiItem, store } from "./conftest.ts";
import { capture, patch, setConfig, tmpPath } from "./helpers.ts";

async function _ceiling(..._args: unknown[]): Promise<never> {
  throw new llm.LLMSpendLimitError("spend ceiling reached: $0.50 of $0.50");
}

describe("billing passes through", () => {
  test("the proofreader lets the ceiling through", async () => {
    setConfig({ SANITY_ENABLED: true });
    patch(llm, "sanityCheck", _ceiling);
    await expect(sanity.runCheck(goiItem())).rejects.toThrow(llm.LLMSpendLimitError);
  });

  test("the gate lets the ceiling through", async () => {
    patch(llm, "answerChoice", _ceiling);
    await expect(answerability.runGate(goiItem())).rejects.toThrow(llm.LLMSpendLimitError);
  });

  test("the probe lets the ceiling through", async () => {
    setConfig({ DIFFICULTY_ENABLED: true });
    patch(llm, "answerChoice", _ceiling);
    await expect(difficulty.measure(goiItem())).rejects.toThrow(llm.LLMSpendLimitError);
  });

  test("the jev probe lets an empty account through", async () => {
    setConfig({ DIFFICULTY_ENABLED: true });

    const broke = async (): Promise<number[]> => {
      throw new llm.LLMBillingError("Jev request failed: HTTP 402");
    };

    patch(jev, "choiceProbabilities", broke);
    await expect(difficulty.measure(goiItem(), { model: "jev-latest" })).rejects.toThrow(llm.LLMBillingError);
  });

  test("the picture reader lets the ceiling through", async () => {
    const scene = new scenes.Scene({ scene_id: "pic_x", label_ja: "", used_by: ["gazou_haaku"],
                                     cell_count: 1, brief: "a desk", question: "q",
                                     options: ["a", "b", "c", "d"], answer: 0 });
    patch(llm, "reviewSceneImage", async () => ({ "notes": "" }));
    patch(llm, "answerFromImage", _ceiling);
    await expect(scene_art.reviewWithModel(new TextEncoder().encode("img"), "image/png", scene))
      .rejects.toThrow(llm.LLMSpendLimitError);
  });

  test("a kept item whose probe meets the ceiling is kept unmeasured", async () => {
    const s = store();
    const item = deepcopy(fixtures.FIXTURES["goi_bunpou"]);
    patch(llm, "generateStructured", async () => deepcopy(item));
    setConfig({ SANITY_ENABLED: false, DIFFICULTY_ENABLED: true });
    patch(answerability, "runGate", async () => new answerability.GateResult({
      cold_success_rate: 0.0, full_success_rate: 1.0, verdict: "kept",
      trials: [new answerability.Trial({ side: "cold", trial: 0, chosen: 1, correct: false }),
               new answerability.Trial({ side: "full", trial: 0, chosen: 0, correct: true })] }));
    patch(llm, "answerChoice", _ceiling);

    const [out, , kept] = await pipeline.generateAndGate(s, "goi_bunpou", "J2", { gate: true });
    expect(kept, "the gate passed it and it was paid for").toBe(true);
    expect(out["model_p_correct"], "the gate's rate stands in").toBe(1.0);
  });

  test("the smoke run stops at the ceiling", async () => {
    const tmp = tmpPath();
    capture();
    setConfig({ DB_PATH: path.join(tmp, "smoke.db") });
    const calls: number[] = [];

    const over = async (): Promise<Record<string, any>> => {
      calls.push(1);
      return _ceiling();
    };

    patch(llm, "generateStructured", over);
    await expect(cli.cmdSmoke({ type: "goi_bunpou", level: "J2", n: 5, no_gate: true }))
      .rejects.toThrow(llm.LLMSpendLimitError);
    expect(calls.length).toBe(1);
  });
});
