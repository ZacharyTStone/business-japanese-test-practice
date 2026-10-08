/**
 * Vocabulary gate (fidelity #5) and level descriptors.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as levels from "../bjt/levels.ts";
import * as vocab from "../bjt/fidelity/vocab.ts";
import { goiItem, seedsDir } from "./conftest.ts";

function _writeTier(seeds: string, tier: string, kanji: string): void {
  writeFileSync(path.join(seeds, "vocab", `jlpt_${tier}_kanji.txt`), kanji, "utf8");
}

describe("vocab levels", () => {
  test("permissive when tiers incomplete", () => {
    const seeds = seedsDir();
    _writeTier(seeds, "n5", "日 月 火");  // J3 needs N5+N4+N3
    const res = vocab.checkItem(goiItem(), "J3");
    expect(res.enforced).toBe(false);
    expect(res.note).toContain("missing tier data");
    expect(res.ok).toBe(true);  // permissive -> no violations
  });

  test("enforced flags above band", () => {
    const seeds = seedsDir();
    for (const t of ["n5", "n4", "n3"]) {
      _writeTier(seeds, t, "日 月 火");
    }
    const item = { stem: "議事録", options: [{ text: "日" }], explanation_ja: "" };
    const res = vocab.checkItem(item, "J3");
    expect(res.enforced).toBe(true);
    expect(new Set(res.violations)).toEqual(new Set(["議", "事", "録"]));
    expect(res.ok).toBe(false);
  });

  test("enforced clean when all in band", () => {
    const seeds = seedsDir();
    for (const t of ["n5", "n4", "n3"]) {
      _writeTier(seeds, t, "日 月 火");
    }
    const item = { stem: "日月火", options: [{ text: "日" }], explanation_ja: "火" };
    const res = vocab.checkItem(item, "J3");
    expect(res.enforced).toBe(true);
    expect(res.violations).toEqual([]);
    expect(res.ok).toBe(true);
  });

  test("business terms reported", () => {
    const seeds = seedsDir();
    writeFileSync(path.join(seeds, "vocab", "business_terms.txt"), "納期\n見積書\n", "utf8");
    const item = { stem: "納期を確認します", options: [{ text: "見積書の件" }], explanation_ja: "" };
    const res = vocab.checkItem(item, "J1");  // J1 permissive on kanji
    expect(new Set(res.business_terms_used)).toEqual(new Set(["納期", "見積書"]));
  });

  test("the status summary lists the tiers and business terms loaded", () => {
    const seeds = seedsDir();
    _writeTier(seeds, "n5", "日 月");
    writeFileSync(path.join(seeds, "vocab", "business_terms.txt"), "納期\n", "utf8");
    const s = vocab.statusSummary();
    expect(s["tiers_loaded"]).toEqual(["N5"]);
    expect(s["business_terms"]).toBe(1);
  });

  test("level defaults without seeds", () => {
    seedsDir();
    // seeds_dir has no levels.json -> neutral defaults, not official.
    expect(levels.usingOfficialDescriptors()).toBe(false);
    expect(levels.descriptor("J2")).toContain("business Japanese");
  });

  test("level override from seeds", () => {
    const seeds = seedsDir();
    writeFileSync(path.join(seeds, "levels.json"), '{"J2": "OFFICIAL J2 TEXT"}', "utf8");
    expect(levels.usingOfficialDescriptors()).toBe(true);
    expect(levels.descriptor("J2")).toBe("OFFICIAL J2 TEXT");
  });
});
