/**
 * The nightly work order, and the difficulty estimate that travels with an item.
 *
 * Both exist to serve the practice queue, and both are the kind of thing that can
 * quietly stop working without anything failing: a planner that always picks the
 * same shelf still produces items, and a bundle that drops the gate's rate still
 * publishes. So the assertions here are about the properties rather than about the
 * numbers — emptiest first, budget respected, deterministic, and the estimate
 * survives the round trip into SQL.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as batchmod from "../bjt/batch.ts";
import * as cli from "../bjt/cli/index.ts";
import * as fixtures from "../bjt/fixtures.ts";
import * as plan from "../bjt/plan.ts";
import * as publish from "../bjt/publish.ts";
import { rstrip, sorted, strip, sum, toInt } from "../bjt/py.ts";
import { dumps } from "../bjt/pyjson.ts";
import * as schemas from "../bjt/schemas.ts";
import { after, before, capture, patch, tmpPath } from "./helpers.ts";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");

type Row = [string, string, number, number];

/** A survey built by hand, so the assertions are about the algorithm rather
 *  than about whatever happens to be committed in batches/ today. */
function _survey(...shelves: Row[]): plan.Survey {
  return new plan.Survey({
    shelves: shelves.map(([t, lv, have, cells]) => new plan.Shelf({ item_type: t, level: lv, have: have, cells_left: cells })),
  });
}

/** `{w.item_type: w.n for w in order}` (the last line of a type wins, as in
 *  a dict comprehension). */
function byTypeOf(order: plan.WorkItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of order) out[w.item_type] = w.n;
  return out;
}

const at = (d: Record<string, number>, k: string, dflt: number = 0): number => (k in d ? d[k] : dflt);

describe("the work order", () => {
  test("work order fills the emptiest shelf first", () => {
    const order = plan.workOrder(
      _survey(["a", "J2", 10, 100], ["b", "J2", 0, 100], ["c", "J2", 4, 100]),
      { budget: 6, perSlot: 6 },
    );
    const byType = byTypeOf(order);
    // b is empty and c has four, so they level up before a is touched at all.
    expect(byType["b"]).toBeGreaterThan(at(byType, "c"));
    expect("a" in byType).toBe(false);
    expect(sum(Object.values(byType))).toBe(6);
  });

  /** Given enough budget, the shelves end up within one item of each other. */
  test("work order levels rather than deepening", () => {
    const order = plan.workOrder(
      _survey(["a", "J2", 0, 100], ["b", "J2", 0, 100], ["c", "J2", 6, 100]),
      { budget: 12, perSlot: 12 },
    );
    const ends: Record<string, number> = {};
    for (const [t, have] of [["a", 0], ["b", 0], ["c", 6]] as [string, number][]) {
      ends[t] = have;
    }
    for (const w of order) {
      ends[w.item_type] += w.n;
    }
    expect(Math.max(...Object.values(ends)) - Math.min(...Object.values(ends))).toBeLessThanOrEqual(1);
  });

  test("work order respects the two caps", () => {
    const order = plan.workOrder(
      _survey(["a", "J2", 0, 100], ["b", "J2", 0, 100]), { budget: 7, perSlot: 2 },
    );
    expect(sum(order.map((w) => w.n)), "per_slot caps both shelves at two").toBe(4);
    expect(order.every((w) => w.n <= 2)).toBe(true);
  });

  /** A shelf with three cells left gets three items, not six. */
  test("work order stops at the end of the seed table", () => {
    const order = plan.workOrder(_survey(["a", "J2", 0, 3]), { budget: 20, perSlot: 10 });
    expect(order.map((w) => w.n)).toEqual([3]);
  });

  test("work order is deterministic", () => {
    const survey = _survey(["a", "J2", 1, 50], ["b", "J3", 1, 50], ["c", "J1", 1, 50]);
    const first = plan.workOrder(survey, { budget: 5, perSlot: 5 });
    const second = plan.workOrder(survey, { budget: 5, perSlot: 5 });
    expect(
      first.map((w) => [w.item_type, w.level, w.n]),
      "the same library must produce the same plan, or it cannot be reviewed",
    ).toEqual(second.map((w) => [w.item_type, w.level, w.n]));
  });

  test("work order is empty when every shelf is exhausted", () => {
    expect(plan.workOrder(_survey(["a", "J2", 40, 0]), { budget: 10 })).toEqual([]);
  });

  /** The bundles are the ledger, so the real tree is what this reports on. */
  test("survey counts the committed library", () => {
    const survey = plan.survey();
    expect(survey.shelves.length, "ten types × three levels should not be empty").toBeGreaterThan(0);
    // Every type with a seed table gets a shelf per level in that table.
    expect(new Set(survey.shelves.map((s) => s.item_type)).size).toBe(10);
    expect(survey.items).toBeGreaterThan(0);
    const hatsugen = Object.fromEntries(
      survey.shelves.filter((s) => s.item_type === "hatsugen_choukai").map((s) => [s.level, s]),
    );
    expect(hatsugen["J2"].have).toBeGreaterThan(0);
    expect(hatsugen["J2"].cells_left).toBeGreaterThan(0);
  });

  test("render names the thin shelves", () => {
    const text = plan.render(
      _survey(["a", "J2", 0, 10]), plan.workOrder(_survey(["a", "J2", 0, 10]), { budget: 2, perSlot: 2 }),
    );
    expect(text).toContain("thin");
    expect(text).toContain("2 × a J2");
  });
});

