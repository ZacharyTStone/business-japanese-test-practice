/**
 * Whole-batch checks: the failures a per-item gate cannot see, plus the
 * reference batch as a regression test.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as batch from "../bjt/batch.ts";
import * as cli from "../bjt/cli/index.ts";
import { Store } from "../bjt/db/index.ts";
import * as dedupe from "../bjt/fidelity/dedupe.ts";
import * as roles from "../bjt/fidelity/roles.ts";
import * as fixtures from "../bjt/fixtures.ts";
import * as publish from "../bjt/publish.ts";
import { deepcopy, fixed, floorDiv, get, len, max, min, or, slice, sorted, ValueError, zip } from "../bjt/py.ts";
import { dumps } from "../bjt/pyjson.ts";
import * as seedtable from "../bjt/seedtable.ts";
import * as withdrawn from "../bjt/withdrawn.ts";
import { capture, setConfig, tmpPath } from "./helpers.ts";

type Item = Record<string, any>;

const BATCHES = path.join(import.meta.dirname, "..", "batches");
const REFERENCE = path.join(BATCHES, "hatsugen_choukai_J2_001.json");

/** Every bundle committed to the repo. The library grows one batch at a time and
 *  each one has to keep passing the gates it was admitted under, so the sweep is
 *  over the directory rather than over a list of names: a regression test pinned
 *  to one file stops being a regression test the moment a second file exists. */
const COMMITTED = sorted(readdirSync(BATCHES).filter((n) => n.endsWith(".json") && !n.endsWith(".source.json")))
  .map((n) => path.join(BATCHES, n));

function _sourceOf(p: string): string {
  return path.join(path.dirname(p), path.basename(p).replace(".json", ".source.json"));
}

/** The bundles a person wrote by hand, which are the only ones with a source
 *  file to rebuild from. The nightly job writes its bundles directly — there is
 *  no hand-edited original behind them — so the round-trip test below has
 *  nothing to compare those against. */
const HAND_WRITTEN = COMMITTED.filter((p) => existsSync(_sourceOf(p)));

function _bundleId(p: string): string {
  return path.basename(p, path.extname(p));
}

/** `[[id, path], ...]` for a parametrised sweep, named as pytest named them. */
const byId = (paths: string[]): [string, string][] => paths.map((p) => [_bundleId(p), p]);

// ----- near-duplicate detection ------------------------------------------

function _item(stem: string, answer: string, others: string[] = ["いいえ。", "はい。", "どうも。"]): Item {
  const opts: Item[] = [{ "text": answer, "role": "correct", "why": "これが正解である理由。" }];
  for (const [text, role] of zip(others, ["register_too_casual", "content_mismatch", "wrong_speech_act"], { strict: true })) {
    opts.push({ "text": text, "role": role, "why": "これが誤りである理由。" });
  }
  return { "stem": stem, "options": opts, "topic": slice(stem, 0, 6) };
}

describe("near-duplicate detection", () => {
  test("paraphrases of one situation collide", () => {
    const a = _item("取引先に電話をかけ、担当者が不在でした。何と言いますか。", "またご連絡いたします。");
    const b = _item("取引先に電話をかけたが、担当者が不在だった。何と言いますか。", "またご連絡いたします。");
    expect(dedupe.similarity(dedupe.itemSignature(a), dedupe.itemSignature(b))).toBeGreaterThanOrEqual(dedupe.DEFAULT_THRESHOLD);
  });

  test("same setting different problem does not collide", () => {
    const a = _item("取引先に電話をかけ、担当者が不在でした。何と言いますか。", "またご連絡いたします。");
    const b = _item("取引先との会食で、料理が運ばれてきました。何と言いますか。", "どうぞお召し上がりください。");
    expect(dedupe.findDuplicates([a, b])).toEqual([]);
  });

  test("same answer in a different situation does not collide", () => {
    const a = _item("上司に書類を見てもらいたいと頼みます。何と言いますか。", "かしこまりました。");
    const b = _item("展示会の受付で来場者を案内します。何と言いますか。", "かしこまりました。");
    expect(dedupe.findDuplicates([a, b])).toEqual([]);
  });

  test("normalisation ignores punctuation and width", () => {
    expect(dedupe.normalize("ＡＢＣ、です。")).toBe(dedupe.normalize("ABCです"));
  });

  test("max similarity against an empty pool is zero", () => {
    expect(dedupe.maxSimilarity(_item("x".repeat(30), "y"), [])).toBe(0.0);
  });
});

