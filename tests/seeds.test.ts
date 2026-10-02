/** Seeds the repository can make for itself, from the reference batches. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as batch from "../bjt/batch.ts";
import * as cli from "../bjt/cli/index.ts";
import * as config from "../bjt/config.ts";
import { loadSeedJson } from "../bjt/generators/base.ts";
import { dumps } from "../bjt/pyjson.ts";
import * as regate from "../bjt/regate.ts";
import * as seeds from "../bjt/seeds.ts";
import * as withdrawn from "../bjt/withdrawn.ts";
import { capture, setConfig, tmpPath } from "./helpers.ts";

type Item = Record<string, any>;

describe("seeds", () => {
  test("examples come from the batches in the generators shape", () => {
    const examples = seeds.examplesFromBatches();
    expect("hatsugen_choukai" in examples && "goi_bunpou" in examples).toBe(true);
    for (const items of Object.values(examples)) {
      expect(items.length > 0 && items.length <= seeds.PER_TYPE).toBe(true);
      for (const item of items) {
        // The shape the generator emits and the few-shot README describes:
        // no identity, no provenance, no media, no answer key.
        for (const field of seeds._NOT_AN_EXAMPLE_FIELD) {
          expect(item).not.toHaveProperty(field);
        }
        expect(item["explanation_ja"] && item["options"].length).toBeTruthy();
        expect(item["options"].filter((o: Item) => o["role"] === "correct").length).toBe(1);
        expect(item["options"].every((o: Item) => Boolean(o["why"]))).toBe(true);
      }
    }
  });

  test("examples are spread across levels", () => {
    // 発言聴解 has J3, J2 and J1 batches; five examples should show all three.
    const items = seeds.examplesFromBatches()["hatsugen_choukai"];
    expect(items.length).toBe(seeds.PER_TYPE);
    // Level was stripped from the example, so read it off the source bundles.
    const stems = new Set(items.map((it) => it["stem"]));
    const levelsSeen = new Set<string>();
    for (const name of readdirSync(config.BATCH_DIR)) {
      if (!(name.startsWith("hatsugen_choukai_") && name.endsWith(".json"))) {
        continue;
      }
      if (name.endsWith(".source.json")) {
        continue;
      }
      const bundle = JSON.parse(readFileSync(path.join(config.BATCH_DIR, name), "utf8"));
      if (bundle["items"].some((it: Item) => stems.has(it["stem"]))) {
        levelsSeen.add(bundle["level"]);
      }
    }
    expect(levelsSeen).toEqual(new Set(["J3", "J2", "J1"]));
  });

  test("bootstrap writes a seeds dir the generator reads", () => {
    const target = path.join(tmpPath(), "seeds");
    const result = seeds.bootstrap({ seedsDir: target });
    expect(result.skipped).toBeFalsy();
    expect(existsSync(path.join(target, seeds.MARKER))).toBe(true);
    expect(result.business_terms).toBeGreaterThan(0);
    expect(existsSync(path.join(target, "vocab", "business_terms.txt"))).toBe(true);
    // What it must not invent.
    expect(existsSync(path.join(target, "official"))).toBe(false);
    expect(existsSync(path.join(target, "levels.json"))).toBe(false);
    expect(readdirSync(path.join(target, "vocab")).filter((n) => n.startsWith("jlpt_"))).toEqual([]);

    setConfig({ SEEDS_DIR: target });
    expect(loadSeedJson("fewshot", "goi_bunpou").length).toBe(result.fewshot["goi_bunpou"]);
    expect(result.summary().includes("Built") && result.summary().includes("no official/ items")).toBe(true);
  });

  test("bootstrap never overwrites real seeds", () => {
    const real = path.join(tmpPath(), "seeds");
    mkdirSync(path.join(real, "fewshot"), { recursive: true });
    writeFileSync(path.join(real, "fewshot", "goi_bunpou.json"), "[]", "utf8");
    expect(seeds.hasLicensedSeeds({ seedsDir: real })).toBe(true);
    const result = seeds.bootstrap({ seedsDir: real });
    expect(result.skipped && result.skipped.includes("leaving it alone")).toBeTruthy();
    expect(existsSync(path.join(real, seeds.MARKER))).toBe(false);
    // --force does, and the marker then says so.
    expect(seeds.bootstrap({ seedsDir: real, force: true }).skipped).toBeFalsy();
    expect(seeds.hasLicensedSeeds({ seedsDir: real })).toBe(false);
  });

  test("a bootstrapped dir is not licensed and can be rebuilt", () => {
    const target = path.join(tmpPath(), "seeds");
    seeds.bootstrap({ seedsDir: target });
    expect(seeds.hasLicensedSeeds({ seedsDir: target })).toBe(false);
    expect(seeds.bootstrap({ seedsDir: target }).skipped).toBeFalsy();
  });

  test("the cli bootstraps and reports", async () => {
    const cap = capture();
    setConfig({ SEEDS_DIR: path.join(tmpPath(), "seeds") });
    expect(await cli.main({ argv: ["seeds", "--bootstrap"] })).toBe(0);
    const out = cap.readouterr().out;
    expect(out.includes("Built") && out.includes("bootstrapped from batches/")).toBe(true);
  });
});

// ----- only what a learner still meets is an example -------------------------

/** The ids an example was taken from (ids are stripped; stems are not). */
function _sourceIds(examples: Record<string, Item[]>): Set<string> {
  const byStem: Record<string, string> = {};
  for (const p of batch.bundles()) {
    for (const it of batch.load(p)["items"]) {
      byStem[it["stem"]] = it["id"];
    }
  }
  return new Set(Object.values(examples).flatMap((items) => items.map((ex) => byStem[ex["stem"]])));
}