// ----- the difficulty estimate travels with the item ---------------------

function _bundleWithRate(rate: number | null): Record<string, any> {
  let item = { ...fixtures.FIXTURES["goi_bunpou"] };
  item = JSON.parse(dumps(item)); // deep, and JSON-clean
  item["seed_cell"] = {
    "id": "x+y+z@J2", "setting": "x", "relation": "y",
    "function": "z", "level": "J2", "channel": "written",
  };
  if (rate !== null) {
    item["model_p_correct"] = rate;
  }
  return batchmod.buildBundle("goi_bunpou", "J2", [item], "test-model");
}

describe("the difficulty estimate travels with the item", () => {
  test("bundle carries the gates success rate", () => {
    const bundle = _bundleWithRate(2 / 3);
    expect(bundle["items"][0]["model_p_correct"]).toBeCloseTo(2 / 3);
  });

  /** Hand-written batches skip the gate, and absent is the honest value —
   *  writing 1.0 there would tell the queue every reference item is trivial. */
  test("bundle omits the rate when the gate did not run", () => {
    const bundle = _bundleWithRate(null);
    expect("model_p_correct" in bundle["items"][0]).toBe(false);
  });

  /** checkbatch re-runs the item validator over a bundle item, so a
   *  bundle-only field has to be stripped on the way back. */
  test("the rate does not break re-validation", () => {
    const bundle = _bundleWithRate(0.5);
    const shape = batchmod.asGeneratorShape(bundle["items"][0]);
    expect("model_p_correct" in shape).toBe(false);
    expect(schemas.validateItem("goi_bunpou", shape)).toEqual([]);
  });

  test("publish writes the rate and a null when there is none", () => {
    const withRate = publish.bundleSql(_bundleWithRate(0.75), "b1");
    expect(withRate).toContain("model_p_correct");
    expect(withRate).toContain("0.75");

    const without = publish.bundleSql(_bundleWithRate(null), "b2");
    expect(without, "the column is always named").toContain("model_p_correct");
    // ...and the value for it is null rather than a made-up number. The items
    // statement is the one that carries it; the bundles statement above it does
    // not, so the row has to be located rather than taken off the end.
    const itemsStmt = after(without, "insert into items ");
    const row = before(after(itemsStmt, "values "), " on conflict");
    expect(rstrip(row).endsWith("null)")).toBe(true);
  });
});

// ----- the reading floor ------------------------------------------------------