// ----- bundle checks ------------------------------------------------------

/** pytest's `bundle` fixture: the reference batch, fresh for every test. */
function bundleFixture(): Item {
  return batch.load(REFERENCE);
}

function _status(report: batch.BundleReport, name: string): string {
  return report.checks.find((c) => c.name === name)!.status;
}

const asPairs = (checks: batch.Check[]) => JSON.stringify(checks.map((c) => [c.name, c.detail]));

describe("bundle checks", () => {
  /** The committed bundles are the regression set: if a check starts failing
   *  one of them, the check changed, not the items. */
  test.each(byId(COMMITTED))("every committed batch still ships [%s]", (_id, p) => {
    const report = batch.checkBundle(batch.load(p));
    expect(report.ok, asPairs(report.failed)).toBe(true);
    expect(report.warned, asPairs(report.warned)).toEqual([]);
  });

  /** ...as far as it has room to.
   *
   *  An item carries exactly three distractors, so a bundle of `n` items can show
   *  at most `3n` distinct roles however varied its prompt is. The nightly job
   *  writes one-item bundles, and demanding four roles of three slots is a demand
   *  about arithmetic rather than about the items. */
  test.each(byId(COMMITTED))("every committed batch uses every distractor role [%s]", (_id, p) => {
    const bundle = batch.load(p);
    const enumRoles = new Set(roles.DISTRACTOR_ROLES[bundle["item_type"]]);
    const used = new Set<string>();
    for (const it of bundle["items"]) {
      for (const o of it["options"]) if (o["role"] !== "correct") used.add(o["role"]);
    }
    const reachable = min([enumRoles.size, 3 * bundle["items"].length]);
    const outside = [...used].filter((r) => !enumRoles.has(r));
    expect(outside, `roles outside the enum: ${JSON.stringify(outside)}`).toEqual([]);
    expect(
      used.size,
      `${used.size} of a reachable ${reachable} roles used; unused: ${JSON.stringify(sorted([...enumRoles].filter((r) => !used.has(r))))}`,
    ).toBeGreaterThanOrEqual(reachable);
  });

  /** Every picture an item asks for is one somebody could commission.
   *
   *  This is the per-bundle half of the shared-bank rule. The other half — that
   *  the bank is actually smaller than the library — is asserted across the whole
   *  library below, because it is not true of one small batch and should not be:
   *  a batch of six spread across six settings cannot repeat a scene, and
   *  contorting the content so it could would be writing items to suit a test.
   *
   *  Types with no scene bank are exempt rather than excused: a reading item has
   *  no picture to share, and demanding one would be demanding art nobody should
   *  draw. */
  test.for(byId(COMMITTED))("every committed batch draws its scenes from the bank [%s]", ([_id, p], ctx) => {
    const bundle = batch.load(p);
    const bank = new Set(seedtable.load(bundle["item_type"]).scene_bank);
    if (bank.size === 0) {
      ctx.skip(`${bundle["item_type"]} has no scene bank`);
    }
    const scenes: string[] = bundle["items"].filter((it: Item) => get(it, "scene_id")).map((it: Item) => it["scene_id"]);
    expect(scenes.length, "a type with a scene bank should set scene_id on its items").toBeGreaterThan(0);
    const unknown = sorted(new Set(scenes.filter((s) => !bank.has(s))));
    expect(unknown, `not in the bank: ${JSON.stringify(unknown)}`).toEqual([]);
  });

  /** The shared bank, as an economic fact rather than an aspiration.
   *
   *  A thousand items cannot have a thousand drawings — but the reason that
   *  matters is quality, not cost: because one picture serves many items, the
   *  picture cannot contain the answer, and an illustration specific enough to
   *  give the situation away would make the listening optional. */
  test("the library reuses its scenes", () => {
    // A 画像把握 picture is one per item by design, and is not what the bank
    // is for; it is left out of the count rather than diluting it.
    const scenes = _served()
      .filter(([, it]) => get(it, "scene_id") && !get(it, "image_brief"))
      .map(([, it]) => it["scene_id"]);
    expect(scenes.length).toBeGreaterThan(0);
    const distinct = new Set(scenes).size;
    expect(
      distinct < scenes.length / 2,
      `${distinct} scenes for ${scenes.length} items — that is close to `
      + "one drawing each, which is the thing the bank exists to avoid",
    ).toBe(true);
  });
});

