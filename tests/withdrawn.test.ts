/**
 * The withdrawn ledger: what it may say, and what saying it does.
 *
 * A line in `batches/withdrawn.txt` takes a question out of the bank for
 * everybody. These tests hold the ledger to the library it names, the reasons to
 * the ones a tester's report uses, and the committed SQL to what `bjt publish`
 * writes from the ledger — so a line that is added and not published, or
 * published and not added, fails here rather than in front of a learner.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as batch from "../bjt/batch.ts";
import * as plan from "../bjt/plan.ts";
import * as publish from "../bjt/publish.ts";
import { deepcopy, len, sorted, ValueError } from "../bjt/py.ts";
import { shelfKey } from "../bjt/shelf_rest.ts";
import * as withdrawn from "../bjt/withdrawn.ts";
import { after, before, patch, tmpPath } from "./helpers.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const BATCHES = path.join(ROOT, "batches");
const REFERENCE = path.join(BATCHES, "hatsugen_choukai_J2_001.json");
const FEEDBACK_MIGRATION = path.join(ROOT, "d1", "migrations", "0001_initial.sql");

type Item = Record<string, any>;

function _libraryIds(): Set<string> {
  const ids = new Set<string>();
  for (const p of batch.bundles()) {
    for (const it of batch.load(p)["items"] as Item[]) ids.add(it["id"]);
  }
  return ids;
}

// ----- the committed ledger -------------------------------------------------

describe("the committed ledger", () => {
  test("the committed ledger reads", () => {
    const ledger = withdrawn.load();
    expect(Object.keys(ledger).length, "the ledger is empty — was it moved?").toBeGreaterThan(0);
    for (const w of Object.values(ledger)) {
      expect(withdrawn.REASONS).toContain(w.reason);
      expect(len(w.note), `${w.item_id}: say what is wrong, in a sentence`).toBeGreaterThanOrEqual(20);
    }
  });

  /** A typo would withdraw nothing and say it had. */
  test("every withdrawn id names a committed item", () => {
    const library = _libraryIds();
    const unknown = sorted(Object.keys(withdrawn.load()).filter((id) => !library.has(id)));
    expect(unknown, `not in any bundle: ${JSON.stringify(unknown)}`).toEqual([]);
  });

  /** One vocabulary for a tester's report and the decision it leads to. */
  test("the reasons are the ones a report uses", () => {
    const sql = readFileSync(FEEDBACK_MIGRATION, "utf8");
    const block = before(after(sql, "reason in ("), ")");
    expect([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...withdrawn.REASONS]);
  });

  /** Every bundle's SQL is exactly what `bjt publish` writes from the bundle
   *  and the ledger today. A ledger line that nobody published would leave the
   *  question in the bank; this is where that shows. */
  test("the committed sql is what publish writes", () => {
    const stale: string[] = [];
    for (const p of batch.bundles()) {
      const sql = p.replace(/\.json$/, ".sql");
      if (!existsSync(sql)) {
        continue;
      }
      if (publish.bundleSql(batch.load(p), path.basename(p, ".json")) !== readFileSync(sql, "utf8")) {
        stale.push(path.basename(sql));
      }
    }
    expect(stale, `re-run \`node bjt/main.ts publish\` for: ${JSON.stringify(stale)}`).toEqual([]);
  });
});

// ----- parsing --------------------------------------------------------------

describe("parsing", () => {
  test("a missing ledger is an empty one", () => {
    const tmp = tmpPath();
    expect(withdrawn.load({ path: path.join(tmp, "nothing.txt") })).toEqual({});
  });

  test("comments and blank lines are ignored", () => {
    const tmp = tmpPath();
    const f = path.join(tmp, "w.txt");
    writeFileSync(f, "# a comment\n\nabc123  unnatural  The option is not Japanese anyone says.\n", "utf8");
    expect(withdrawn.load({ path: f })["abc123"].note).toBe("The option is not Japanese anyone says.");
  });

  /** Skipping it would put the question back in front of learners without
   *  anybody deciding to. */
  test.each([
    "abc123",                                       // no reason, no note
    "abc123  unnatural",                            // no note
    "abc123  boring  Not a reason in the set.",     // outside the closed set
  ])("a malformed line is an error not a skip [%s]", (line) => {
    const tmp = tmpPath();
    const f = path.join(tmp, "w.txt");
    writeFileSync(f, line + "\n", "utf8");
    expect(() => withdrawn.load({ path: f })).toThrow(ValueError);
  });

  test("an item withdrawn twice is an error", () => {
    const tmp = tmpPath();
    const f = path.join(tmp, "w.txt");
    writeFileSync(f, "abc123  unnatural  First reason given here.\n" +
                     "abc123  ambiguous  Second reason given here.\n", "utf8");
    expect(() => withdrawn.load({ path: f })).toThrow(ValueError);
  });
});