function _mixedSurvey(): plan.Survey {
  return _survey(
    ["bamen_haaku", "J2", 0, 100], ["sougou_choukai", "J1", 0, 100],
    ["joukyou_haaku", "J3", 1, 100],
    ["goi_bunpou", "J2", 6, 100], ["hyougen", "J1", 5, 100], ["sougou_dokkai", "J3", 9, 100],
  );
}

/** `item_types` as the D1 migrations seed it: id → (section, exam_questions). */
function _itemTypeRows(): Record<string, [string, number]> {
  const dir = path.join(ROOT_DIR, "d1", "migrations");
  const sql = sorted(readdirSync(dir).filter((n) => n.endsWith(".sql")))
    .map((n) => readFileSync(path.join(dir, n), "utf8"))
    .join("\n");
  const rows: Record<string, [string, number]> = {};
  for (const stmt of sql.match(/insert (?:or ignore )?into item_types\b[\s\S]*?;/g) ?? []) {
    for (const m of stmt.matchAll(/\(('[a-z_]+'.*?)\)\s*[,;]/g)) {
      const fields = m[1].split(",").map((f) => strip(f));
      rows[strip(fields[0], "'")] = [strip(fields[1], "'"), toInt(fields[fields.length - 1])];
    }
  }
  expect(Object.keys(rows).length, "no migration seeds item_types").toBeGreaterThan(0);
  return rows;
}