// ----- the library as a whole ---------------------------------------------
//
// checkBundle looks at one bundle and cannot see the others. Three invariants
// only exist across the shipped library, and all three can break as soon as
// there is more than one batch.

/** (bundle filename, item) for every committed item, withdrawn or not.
 *
 *  For the invariants about keys — ids and seed cells — which a withdrawn item
 *  still holds: its row stays in the database, and its cell stays spent. */
function _library(): [string, Item][] {
  return COMMITTED.flatMap((p) => (batch.load(p)["items"] as Item[]).map((it): [string, Item] => [path.basename(p), it]));
}

/** (bundle filename, item) for every item a learner can still be served:
 *  the library less batches/withdrawn.txt. The sweeps about what a learner
 *  meets are over this. */
function _served(): [string, Item][] {
  const gone = withdrawn.ids();
  return _library().filter(([, it]) => !gone.has(it["id"]));
}

describe("the library as a whole", () => {
  /** A cell is consumed at most once. Reusing one is not merely a repeated
   *  question — it is worse: `itemId` is a hash of (item type, cell), so the
   *  second item silently REPLACES the first on publish and the library shrinks
   *  without saying so. */
  test("no seed cell is spent twice across the library", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const p of COMMITTED) {
      const bundle = batch.load(p);
      for (const it of bundle["items"]) {
        const cellId = get(or(get(it, "seed_cell"), {}), "id");
        const key = JSON.stringify([bundle["item_type"], cellId]);
        if (seen.has(key)) {
          clashes.push(`${cellId} in both ${seen.get(key)} and ${path.basename(p)}`);
        }
        seen.set(key, path.basename(p));
      }
    }
    expect(clashes).toEqual([]);
  });

  /** `bjt publish` upserts on id. Two items sharing one is data loss. */
  test("item ids are unique across the library", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const [name, it] of _library()) {
      if (seen.has(it["id"])) {
        clashes.push(`${it["id"]} in both ${seen.get(it["id"])} and ${name}`);
      }
      seen.set(it["id"], name);
    }
    expect(clashes).toEqual([]);
  });

  /** Two batches can each be internally varied and still ask the same question.
   *  A learner meets the whole library, not one bundle, so the dedupe threshold
   *  has to hold across bundle boundaries too. */
  test("no near duplicates across the library", () => {
    const lib = _served();
    const sigs = lib.map(([name, it]): [string, Item, string] => [name, it, dedupe.itemSignature(it)]);
    const collisions: string[] = [];
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        const [[na, ia, sa], [nb, ib, sb]] = [sigs[i], sigs[j]];
        if (na === nb) {
          continue;  // checkBundle already covers within-bundle pairs
        }
        const score = dedupe.similarity(sa, sb);
        if (score >= dedupe.DEFAULT_THRESHOLD) {
          collisions.push(
            `${ia["topic"]} [${na}] ~ ${ib["topic"]} [${nb}] at ${fixed(score, 2)}`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });
});

