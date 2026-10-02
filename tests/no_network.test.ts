/**
 * The test suite's own guard: no test reaches a vendor.
 *
 * `tests/setup.ts` strips every credential from the environment and replaces
 * each network seam with one that fails the test. These hold it to that, so the
 * guard cannot be edited away without a test noticing.
 */
import { describe, expect, test } from "vitest";
import * as http from "../bjt/http.ts";
import * as jev from "../bjt/jev.ts";
import * as llm from "../bjt/llm.ts";
import * as r2 from "../bjt/r2.ts";
import * as scene_art from "../bjt/scene_art.ts";
import * as providers from "../bjt/tts/providers.ts";
import { setEnv, UnmockedCall } from "./helpers.ts";

describe("no_network", () => {
  test("no credential reaches a test", () => {
    const live = Object.keys(process.env).filter((k) =>
      ["ANTHROPIC_", "OPENAI_", "TYPESAFE_", "R2_", "CLOUDFLARE_"].some((p) => k.startsWith(p)));
    expect(live).toEqual([]);
  });

  /** An UnmockedCall, not an LLMError: a tolerant call site would turn the
   *  latter into "did not run" and the test would pass on it. */
  test.each([
    ["llm.answerChoice", () => llm.answerChoice("q", ["a", "b"])],
    ["http.request", () => http.request("GET", "https://example.invalid")],
    ["providers._post", () => providers._post("https://example.invalid", {}, {})],
    ["scene_art.Bucket.list",
     () => new scene_art.Bucket({ creds: new r2.Credentials({ account_id: "acct", access_key_id: "k",
                                                               secret_access_key: "s" }) }).list()],
    ["jev.choiceProbabilities", () => jev.choiceProbabilities("q", ["a", "b"], { model: "jev-latest" })],
  ] as [string, () => Promise<unknown>][])("an unfaked call fails the test rather than the item [%s]", async (_label, call) => {
    setEnv("TYPESAFE_API_KEY", "k"); // so Jev gets as far as the wire
    await expect(call()).rejects.toBeInstanceOf(UnmockedCall);
    expect(UnmockedCall.prototype instanceof llm.LLMError).toBe(false);
  });
});
