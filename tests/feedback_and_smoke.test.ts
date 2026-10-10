/**
 * The discriminator->generator tell feedback loop, the smoke harness, seeds
 * status, and gen --json.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import * as cli from "../bjt/cli/index.ts";
import * as llm from "../bjt/llm.ts";
import { getGenerator } from "../bjt/generators/index.ts";
import * as schemas from "../bjt/schemas.ts";
import { fixtureItem, seedsDir, store } from "./conftest.ts";
import { capture, patch, setConfig, tmpPath } from "./helpers.ts";

// These tests exercise the pass-rate probe ("trials"); the confidence
// probe, the default since 2026-10-10, has its own in confidence.test.ts.
beforeEach(() => {
  setConfig({ DIFFICULTY_METHOD: "trials" });
});

// ----- tell feedback loop (fidelity #3 closes onto #1's prompt) -----------

describe("tell feedback loop", () => {
  test("latest tells roundtrip", () => {
    const s = store();
    s.insertDiscriminatorRun("goi_bunpou", 4, 4, 0.75, ["tell one", "tell two"]);
    expect(s.latestTells("goi_bunpou")).toEqual(["tell one", "tell two"]);
    expect(s.latestTells("hyougen")).toEqual([]); // none for this type
  });

  test("tells injected into prompt", () => {
    const s = store();
    s.insertDiscriminatorRun("goi_bunpou", 4, 4, 0.75, ["distractors too obviously fake"]);
    const gen = getGenerator("goi_bunpou", { store: s });
    const sp = gen.systemPrompt("J2");
    expect(sp).toContain("distractors too obviously fake");
    expect(sp).toContain("indistinguishable from an official item");
  });

  test("no tells no constraint block", () => {
    const s = store();
    const gen = getGenerator("goi_bunpou", { store: s });
    expect(gen.systemPrompt("J2")).not.toContain("indistinguishable from an official item");
  });
});

// ----- smoke harness ------------------------------------------------------

async function _fakeKeptAnswer(question: string, options: string[]): Promise<Record<string, any>> {
  const correct = (fixtureItem("goi_bunpou")["options"] as Record<string, any>[])
    .find((o) => o["role"] === "correct")!["text"];
  const ci = options.indexOf(correct);
  expect(ci).toBeGreaterThanOrEqual(0);
  return { "choice": !question.includes("withheld") ? ci : (ci + 1) % 4, "reason": "x" };
}

describe("smoke harness", () => {
  test("smoke passes", async () => {
    const tmp = tmpPath();
    const cap = capture();
    setConfig({ DB_PATH: path.join(tmp, "smoke.db"), SANITY_ENABLED: false });
    patch(llm, "generateStructured", async () => fixtureItem("goi_bunpou"));
    patch(llm, "answerChoice", _fakeKeptAnswer);
    const rc = await cli.cmdSmoke({ type: "goi_bunpou", level: "J2", n: 3, no_gate: false });
    expect(rc).toBe(0);
    expect(cap.readouterr().out).toContain("SMOKE PASSED");
  });

  test("smoke fails on crash", async () => {
    const tmp = tmpPath();
    const cap = capture();
    setConfig({ DB_PATH: path.join(tmp, "smoke.db") });

    const boom = async (): Promise<Record<string, any>> => {
      throw new llm.LLMError("api down");
    };

    patch(llm, "generateStructured", boom);
    const rc = await cli.cmdSmoke({ type: "goi_bunpou", level: "J2", n: 2, no_gate: true });
    expect(rc).toBe(1);
    expect(cap.readouterr().out).toContain("SMOKE FAILED");
  });
});

// ----- gen --json ---------------------------------------------------------

describe("gen --json", () => {
  test("gen json emits valid item", async () => {
    const tmp = tmpPath();
    const cap = capture();
    setConfig({ DB_PATH: path.join(tmp, "gen.db"), DIFFICULTY_ENABLED: false });
    patch(llm, "generateStructured", async () => fixtureItem("hyougen"));
    const rc = await cli.cmdGen({ type: "hyougen", level: "J2", no_gate: true, no_sanity: true, json: true });
    expect(rc).toBe(0);
    const out = cap.readouterr().out;
    const item = JSON.parse(out); // stdout is pure JSON (verdict goes to stderr)
    expect(schemas.validateItem("hyougen", item)).toEqual([]);
  });
});

// ----- seeds status -------------------------------------------------------

describe("seeds status", () => {
  test("seeds status runs", async () => {
    const dir = seedsDir();
    const cap = capture();
    writeFileSync(path.join(dir, "vocab", "business_terms.txt"), "納期\n", "utf8");
    const rc = await cli.cmdSeeds({});
    expect(rc).toBe(0);
    const out = cap.readouterr().out;
    expect(out.includes("goi_bunpou") && out.includes("hyougen")).toBe(true);
    expect(out).toContain("business terms: 1");
  });
});