describe("bundle checks on the reference batch", () => {
  test("empty bundle fails", () => {
    const report = batch.checkBundle({ "item_type": "hatsugen_choukai", "items": [] });
    expect(report.ok).toBe(false);
  });

  test("duplicate seed cells fail", () => {
    const b = deepcopy(bundleFixture());
    b["items"][1]["seed_cell"] = { ...b["items"][0]["seed_cell"] };
    expect(_status(batch.checkBundle(b), "seed cells distinct")).toBe("fail");
  });

  test("a repeated question fails", () => {
    const b = deepcopy(bundleFixture());
    b["items"][1]["stem"] = b["items"][0]["stem"];
    b["items"][1]["options"] = deepcopy(b["items"][0]["options"]);
    b["items"][1]["correct_index"] = b["items"][0]["correct_index"];
    expect(_status(batch.checkBundle(b), "no near-duplicates")).toBe("fail");
  });

  test("answer drifting to one position warns", () => {
    const b = deepcopy(bundleFixture());
    for (const it of b["items"]) {
      const ci = it["correct_index"];
      [it["options"][0], it["options"][ci]] = [it["options"][ci], it["options"][0]];
      it["correct_index"] = 0;
    }
    expect(_status(batch.checkBundle(b), "answer position spread")).toBe("warn");
  });

  test("correct option always longest warns", () => {
    const b = deepcopy(bundleFixture());
    for (const it of b["items"]) {
      it["options"][it["correct_index"]]["text"] += "、どうぞよろしくお願いいたします。";
    }
    expect(_status(batch.checkBundle(b), "length does not leak")).toBe("warn");
  });

  test("a tie for longest is not treated as a leak", () => {
    const it = { "correct_index": 0, "options": [{ "text": "あいうえお" }, { "text": "あいうえお" },
                                                  { "text": "あい" }, { "text": "あ" }] };
    expect(batch._correctIsExtreme(it, { longest: true })).toBe(false);
  });

  test("thin why fails", () => {
    const b = deepcopy(bundleFixture());
    b["items"][0]["options"][1]["why"] = "だめ。";
    expect(_status(batch.checkBundle(b), "per-option why")).toBe("fail");
  });

  test("scene outside the bank fails", () => {
    const b = deepcopy(bundleFixture());
    b["items"][0]["scene_id"] = "scene_moon_base";
    expect(_status(batch.checkBundle(b), "scenes come from the bank")).toBe("fail");
  });

  test("an overlong stem is noted", () => {
    const b = deepcopy(bundleFixture());
    b["items"][0]["stem"] = "あ".repeat(batch.STEM_MAX_CHARS + 1);
    expect(_status(batch.checkBundle(b), "length matches the exam")).toBe("note");
  });

  /** The band reports `pass` rather than merely not failing, so that a clean
   *  bundle is distinguishable from one nobody measured. */
  test("a bundle inside every band passes", () => {
    const b = deepcopy(bundleFixture());
    const bands = batch.LENGTH_BANDS["hatsugen_choukai"];
    const mid = (f: string) => "あ".repeat(floorDiv(bands[f][0] + bands[f][1], 2));
    for (const it of b["items"]) {
      it["stem"] = mid("stem");
      (it["options"] as Item[]).forEach((o, i) => {
        // Distinct, or the no-duplicate-text check fires instead.
        o["text"] = slice(mid("option"), 0, -1) + [..."アイウエ"][i];
      });
    }
    expect(_status(batch.checkBundle(b), "length matches the exam")).toBe("pass");
  });

  /** 語彙・文法 options are two to six characters on the real paper. A
   *  fifteen-character filler is a 表現読解 option in the wrong type, and the band
   *  is what says so — for the options, not only for the stem. */
  test("options are measured against their own band", () => {
    const b = deepcopy(bundleFixture());
    const [_low, high] = batch.LENGTH_BANDS["hatsugen_choukai"]["option"];
    b["items"][0]["options"][0]["text"] = "あ".repeat(high + 10);
    const note = batch.checkBundle(b).checks.find((c) => c.name === "length matches the exam")!;
    expect(note.status).toBe("note");
    expect(note.detail).toContain("option");
  });

  /** A note says the item is unlike the exam; a warning says it is wrong. The
   *  committed bundles lean on that distinction — several of them are shorter
   *  than the exam and every one of them still ships. */
  test("a length note is not a warning", () => {
    const b = deepcopy(bundleFixture());
    b["items"][0]["stem"] = "あ".repeat(batch.STEM_MAX_CHARS + 1);
    const report = batch.checkBundle(b);
    expect(report.ok).toBe(true);
    expect(report.noted.map((c) => c.name)).toEqual(["length matches the exam"]);
    expect(report.warned.map((c) => c.name)).not.toContain("length matches the exam");
  });
});

// ----- bundle round trip --------------------------------------------------

/** A bundle's items without the difficulty probe's measurement.
 *
 *  `bjt probe --all` (bjt/backfill.ts) writes `model_p_correct` into a bundle
 *  after it was built: a measurement of the question, not part of what a
 *  person wrote, so the source never carries it and `importbatch` never writes
 *  it (`batch.asGeneratorShape` drops it too). The round trip compares what
 *  a person wrote. */
