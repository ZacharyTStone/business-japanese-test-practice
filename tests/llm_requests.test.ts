/**
 * The shape of one Messages request, per model family.
 *
 * No API call is made: `requestParams` is the pure function `_structured`
 * hands to the SDK. A cheap model asked in the expensive model's dialect
 * refuses the request, and every proofread and every difficulty probe fails
 * with it.
 */
import { describe, expect, test } from "vitest";
import * as config from "../bjt/config.ts";
import * as llm from "../bjt/llm.ts";

const SCHEMA = { type: "object", properties: { x: { type: "boolean" } } };

function _params(model: string) {
  return llm.requestParams(model, "sys", "user", SCHEMA, { maxTokens: 1200, effort: "low" });
}

describe("llm requests", () => {
  test("opus and sonnet get adaptive thinking and an effort", () => {
    for (const model of ["claude-opus-5", "claude-sonnet-5"]) {
      const p = _params(model);
      expect(p["thinking"]).toEqual({ type: "adaptive" });
      expect(p["output_config"]["effort"]).toBe("low");
      expect(p["output_config"]["format"]["schema"]).toBe(SCHEMA);
    }
  });

  test("haiku gets neither because it would refuse both", () => {
    const p = _params("claude-haiku-4-5");
    expect("thinking" in p).toBe(false);
    expect("effort" in p["output_config"]).toBe(false);
    // Everything else is the same request.
    expect(p["model"]).toBe("claude-haiku-4-5");
    expect(p["max_tokens"]).toBe(1200);
    expect(p["output_config"]["format"]).toEqual({ type: "json_schema", schema: SCHEMA });
    expect(p["messages"]).toEqual([{ role: "user", content: "user" }]);
    // The stable half of the request is marked cacheable, on every model.
    expect(p["system"]).toEqual([{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }]);
  });

  test("the default proofreader and probe model is one haiku accepts", () => {
    expect(config.SANITY_MODEL.startsWith("claude-haiku")).toBe(true);
    expect(config.DIFFICULTY_MODEL.startsWith("claude-haiku")).toBe(true);
    expect("thinking" in _params(config.SANITY_MODEL)).toBe(false);
  });
});
