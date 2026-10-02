/**
 * A shelf that writes nothing night after night rests, and the night goes elsewhere.
 *
 * From 2026-09-28 three nights in a row went to the same three shelves — one the
 * API refused outright, two whose every draft the gates threw away — and wrote
 * nothing for their money, because a shelf that cannot be written stays furthest
 * behind its share and the work order sends every night back to it. These hold
 * the ledger to its rule (three misses rest a shelf for a week, then it is tried
 * once more), the work order to passing a resting shelf over, and the night to
 * recording what each shelf did, and only what was the shelf's doing.
 */
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as cli from "../bjt/cli/index.ts";
import * as gen from "../bjt/cli/generate.ts";
import type { Store } from "../bjt/db/index.ts";
import * as fixtures from "../bjt/fixtures.ts";
import * as llm from "../bjt/llm.ts";
import * as pipeline from "../bjt/pipeline.ts";
import * as plan from "../bjt/plan.ts";
import { deepcopy, RuntimeError } from "../bjt/py.ts";
import * as r2 from "../bjt/r2.ts";
import * as shelf_rest from "../bjt/shelf_rest.ts";
import { shelfKey } from "../bjt/shelf_rest.ts";
import * as dedupe from "../bjt/fidelity/dedupe.ts";
import { store } from "./conftest.ts";
import { patch, setConfig, tmpPath } from "./helpers.ts";

const DAY_MS = 86400000;
const NOW = new Date(Date.UTC(2026, 9, 2, 18, 0));
const CREDS = new r2.Credentials({ account_id: "acct", access_key_id: "key", secret_access_key: "secret" });

function _night(daysAgo: number): Date {
  return new Date(NOW.getTime() - daysAgo * DAY_MS);
}

function _plusDays(when: Date, days: number): Date {
  return new Date(when.getTime() + days * DAY_MS);
}

type Mark = [string, string, string, Date];

function _keys(...marks: Mark[]): string[] {
  return marks.map(([t, lv, outcome, when]) => shelf_rest.marker(t, lv, outcome, when));
}

const [M, W] = [shelf_rest.MISSED, shelf_rest.WRITTEN];