function _unmeasured(items: Record<string, any>[]): Record<string, any>[] {
  return items.map((it) => Object.fromEntries(Object.entries(it).filter(([k]) => k !== "model_p_correct")));
}

/** Bundle item back to the shape the generator emits. */
function _asSource(bundleItem: Item): Item {
  return Object.fromEntries(Object.entries(bundleItem).filter(([k]) => !["id", "audio", "correct_index"].includes(k)));
}

describe("bundle round trip", () => {
  test("item ids are stable across rebuilds", () => {
    const bundle = bundleFixture();
    const ids = bundle["items"].map((it: Item) => it["id"]);
    const rebuilt = batch.buildBundle("hatsugen_choukai", "J2",
                                      bundle["items"].map((it: Item) => _asSource(it)), "test");
    expect(rebuilt["items"].map((it: Item) => it["id"])).toEqual(ids);
  });

  test("save and load round trip", () => {
    const bundle = bundleFixture();
    const tmp = tmpPath();
    const p = batch.save(bundle, { path: path.join(tmp, "b.json") });
    expect(JSON.parse(readFileSync(p, "utf8"))["items"]).toEqual(bundle["items"]);
  });

  test("default path does not overwrite", () => {
    const tmp = tmpPath();
    setConfig({ BATCH_DIR: tmp });
    const first = batch.defaultPath("hatsugen_choukai", "J2");
    writeFileSync(first, "{}", "utf8");
    expect(batch.defaultPath("hatsugen_choukai", "J2")).not.toBe(first);
  });
});

// ----- the CLI paths ------------------------------------------------------

describe("the CLI paths", () => {
  test("checkbatch exits zero on the reference bundle", async () => {
    const cap = capture();
    expect(await cli.main({ argv: ["checkbatch", REFERENCE] })).toBe(0);
    expect(cap.readouterr().out).toContain("SHIPPABLE");
  });

  /** The source file is the thing a human edits; the bundle is derived. If the
   *  two ever drift, the committed bundle is stale.
   *
   *  Only the hand-written bundles — the nightly job's have no source to drift
   *  from. See HAND_WRITTEN. */
  test.each(byId(HAND_WRITTEN))("importbatch reproduces the committed bundle [%s]", async (_id, p) => {
    const tmp = tmpPath();
    setConfig({ DB_PATH: path.join(tmp, "t.db") });
    const out = path.join(tmp, "rebuilt.json");
    const src = _sourceOf(p);
    expect(await cli.main({ argv: ["importbatch", src, "--out", out] })).toBe(0);
    const [rebuilt, committed] = [batch.load(out), batch.load(p)];
    expect(rebuilt["items"]).toEqual(_unmeasured(committed["items"]));
    expect(rebuilt["audio_manifest"]).toEqual(committed["audio_manifest"]);
  });

  test("importbatch rejects an unknown seed cell", async () => {
    const tmp = tmpPath();
    setConfig({ DB_PATH: path.join(tmp, "t.db") });
    const src = JSON.parse(readFileSync(_sourceOf(REFERENCE), "utf8"));
    src["items"] = src["items"].slice(0, 1);
    src["items"][0]["seed_cell_id"] = "nowhere+nobody+nothing@J2";
    const p = path.join(tmp, "bad.source.json");
    writeFileSync(p, dumps(src, { ensureAscii: false }), "utf8");
    expect(await cli.main({ argv: ["importbatch", p, "--out", path.join(tmp, "o.json")] })).toBe(1);
  });

  test("importbatch marks the cells used", async () => {
    const tmp = tmpPath();
    setConfig({ DB_PATH: path.join(tmp, "t.db") });
    const src = _sourceOf(REFERENCE);
    await cli.main({ argv: ["importbatch", src, "--out", path.join(tmp, "o.json")] });
    const store = new Store({ path: path.join(tmp, "t.db") });
    try {
      expect(store.usedCellIds("hatsugen_choukai").size).toBe(10);
    } finally {
      store.close();
    }
  });
});