// ----- publishing -----------------------------------------------------------

describe("publishing", () => {
  test("publish unpublishes exactly the withdrawn items", () => {
    const bundle = batch.load(REFERENCE);
    const victim = bundle["items"][0]["id"];
    const sql = publish.bundleSql(bundle, "ref", { withdrawnIds: new Set([victim]) });
    const update = before(after(sql, "update items set is_published = 0"), ";");
    expect([...update.matchAll(/'([0-9a-f]{10})'/g)].map((m) => m[1])).toEqual([victim]);
    // After the rows exist: the file is applied as one all-or-nothing unit.
    expect(sql.indexOf("insert into items")).toBeGreaterThanOrEqual(0);
    expect(sql.indexOf("is_published = 0")).toBeGreaterThanOrEqual(0);
    expect(sql.indexOf("insert into items")).toBeLessThan(sql.indexOf("is_published = 0"));
  });

  /** An owner's veto from the app must survive every later deploy. */
  test("publish never sets anything back to published", () => {
    const bundle = batch.load(REFERENCE);
    for (const ids of [new Set<string>(), new Set<string>([bundle["items"][0]["id"]])]) {
      const sql = publish.bundleSql(bundle, "ref", { withdrawnIds: ids });
      expect(!sql.includes("is_published = true") && !sql.includes("is_published = 1")).toBe(true);
    }
  });

  test("a bundle with nothing withdrawn says nothing about it", () => {
    const sql = publish.bundleSql(batch.load(REFERENCE), "ref", { withdrawnIds: new Set() });
    expect(sql).not.toContain("is_published");
  });
});

// ----- what still counts ------------------------------------------------------

describe("what still counts", () => {
  test("a live bundle keeps only the clips a live item plays", () => {
    const bundle = batch.load(REFERENCE);
    const victim = bundle["items"][0];
    const live = withdrawn.liveBundle(bundle, { withdrawn: new Set([victim["id"]]) });

    expect(new Set((live["items"] as Item[]).map((it) => it["id"])).has(victim["id"])).toBe(false);
    expect(live["items"].length).toBe(bundle["items"].length - 1);

    const used = new Set<string | null>();
    for (const it of live["items"] as Item[]) {
      const a = it["audio"];
      for (const c of [a["narration"], ...a["options"], ...a["dialogue"]]) used.add(c);
    }
    const kept = new Set((live["audio_manifest"] as Item[]).map((c) => c["clip_id"]));
    const labels = new Set((bundle["audio_manifest"] as Item[]).filter((c) => c["kind"] === "option_label").map((c) => c["clip_id"]));
    const expected = new Set([...used].filter((c) => c !== null));
    for (const l of labels) expected.add(l);
    expect(kept).toEqual(expected);
    // A clip the victim shares with a live item is still made.
    for (const c of victim["audio"]["options"] as string[]) {
      if (used.has(c)) expect(kept.has(c)).toBe(true);
    }
    // And the original is untouched.
    expect(new Set((bundle["items"] as Item[]).map((it) => it["id"])).has(victim["id"])).toBe(true);
  });

  /** So the planner sees the shelf as emptier and refills it. */
  test("a withdrawn item is off its shelf", () => {
    const victim = batch.load(REFERENCE)["items"][0];
    patch(withdrawn.seams, "ids", () => new Set<string>());
    const beforeCount = plan._publishedCounts().get(shelfKey("hatsugen_choukai", "J2"))!;
    patch(withdrawn.seams, "ids", () => new Set<string>([victim["id"]]));
    const afterCount = plan._publishedCounts().get(shelfKey("hatsugen_choukai", "J2"))!;
    expect(afterCount).toBe(beforeCount - 1);
  });

  /** A new item for that cell would hash to the withdrawn id, inherit the
   *  unpublish, and never be served. */
  test("a withdrawn items cell stays spent", () => {
    const ledger = withdrawn.load();
    const spent = batch.spentCellIds("hatsugen_choukai");
    for (const it of batch.load(REFERENCE)["items"] as Item[]) {
      if (it["id"] in ledger) {
        expect(spent.has(it["seed_cell"]["id"])).toBe(true);
      }
    }
  });

  test("check bundle does not hold a withdrawn item to the lint", () => {
    const bundle = deepcopy(batch.load(REFERENCE));
    const ledger = new Set(withdrawn.ids());
    const target = (bundle["items"] as Item[]).find((it) => !ledger.has(it["id"]))!;
    target["options"][0]["text"] = "〇〇商事の田中です。";

    const status = (ids: Set<string>): string => {
      const report = batch.checkBundle(bundle, { withdrawnIds: ids });
      return report.checks.find((c) => c.name === "reads like Japanese")!.status;
    };

    expect(status(ledger)).toBe("fail");
    expect(status(new Set([...ledger, target["id"]]))).toBe("pass");
  });
});