describe("shelf rest", () => {
  // ----- the rule ---------------------------------------------------------------

  test("a marker reads back as what was written", () => {
    const keys = _keys(["hyougen", "J3", M, _night(1)], ["hyougen", "J3", W, _night(3)],
                       ["sougou_choudokkai", "J1", M, _night(2)]);
    expect(keys.every((k) => k.startsWith("nightly/shelves/"))).toBe(true);
    const history = shelf_rest.parse([...keys, "nightly/shelves/junk", "nightly/shelves/a.b.c.lost"]);
    expect(history.get(shelfKey("hyougen", "J3"))).toEqual([[_night(3), W], [_night(1), M]]);  // oldest first
    expect(history.get(shelfKey("sougou_choudokkai", "J1"))).toEqual([[_night(2), M]]);
    expect(history.size).toBe(2);
  });

  test("three misses in a row rest a shelf for a week", () => {
    const history = shelf_rest.parse(_keys(...[3, 2, 1].map((d): Mark => ["gazou_haaku", "J1", M, _night(d)])));
    const rest = shelf_rest.resting(history, NOW, { after: 3, days: 7 });
    expect(rest).toEqual(new Map([[shelfKey("gazou_haaku", "J1"), _plusDays(_night(1), 7)]]));
    // A week after the last miss it is tried once more...
    expect(shelf_rest.resting(history, _plusDays(_night(1), 7), { after: 3, days: 7 })).toEqual(new Map());
    // ...and one more miss then rests it again, since the last three are misses.
    const later = _plusDays(_night(1), 7);
    const again = shelf_rest.parse(_keys(...[3, 2, 1].map((d): Mark => ["gazou_haaku", "J1", M, _night(d)]),
                                         ["gazou_haaku", "J1", M, later]));
    expect(shelf_rest.resting(again, new Date(later.getTime() + 3600000), { after: 3, days: 7 })
      .has(shelfKey("gazou_haaku", "J1"))).toBe(true);
  });

  test("one written night clears the streak", () => {
    const history = shelf_rest.parse(_keys(["hyougen", "J3", M, _night(4)], ["hyougen", "J3", M, _night(3)],
                                           ["hyougen", "J3", W, _night(2)], ["hyougen", "J3", M, _night(1)]));
    expect(shelf_rest.resting(history, NOW, { after: 3, days: 7 })).toEqual(new Map());
  });

  test("two misses are not yet a pattern and zero turns resting off", () => {
    const two = shelf_rest.parse(_keys(["hyougen", "J3", M, _night(2)], ["hyougen", "J3", M, _night(1)]));
    expect(shelf_rest.resting(two, NOW, { after: 3, days: 7 })).toEqual(new Map());
    const three = shelf_rest.parse(_keys(...[3, 2, 1].map((d): Mark => ["hyougen", "J3", M, _night(d)])));
    expect(shelf_rest.resting(three, NOW, { after: 0, days: 7 })).toEqual(new Map());
  });

  // ----- the bucket -------------------------------------------------------------

  test("no bucket rests nothing and records nothing", async () => {
    // pytest.fail in the fakes: a call fails the test however it is caught.
    const called: string[] = [];
    patch(r2, "listKeys", async () => {
      called.push("listKeys");
      throw new Error("no bucket, no call");
    });
    patch(r2, "put", async () => {
      called.push("put");
      throw new Error("no bucket, no call");
    });
    expect(await shelf_rest.load(NOW)).toEqual([new Map(), null]);
    expect(await shelf_rest.record([["hyougen", "J3", M]], NOW)).toBeNull();
    expect(called, "no bucket, no call").toEqual([]);
  });

  test("a ledger that cannot be read tries every shelf", async () => {
    const broken = async () => {
      throw new RuntimeError("HTTP 500");
    };
    patch(r2, "listKeys", broken);
    const [rest, warning] = await shelf_rest.load(NOW, { creds: CREDS });
    expect(rest.size === 0 && (warning ?? "").includes("every shelf is tried")).toBe(true);
  });

  test("the ledger is read and written under its own prefix", async () => {
    const stored = _keys(...[3, 2, 1].map((d): Mark => ["hyougen", "J3", M, _night(d)]));
    const asked: Record<string, unknown> = {};

    const listKeys = async (creds: r2.Credentials, prefix: string, opts: { delimiter?: string | null } = {}) => {
      Object.assign(asked, { prefix, delimiter: opts.delimiter ?? null });
      return [...stored];
    };

    const put: [string, boolean][] = [];
    patch(r2, "listKeys", listKeys);
    patch(r2, "put", async (creds: r2.Credentials, key: string, data: Uint8Array, ct: string,
                            opts: { overwrite?: boolean } = {}) => {
      put.push([key, opts.overwrite ?? true]);
    });
    const [rest, warning] = await shelf_rest.load(NOW, { creds: CREDS });
    expect(warning === null && rest.has(shelfKey("hyougen", "J3"))).toBe(true);
    expect(asked).toEqual({ prefix: "nightly/shelves/", delimiter: "/" });
    expect(await shelf_rest.record([["hyougen", "J3", W], ["gazou_haaku", "J1", M]], NOW, { creds: CREDS })).toBeNull();
    expect(put).toEqual([[shelf_rest.marker("hyougen", "J3", W, NOW), false],
                         [shelf_rest.marker("gazou_haaku", "J1", M, NOW), false]]);
    // Never somewhere the Worker serves: it serves audio/ and scenes/ only.
    expect(put.some(([k]) => ["audio/", "scenes/"].some((p) => k.startsWith(p)))).toBe(false);
  });

  test("a marker that cannot be written is a warning not a failed night", async () => {
    const put = async (creds: r2.Credentials, key: string) => {
      if (key.includes("gazou")) {
        throw new RuntimeError("HTTP 403");
      }
      throw new r2.AlreadyExists(key);
    };
    patch(r2, "put", put);
    const warning = await shelf_rest.record([["hyougen", "J3", W], ["gazou_haaku", "J1", M]], NOW, { creds: CREDS });
    expect(Boolean(warning) && warning!.includes("gazou_haaku J1") && !warning!.includes("hyougen")).toBe(true);
  });

  // ----- the work order ---------------------------------------------------------

  test("the work order passes a resting shelf over", () => {
    const survey = new plan.Survey({ shelves: [
      new plan.Shelf({ item_type: "hyougen", level: "J3", have: 0, cells_left: 100 }),
      new plan.Shelf({ item_type: "hyougen", level: "J2", have: 5, cells_left: 100 }),
      new plan.Shelf({ item_type: "goi_bunpou", level: "J2", have: 6, cells_left: 100 })] });
    const before = plan.workOrder(survey, { budget: 2, perSlot: 2, readingMin: 0 });
    expect(before.map((w) => [w.item_type, w.level])).toEqual([["hyougen", "J3"]]);
    const after = plan.workOrder(survey, { budget: 2, perSlot: 2, readingMin: 0,
                                           resting: new Map([[shelfKey("hyougen", "J3"), NOW]]) });
    expect(new Set(after.map((w) => shelfKey(w.item_type, w.level))).has(shelfKey("hyougen", "J3"))).toBe(false);
    expect(after.reduce((n, w) => n + w.n, 0), "its share of the night goes to the next shelf").toBe(2);
  });

  test("the plan says which shelves rest and until when", () => {
    const survey = new plan.Survey({ shelves: [
      new plan.Shelf({ item_type: "hyougen", level: "J3", have: 0, cells_left: 100 }),
      new plan.Shelf({ item_type: "hyougen", level: "J2", have: 5, cells_left: 100 })] });
    const rest = new Map([[shelfKey("hyougen", "J3"), new Date(Date.UTC(2026, 9, 8))]]);
    const order = plan.workOrder(survey, { budget: 1, perSlot: 1, readingMin: 0, resting: rest });
    const text = plan.render(survey, order, { resting: rest });
    expect(text.includes("Resting tonight") && text.includes("hyougen J3   tried again from 2026-10-08")).toBe(true);
    expect(plan.toJson(survey, order, { resting: rest })["resting"]).toEqual([
      { item_type: "hyougen", level: "J3", until: "2026-10-08T00:00:00+00:00" }]);
  });

  // ----- the night --------------------------------------------------------------

  /** `night`: a bank in a temporary directory, and no proofreader, probe or
   *  dedupe to fake. */
  function night(tmp: string): string {
    setConfig({ BATCH_DIR: tmp, SANITY_ENABLED: false, DIFFICULTY_ENABLED: false });
    patch(dedupe, "maxSimilarity", () => 0.0);
    return tmp;
  }

  test("the night records written missed and nothing for a stop", async () => {
    const tmp = tmpPath();
    const s = store(tmp);
    night(tmp);

    const runBatch = async (_store: Store, itemType: string): Promise<[string | null, number]> => {
      if (itemType === "hyougen") {
        return [null, 0];  // tried, nothing passed the gates
      }
      if (itemType === "sougou_choudokkai") {
        throw new llm.LLMError("Schema is too complex");
      }
      throw new llm.LLMSpendLimitError("spend ceiling reached");
    };

    patch(pipeline.seams, "runBatch", runBatch);
    const order = [new plan.WorkItem({ item_type: "hyougen", level: "J3", n: 1, have: 0, cells_left: 50 }),
                   new plan.WorkItem({ item_type: "sougou_choudokkai", level: "J1", n: 1, have: 0, cells_left: 50 }),
                   new plan.WorkItem({ item_type: "bamen_haaku", level: "J1", n: 1, have: 0, cells_left: 50 })];
    const result = await pipeline.runNight(s, order, { gate: false, sanityCheck: false });
    expect(result.outcomes).toEqual([["hyougen", "J3", M], ["sougou_choudokkai", "J1", M]]);
    expect(Boolean(result.stopped) && result.stopped!.includes("ceiling")).toBe(true);
  });

  test("a written shelf is recorded as written", async () => {
    const tmp = tmpPath();
    const s = store(tmp);
    night(tmp);
    patch(llm, "generateStructured", async () => deepcopy(fixtures.FIXTURES["goi_bunpou"]));
    const order = [new plan.WorkItem({ item_type: "goi_bunpou", level: "J2", n: 1, have: 0, cells_left: 50 })];
    const result = await pipeline.runNight(s, order, { gate: false, sanityCheck: false });
    expect(result.outcomes).toEqual([["goi_bunpou", "J2", W]]);
  });

  test("the nightly command rests reads and records", async () => {
    // End to end through `bjt nightly`: a resting shelf is left out of the
    // order, and the shelf that ran is recorded.
    const tmp = tmpPath();
    store(tmp);
    night(tmp);
    // `cli/generate`'s clock (Python's `gen._now`), through its seams.
    patch(gen.seams, "now", () => NOW);
    patch(shelf_rest, "load", async () => [new Map([[shelfKey("hyougen", "J2"), _plusDays(NOW, 2)]]), null]);
    const recorded: [string, string, string][] = [];
    patch(shelf_rest, "record", async (outcomes: Iterable<[string, string, string]>) => {
      recorded.push(...outcomes);
      return null;
    });
    const seen: Record<string, any> = {};

    const workOrder = (_state: plan.Survey, opts: Record<string, any> = {}) => {
      Object.assign(seen, opts);
      return [new plan.WorkItem({ item_type: "goi_bunpou", level: "J2", n: 1, have: 0, cells_left: 50 })];
    };

    patch(plan, "workOrder", workOrder);
    setConfig({ DB_PATH: path.join(tmp, "night.db") });
    patch(llm, "generateStructured", async () => deepcopy(fixtures.FIXTURES["goi_bunpou"]));
    expect(await cli.main({ argv: ["nightly", "--no-gate", "--no-sanity"] })).toBe(0);
    expect(seen["resting"]).toEqual(new Map([[shelfKey("hyougen", "J2"), _plusDays(NOW, 2)]]));
    expect(recorded).toEqual([["goi_bunpou", "J2", W]]);
  });
});