// ----- the spent-cell ledger ---------------------------------------------
//
// The ledger is the committed bundles, not the gitignored SQLite database, so a
// fresh clone does not believe every cell is free and re-spend cells the library
// has already used. `itemId` hashes (item type, cell), so the duplicate would
// replace the original on publish.

describe("the spent-cell ledger", () => {
  /** Every cell in a committed bundle counts as spent, from the repo alone. */
  test("spent cells are readable without the local database", () => {
    const spent = batch.spentCellIds("hatsugen_choukai");
    const committed = new Set(
      _library()
        .filter(([name]) => name.startsWith("hatsugen_choukai_"))
        .map(([, it]) => get(or(get(it, "seed_cell"), {}), "id")),
    );
    expect(spent).toEqual(committed);
    expect(spent.size, "the reference batches should have spent some cells").toBeGreaterThan(0);
  });

  /** A cell id names a cell within its own table; two types can legitimately
   *  enumerate the same setting and function, so the ledger must not pool them. */
  test("spent cells are scoped to one item type", () => {
    for (const itemType of ["hatsugen_choukai", "goi_bunpou"]) {
      const spent = batch.spentCellIds(itemType);
      const committed = new Set(
        _library()
          .filter(([name]) => name.startsWith(`${itemType}_`))
          .map(([, it]) => get(or(get(it, "seed_cell"), {}), "id")),
      );
      expect(spent).toEqual(committed);
    }
  });

  /** `*.source.json` is the input to importbatch, not a bundle. Counting both
   *  would double every cell a hand-written batch spends. */
  test("source files are not counted as bundles", () => {
    const tmp = tmpPath();
    setConfig({ BATCH_DIR: tmp });
    const cell = { "id": "a+b+c@J2" };
    const bundle = { "item_type": "t", "level": "J2", "items": [{ "seed_cell": cell }] };
    writeFileSync(path.join(tmp, "t_J2_001.json"), dumps(bundle), "utf8");
    writeFileSync(path.join(tmp, "t_J2_001.source.json"), dumps(bundle), "utf8");

    expect(batch.bundles({ itemType: "t" }).map((p) => path.basename(p))).toEqual(["t_J2_001.json"]);
    expect(batch.spentCellIds("t")).toEqual(new Set(["a+b+c@J2"]));
  });

  /** An unreadable file must not make any cell look free — that is the
   *  failure mode this whole ledger exists to prevent. Skipped, the damaged
   *  bundle's own cells would be handed out again and the new items would
   *  take over its questions' ids; so the ledger refuses to answer and names
   *  the file. */
  test("a damaged bundle stops the ledger rather than freeing its cells", () => {
    const tmp = tmpPath();
    setConfig({ BATCH_DIR: tmp });
    writeFileSync(
      path.join(tmp, "t_J2_001.json"),
      dumps({ "item_type": "t", "level": "J2", "items": [{ "seed_cell": { "id": "x@J2" } }] }),
      "utf8",
    );
    writeFileSync(path.join(tmp, "t_J2_002.json"), "{ not json", "utf8");
    expect(() => batch.spentCellIds("t")).toThrow(ValueError);
    expect(() => batch.spentCellIds("t")).toThrow(/t_J2_002\.json/);
  });
});

