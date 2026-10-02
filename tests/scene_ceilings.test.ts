/**
 * The picture job stops at the run's ceiling, and an outage is not a refusal.
 *
 * Two ways the job spent what nobody meant it to: the ceiling raised inside the
 * review was caught as one scene's error, and the next scene began by buying
 * another image; and a reader that could not be reached was scored as choosing
 * nothing, a refusal written into the bucket's lifetime ledger — six of those
 * and a 画像把握 item is never served.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as cli from "../bjt/cli/index.ts";
import * as http from "../bjt/http.ts";
import * as llm from "../bjt/llm.ts";
import { RuntimeError } from "../bjt/py.ts";
import * as scene_art from "../bjt/scene_art.ts";
import * as scenes from "../bjt/scenes.ts";
import { patch, setConfig, setEnv, tmpPath } from "./helpers.ts";

class _Real implements scene_art.ImageProvider {
  name = "fake";
  suffix = ".png";
  media_type = "image/png";
  real = true;
  calls = 0;

  async generate(prompt: string): Promise<Uint8Array> {
    this.calls += 1;
    return scene_art._flatPng(6, 4, [this.calls, 0, 0]);
  }
}

function _ceiling(): never {
  throw new llm.LLMSpendLimitError("spend ceiling reached: $0.50 of $0.50");
}

function _picture(tmp: string): scenes.Scene {
  return scenes.survey({ mediaDir: tmp }).find((s) => s.is_picture)!;
}

function _cleanFlags(): void {
  patch(llm, "reviewSceneImage", async (image: Uint8Array, mt: string, brief: string, rules: Record<string, string>) =>
    ({ ...Object.fromEntries(Object.keys(rules).map((r) => [r, false])), notes: "" }));
}

const approve = () => new scene_art.Verdict({ approved: true });

describe("scene_ceilings", () => {
  test("no image is bought over the ceiling", async () => {
    const tmp = tmpPath();
    setConfig({ RUN_BUDGET_USD: 0.5 });
    llm.state.spend.usd = 0.5;
    const provider = new _Real();
    const stop = await scene_art.draw(scenes.survey({ mediaDir: tmp }).slice(0, 3),
                                      { provider, review: approve, mediaDir: tmp }).catch((e) => e);
    expect(stop).toBeInstanceOf(scene_art.DrawStopped);
    expect(provider.calls).toBe(0);
    expect(stop.result.stopped).toBeTruthy();
    expect(stop.result.stopped).toContain("spend ceiling");
  });

  test("every image is a request on the count", async () => {
    const tmp = tmpPath();
    const provider = new _Real();
    await scene_art.draw(scenes.survey({ mediaDir: tmp }).slice(0, 2),
                         { provider, review: approve, mediaDir: tmp });
    expect(llm.state.spend.attempts).toBe(2);
    expect(provider.calls).toBe(2);
  });

  test("the ceiling met in review ends the drawing and keeps what was approved", async () => {
    const tmp = tmpPath();
    const wanted = scenes.survey({ mediaDir: tmp }).slice(0, 3);
    const verdicts = [approve()];

    const review = (image: Uint8Array, mediaType: string, scene: scenes.Scene): scene_art.Verdict => {
      const next = verdicts.shift();
      if (next === undefined) {
        _ceiling();
      }
      return next;
    };

    const provider = new _Real();
    const stop = await scene_art.draw(wanted, { provider, review, mediaDir: tmp }).catch((e) => e);
    expect(stop).toBeInstanceOf(scene_art.DrawStopped);
    const result: scene_art.DrawResult = stop.result;
    expect(provider.calls, "the third scene is never started").toBe(2);
    expect(result.drawn.map((d) => d.ok)).toEqual([true, false]);
    expect(result.drawn[1].error!.startsWith("stopped:")).toBe(true);
    expect(result.summary()).toContain("Stopped before the end");
    expect(stop).toBeInstanceOf(llm.LLMBillingError);
  });

  test("an empty image account stops the drawing", async () => {
    const tmp = tmpPath();
    setEnv("OPENAI_API_KEY", "k");

    const refuse = async (): Promise<any> => {
      throw new RuntimeError("POST https://api.openai.com/v1/images/generations → HTTP 400: "
                             + "billing_hard_limit_reached");
    };

    patch(http, "jsonRequest", refuse);
    await expect(scene_art.draw(scenes.survey({ mediaDir: tmp }).slice(0, 3),
                                { provider: new scene_art.OpenAIImageProvider(), review: approve, mediaDir: tmp }))
      .rejects.toBeInstanceOf(scene_art.DrawStopped);
  });

  test.each([
    ["an outage", new llm.LLMError("API request failed: overloaded")],
    ["a reply that is not an index", { "choice": "the second one", "reason": "x" }],
  ] as [string, Error | Record<string, any>][])(
    "a reader that gave no answer is an error not a refusal [%s]", async (_label, reply) => {
      const tmp = tmpPath();
      _cleanFlags();

      const read = async (): Promise<Record<string, any>> => {
        if (reply instanceof Error) {
          throw reply;
        }
        return reply;
      };

      patch(llm, "answerFromImage", read);
      const refused: unknown[][] = [];
      const result = await scene_art.draw([_picture(tmp)], {
        provider: new _Real(), review: scene_art.reviewWithModel, mediaDir: tmp,
        onReject: (...a) => {
          refused.push(a);
        },
      });
      expect(result.drawn.length).toBe(1);
      const only = result.drawn[0];
      expect(refused, "the lifetime ledger counts refusals, not outages").toEqual([]);
      expect(only.rejected).toEqual([]);
      expect(only.error).toBeTruthy();
    });

  test("a reader that answered wrongly is still a refusal", async () => {
    const tmp = tmpPath();
    _cleanFlags();
    const pic = _picture(tmp);
    patch(llm, "answerFromImage", async () => ({ "choice": (pic.answer! + 1) % 4, "reason": "x" }));
    const refused: unknown[][] = [];
    await scene_art.draw([pic], { provider: new _Real(), review: scene_art.reviewWithModel,
                                  mediaDir: tmp, attempts: 1, onReject: (...a) => {
                                    refused.push(a);
                                  } });
    expect(refused.length).toBe(1);
  });

  test("the command uploads nothing new but reports the stop", async () => {
    const tmp = tmpPath();
    patch(scene_art.PROVIDERS, "fake", _Real);
    setConfig({ RUN_BUDGET_USD: 0.5 });
    llm.state.spend.usd = 0.5;
    const summary = path.join(tmp, "scenes.md");
    const rc = await cli.main({ argv: ["scenes", "--generate", "--provider", "fake", "--media-dir", tmp,
                                       "--summary", summary] });
    expect(rc).toBe(1);
    expect(readFileSync(summary, "utf8")).toContain("Stopped before the end");
  });
});