describe("the reading floor", () => {
  /** Three listening shelves are emptier than every reading shelf, and the
   *  reading floor still takes its three first — emptiest reading shelf first. */
  test("reading items are written every night even when deeper", () => {
    const order = plan.workOrder(_mixedSurvey(), { budget: 8, perSlot: 3, readingMin: 3 });
    const byType = byTypeOf(order);
    expect(sum(schemas.READING_TYPES.map((t) => at(byType, t)))).toBe(3);
    expect(byType["hyougen"]).toBeGreaterThanOrEqual(byType["goi_bunpou"]);
    expect(byType["goi_bunpou"]).toBeGreaterThanOrEqual(at(byType, "sougou_dokkai"));
    expect(sum(Object.values(byType))).toBe(8);
    // ...and the rest still goes to the emptiest shelves of all, levelled.
    expect(byType["bamen_haaku"] === 2 && byType["sougou_choukai"] === 2).toBe(true);
    expect(byType["joukyou_haaku"]).toBe(1);
  });

  /** The night runs the order top to bottom and its ceiling can end it after
   *  any line, so "reading first" has to be the order's, not just the count's:
   *  the emptier listening shelves come after the floor, never before it. */
  test("the reading floor is executed first", () => {
    const order = plan.workOrder(_mixedSurvey(), { budget: 8, perSlot: 3, readingMin: 3 });
    const kinds = order.map((w) => schemas.READING_TYPES.includes(w.item_type));
    expect(kinds, JSON.stringify(order.map((w) => w.item_type))).toEqual(sorted(kinds, { reverse: true }));
    // Among the floor's lines, and among the rest, furthest behind first.
    expect(order.map((w) => w.item_type)).toEqual([
      "hyougen", "goi_bunpou", "bamen_haaku", "sougou_choukai", "joukyou_haaku"]);
  });

  /** The shape of the default night: one reading item and one other, the
   *  emptiest shelf in the bank. The reading one is first, so a night the
   *  fifty-cent ceiling ends after one shelf still has it. */
  test("a nights first line is reading even beside an empty listening shelf", () => {
    const order = plan.workOrder(
      _survey(["gazou_haaku", "J1", 0, 100], ["sougou_choudokkai", "J1", 1, 100],
              ["hyougen", "J3", 2, 100]),
      { budget: plan.DEFAULT_BUDGET, perSlot: plan.DEFAULT_PER_SLOT, readingMin: plan.DEFAULT_READING_MIN },
    );
    expect(order[0].item_type).toBe("hyougen");
    expect(order.slice(1).map((w) => w.item_type)).toEqual(["gazou_haaku"]);
  });

  test("a shelf both passes reached is one line at the floors place", () => {
    const order = plan.workOrder(
      _survey(["goi_bunpou", "J2", 0, 100], ["bamen_haaku", "J2", 0, 100]),
      { budget: 3, perSlot: 2, readingMin: 1 },
    );
    expect(order.map((w) => [w.item_type, w.n])).toEqual([["goi_bunpou", 2], ["bamen_haaku", 1]]);
  });

  test("the committed bank plans reading first", () => {
    const order = plan.workOrder(plan.survey(), {
      budget: plan.DEFAULT_BUDGET,
      perSlot: plan.DEFAULT_PER_SLOT,
      readingMin: plan.DEFAULT_READING_MIN,
    });
    expect(order.length > 0 && schemas.READING_TYPES.includes(order[0].item_type)).toBe(true);
  });

  test("the floor yields what it cannot place", () => {
    const order = plan.workOrder(
      _survey(["bamen_haaku", "J2", 0, 100], ["goi_bunpou", "J2", 0, 1]),
      { budget: 4, perSlot: 3, readingMin: 3 },
    );
    const byType = byTypeOf(order);
    expect(byType["goi_bunpou"], "one cell left, one item").toBe(1);
    expect(byType["bamen_haaku"], "the two unplaceable reading items go elsewhere").toBe(3);
  });

  test("the floor never exceeds the budget", () => {
    const order = plan.workOrder(_mixedSurvey(), { budget: 2, perSlot: 3, readingMin: 3 });
    expect(sum(order.map((w) => w.n))).toBe(2);
    expect(order.every((w) => schemas.READING_TYPES.includes(w.item_type))).toBe(true);
  });

  test("a floor of zero is the old rule", () => {
    const survey = _mixedSurvey();
    expect(plan.workOrder(survey, { budget: 5, perSlot: 3, readingMin: 0 })).toEqual(
      plan.workOrder(survey, { budget: 5, perSlot: 3, readingMin: -4 }));
    const order = plan.workOrder(survey, { budget: 5, perSlot: 3, readingMin: 0 });
    expect(order.every((w) => !schemas.READING_TYPES.includes(w.item_type))).toBe(true);
  });

  /** The planner needs the sections without a database; the migration is the
   *  authority. The two are asserted equal so neither can drift. */
  test("the section map matches the database", () => {
    expect(Object.fromEntries(Object.entries(_itemTypeRows()).map(([t, [section]]) => [t, section])))
      .toEqual(schemas.SECTIONS);
  });

  /** Same argument as the section map: the planner needs the counts with no
   *  database, the queue reads them from one, and a drift between the two would
   *  quietly build a bank in one shape and serve it in another. */
  test("the exam question counts match the database", () => {
    expect(Object.fromEntries(Object.entries(_itemTypeRows()).map(([t, [, n]]) => [t, n])))
      .toEqual(schemas.EXAM_QUESTIONS);
  });

  /** 場面把握 is a five-question type and 発言聴解 a ten-question one, so six
   *  of the first is as deep as twelve of the second — and a night with both on
   *  the shelf writes 発言聴解. */
  test("the planner fills against the share not the depth", () => {
    const order = plan.workOrder(
      _survey(["bamen_haaku", "J2", 6, 100], ["hatsugen_choukai", "J2", 6, 100]),
      { budget: 2, perSlot: 2, readingMin: 0 },
    );
    const byType = byTypeOf(order);
    expect(byType, "6/5 is fuller than 6/10; the flat rule would have split these evenly")
      .toEqual({ "hatsugen_choukai": 2 });
  });

  /** Six 場面把握 items is not thin; six 発言聴解 items is. */
  test("a thin shelf is thin against its share", () => {
    const survey = _survey(["bamen_haaku", "J2", 6, 10], ["hatsugen_choukai", "J2", 6, 10]);
    const thin = new Set(survey.thin.map((s) => s.item_type));
    expect(thin).toEqual(new Set(["hatsugen_choukai"]));
  });

  test("render says how many are reading", () => {
    const order = plan.workOrder(_mixedSurvey(), { budget: 8, perSlot: 3, readingMin: 3 });
    const text = plan.render(_mixedSurvey(), order);
    expect(text).toContain("3 of them 読解");
  });

  /** 画像把握 has three empty shelves and would otherwise be every night's
   *  emptiest; a night writes one of it, and the rest goes elsewhere. */
  test("a rare type gets at most its cap a night", () => {
    const order = plan.workOrder(
      _survey(["gazou_haaku", "J3", 0, 50], ["gazou_haaku", "J2", 0, 50],
              ["gazou_haaku", "J1", 0, 50], ["bamen_haaku", "J2", 4, 50]),
      { budget: 6, perSlot: 3, readingMin: 0 },
    );
    const byType: Record<string, number> = {};
    for (const w of order) {
      byType[w.item_type] = at(byType, w.item_type) + w.n;
    }
    expect(byType).toEqual({ "gazou_haaku": 1, "bamen_haaku": 3 });
  });
});