describe("answer position in a small batch", () => {
  /** The share rule needs eight items before a 45% lean means anything, so a
   *  batch of six with every answer in the same place needs its own rule. "The
   *  answer is always A" is the most exploitable pattern there is, and a new
   *  item type's first batch is exactly that size. */
  test("a small batch that always answers a is caught", () => {
    const bundle = bundleFixture();
    bundle["items"] = bundle["items"].slice(0, 6);
    for (const item of bundle["items"]) {
      const options = item["options"];
      const [correct] = options.splice(item["correct_index"], 1);
      item["options"] = [correct, ...options];
      item["correct_index"] = 0;
    }

    const report = batch.checkBundle(bundle);
    const check = report.checks.find((c) => c.name === "answer position spread")!;
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("only ever lands in 1 of 4");
  });

  test("two positions out of four is still a pattern", () => {
    const bundle = bundleFixture();
    (bundle["items"].slice(0, 6) as Item[]).forEach((item, i) => {
      const options = item["options"];
      const [correct] = options.splice(item["correct_index"], 1);
      const target = i % 2;
      options.splice(target, 0, correct);
      item["options"] = options;
      item["correct_index"] = target;
    });
    bundle["items"] = bundle["items"].slice(0, 6);
    const check = batch.checkBundle(bundle).checks.find((c) => c.name === "answer position spread")!;
    expect(check.status).toBe("warn");
  });

  test("three positions is enough for a small batch", () => {
    const bundle = bundleFixture();
    (bundle["items"].slice(0, 6) as Item[]).forEach((item, i) => {
      const options = item["options"];
      const [correct] = options.splice(item["correct_index"], 1);
      const target = i % 3;
      options.splice(target, 0, correct);
      item["options"] = options;
      item["correct_index"] = target;
    });
    bundle["items"] = bundle["items"].slice(0, 6);
    const check = batch.checkBundle(bundle).checks.find((c) => c.name === "answer position spread")!;
    expect(check.status).toBe("pass");
  });

  /** The bundle normalises documents to a list; the validator checks the
   *  type's own field, which is singular for three of the four. Left
   *  untranslated, every document item would fail its own re-validation with
   *  "missing field: document" while being perfectly well formed. */
  test("a document item re validates after bundling", () => {
    for (const itemType of ["joukyou_haaku", "shiryou_choudokkai", "sougou_dokkai",
                            "sougou_choudokkai", "sougou_choukai"]) {
      const bundle = batch.buildBundle(
        itemType, fixtures.FIXTURES[itemType]["level"],
        [fixtures.FIXTURES[itemType]], "test",
      );
      const report = batch.checkBundle(bundle);
      const validity = report.checks.find((c) => c.name === "item validity")!;
      expect(validity.status, `${itemType}: ${validity.detail}`).toBe("pass");
    }
  });
});

// ----- tells only the whole library can show ----------------------------

function _correctIsUniquely(item: Item, opts: { longest: boolean }): boolean {
  const lens = (item["options"] as Item[]).map((o) => len(o["text"]));
  const want = opts.longest ? max(lens) : min(lens);
  return lens[item["correct_index"]] === want && lens.filter((x) => x === want).length === 1;
}

describe("tells only the whole library can show", () => {
  /** "Pick the longest option" must not beat guessing, per TYPE.
   *
   *  checkBundle has this test too, but per bundle — and a bundle is two to six
   *  items, so a habit that runs through a whole type is invisible to it. A
   *  fully-specified correct answer among terse distractors, item after item,
   *  lets a learner pass the type without reading a word of Japanese. The sweep
   *  here is over the library because the library is the thing a learner meets. */
  test.each(["longest", "shortest"])("no type lets you pass it by option length [%s]", (extreme) => {
    const byType = new Map<string, [number, number]>();
    const gone = withdrawn.ids();
    for (const p of COMMITTED) {
      const bundle = JSON.parse(readFileSync(p, "utf8"));
      for (const item of withdrawn.liveItems(bundle, { withdrawn: gone })) {
        if (!byType.has(bundle["item_type"])) byType.set(bundle["item_type"], [0, 0]);
        const [hit, n] = byType.get(bundle["item_type"])!;
        byType.set(bundle["item_type"], [
          hit + Number(_correctIsUniquely(item, { longest: extreme === "longest" })),
          n + 1,
        ]);
      }
    }
    // Under 8 items a run of three proves nothing; the bank's smallest shelves
    // are there, and failing them would be failing arithmetic.
    const skewed = Object.fromEntries(
      [...byType].filter(([, [hit, n]]) => n >= 8 && hit / n > 0.5).map(([t, [hit, n]]) => [t, `${hit}/${n}`]),
    );
    expect(skewed, `correct option is the ${extreme} in: ${JSON.stringify(skewed)}`).toEqual({});
  });
});

// ----- a graph in a bundle ----------------------------------------------------

function _chartBundle(): Item {
  const item = deepcopy(fixtures.CHART_FIXTURE);
  item["seed_cell"] = { "id": "figures_meeting+superior_to_subordinate+choose_the_option@J2",
                        "setting": "figures_meeting", "relation": "superior_to_subordinate",
                        "function": "choose_the_option", "level": "J2", "channel": "in_person" };
  return batch.buildBundle("shiryou_choudokkai", "J2", [item], "test");
}