function _bundle(p: string, itemType: string, items: Item[]): void {
  writeFileSync(p, dumps({ "item_type": itemType, "level": "J2", "items": items }, { ensureAscii: false }), "utf8");
}

describe("only what a learner still meets is an example", () => {
  test("no bootstrapped example is a withdrawn question", () => {
    const gone = withdrawn.ids();
    expect(gone.size, "the ledger has lines, so this test means something").toBeGreaterThan(0);
    const sources = _sourceIds(seeds.examplesFromBatches());
    expect([...sources].filter((id) => gone.has(id))).toEqual([]);
  });

  test("a withdrawn or regate failed question is never an example", () => {
    const tmp = tmpPath();
    const items = [0, 1, 2, 3].map((i) => ({ "id": `id${i}`, "stem": `stem ${i}`, "options": [], "explanation_ja": "x" }));
    _bundle(path.join(tmp, "goi_bunpou_J2_001.json"), "goi_bunpou", items);
    writeFileSync(path.join(tmp, withdrawn.LEDGER_NAME),
                  "id0  unnatural     Invented keigo nobody says.\n", "utf8");
    const ledger = path.join(tmp, regate.REGATE_LEDGER_NAME);
    regate.recordRegated(new regate.Regated({ item_id: "id1", verdict: "discarded:sanity", date: "2026-09-30",
                                              reason: "unnatural", note: "flagged" }), { path: ledger });
    regate.recordRegated(new regate.Regated({ item_id: "id2", verdict: "overruled", date: "2026-09-30",
                                              reason: "unnatural", note: "the owner keeps it" }), { path: ledger });
    regate.recordRegated(new regate.Regated({ item_id: "id3", verdict: "kept", date: "2026-09-30",
                                              reason: "-", note: "clean" }), { path: ledger });

    const stems = seeds.examplesFromBatches({ batchDir: tmp })["goi_bunpou"].map((ex) => ex["stem"]);
    expect(stems, "overruled and kept stay; withdrawn and failed go").toEqual(["stem 2", "stem 3"]);
  });
});