// ----- the difficulty signal the queue needs -----------------------------

describe("the difficulty signal the queue needs", () => {
  /** `model_p_correct` is the only term in next_items() that separates two
   *  items of the same type and level. A bundle imported offline has none, and
   *  left uncounted that is invisible — the term quietly becomes a constant. */
  test("difficulty coverage counts what carries a prior", () => {
    const tmp = tmpPath();
    const b = {
      "bundle_version": 2, "item_type": "goi_bunpou", "level": "J2",
      "generated_at": "2026-09-22T00:00:00+00:00", "generator_model": "t",
      "audio_manifest": [], "scenes": [],
      "items": [{ "id": "a", "model_p_correct": 0.6 },
                { "id": "b", "model_p_correct": null },
                { "id": "c" }],
    };
    const p = path.join(tmp, "x.json");
    writeFileSync(p, dumps(b, { ensureAscii: false }), "utf8");
    patch(batchmod.seams, "bundles", () => [p]);

    expect(plan.difficultyCoverage()).toEqual([1, 3]);
  });

  test("plan says so when the difficulty term sorts nothing", async () => {
    const cap = capture();
    patch(plan.seams, "difficultyCoverage", () => [4, 146]);
    expect(await cli.main({ argv: ["plan"] })).toBe(0);
    const out = cap.readouterr().out;
    expect(out).toContain("4/146 carry a difficulty signal");
    expect(out).toContain("sorts nothing");
    expect(out).toContain("bjt probe");
  });

  test("plan stays quiet when every item has one", async () => {
    const cap = capture();
    patch(plan.seams, "difficultyCoverage", () => [146, 146]);
    expect(await cli.main({ argv: ["plan"] })).toBe(0);
    const out = cap.readouterr().out;
    expect(out).toContain("146/146 carry a difficulty signal.");
    expect(out).not.toContain("sorts nothing");
  });

  /** `difficultyCoverage` exists so a silent gap in the difficulty signal
   *  cannot go unnoticed. It would be its own kind of silent gap if it swallowed
   *  every exception a bundle could raise, wide enough to hide a real bug in the
   *  counting loop itself. Like `_publishedCounts`, it skips only a bundle that
   *  fails to read or parse; anything else must propagate. */
  test("difficulty coverage skips an unreadable bundle but not a real bug", () => {
    const tmp = tmpPath();
    const good = path.join(tmp, "good.json");
    writeFileSync(
      good,
      dumps({ "item_type": "goi_bunpou", "level": "J2",
              "items": [{ "id": "a", "model_p_correct": 0.5 }] }),
      "utf8",
    );
    const corrupt = path.join(tmp, "corrupt.json");
    writeFileSync(corrupt, "{not json", "utf8");

    patch(batchmod.seams, "bundles", () => [good, corrupt]);
    expect(plan.difficultyCoverage(), "the corrupt bundle is skipped, not counted").toEqual([1, 1]);

    const _boom = () => [good];

    patch(batchmod.seams, "bundles", _boom);
    patch(batchmod.seams, "load", () => {
      throw new TypeError("not a bundle bug");
    });
    expect(() => plan.difficultyCoverage()).toThrow(TypeError);
  });
});