describe("a graph in a bundle", () => {
  /** A chart must pass the same checks as everything else, the numeral rule
   *  and the length band included. */
  test("a bundle with a chart ships", () => {
    const report = batch.checkBundle(_chartBundle());
    expect(report.ok, asPairs(report.failed)).toBe(true);
    expect(report.warned, asPairs(report.warned)).toEqual([]);
    expect(report.noted, asPairs(report.noted)).toEqual([]);
  });

  /** `toBundleItem` rewrites a chart's labels on the way in, so a spelled-out
   *  one in a bundle means somebody edited the JSON by hand — the same failure
   *  as a spelled-out table heading. */
  test("a hand edited chart label spelled out fails the bundle", () => {
    const bundle = _chartBundle();
    bundle["items"][0]["documents"][0]["blocks"][0]["categories"][0] = "四月";
    const check = batch.checkBundle(bundle).checks.find((c) => c.name === "numbers are written as digits")!;
    expect(check.status === "fail" && check.detail.includes("四")).toBe(true);
  });

  /** Documents are JSON text and the chart's figures travel as JSON numbers:
   *  no migration, no block list in the schema to update, and nothing a JSON
   *  parser — SQLite's json_valid() included — would refuse (NaN never gets
   *  this far). */
  test("a chart publishes as numbers in the documents column", () => {
    const sql = publish.bundleSql(_chartBundle(), "shiryou_choudokkai_J2_999", { withdrawnIds: new Set() });
    const literal = [...sql.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]).find((m) => m.includes('"chart"'))!;
    const documents = JSON.parse(literal.replaceAll("''", "'"));
    const series = documents[0]["blocks"][0]["series"];
    expect(series[0]["values"]).toEqual([330, 410, 340, 260, 240, 460]);
    expect(!sql.includes("NaN") && !sql.includes("Infinity")).toBe(true);
  });

  test("a chart the validator refuses fails the bundle", () => {
    const bundle = _chartBundle();
    bundle["items"][0]["documents"][0]["blocks"][0]["series"][0]["values"][2] = 12_500_000;
    const check = batch.checkBundle(bundle).checks.find((c) => c.name === "item validity")!;
    expect(check.status === "fail" && check.detail.includes("six digits")).toBe(true);
  });
});

describe("the key is not the only option off the document", () => {
  /** The 資料聴読解 fixture with three distractors copied off its timetable. */
  function _offPage(key: string): Item {
    const it = deepcopy(fixtures.FIXTURES["shiryou_choudokkai"]);
    const texts = [key, "経理部 月次", "営業部 定例", "採用面接"];
    it["options"].forEach((o: Item, i: number) => { o["text"] = texts[i]; });
    return it;
  }

  test("a key the document does not print among three it does is sent back", () => {
    const found = batch.keyOnlyOffDocument(_offPage("総務部 研修"));
    expect(found).toContain("総務部 研修");
    expect(found).toContain("only option the document does not print");
  });

  test("a key the document prints is not a tell", () => {
    expect(batch.keyOnlyOffDocument(_offPage("空き"))).toBeNull();
  });

  test("a distractor off the page as well is not a tell", () => {
    const it = _offPage("総務部 研修");
    it["options"][1]["text"] = "人事部 説明会";
    expect(batch.keyOnlyOffDocument(it)).toBeNull();
  });

  test("an item with no document says nothing", () => {
    expect(batch.keyOnlyOffDocument(deepcopy(fixtures.FIXTURES["hatsugen_choukai"]))).toBeNull();
  });

  test("the fixture passes", () => {
    expect(batch.keyOnlyOffDocument(deepcopy(fixtures.FIXTURES["shiryou_choudokkai"]))).toBeNull();
  });

  test("a served item with the tell fails its bundle, and the ledger excuses it", () => {
    // 3abf299a57: a room changed aloud, and the new room the one option off
    // the timetable. Withdrawn, so the committed bundle passes; served, it fails.
    const b = batch.load(path.join(BATCHES, "shiryou_choudokkai_J3_001.json"));
    const name = "key is not the only option off the document";
    expect(_status(batch.checkBundle(b, { withdrawnIds: [] }), name)).toBe("fail");
    expect(_status(batch.checkBundle(b), name)).toBe("pass");
  });
});
