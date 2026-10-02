/**
 * SQLite persistence: items, responses, metrics history.
 *
 * Uses conftest's `store()`, which arrives with the port of bjt/db
 * (bjt/db/store.ts). Until it is there these tests are skipped, by name, rather
 * than failing on a missing import; they run as soon as it exists.
 */
import { describe, expect, test } from "vitest";
import * as schemas from "../bjt/schemas.ts";
import * as conftest from "./conftest.ts";
import { goiItem, hyougenItem } from "./conftest.ts";

/** `store`: a fresh Store on a temp database, closed after the test. */
const store = (): any => (conftest as any).store();

describe.skipIf(!("store" in conftest))("db (needs tests/conftest.ts store(), from the port of bjt/db)", () => {
  test("insert and get", () => {
    const s = store();
    const goi = goiItem();
    const iid = s.insertItem("goi_bunpou", "J2", goi, "test-model");
    const got = s.getItem(iid);
    expect(got.stem).toBe(goi.stem);
    expect(got.options.length).toBe(4);
    expect(got.correct_index).toBe(schemas.correctIndex(goi.options));
  });

  test("response accuracy", () => {
    const s = store();
    const g = s.insertItem("goi_bunpou", "J2", goiItem(), "m");
    const h = s.insertItem("hyougen", "J2", hyougenItem(), "m");
    s.recordResponse(g, 0, true);
    s.recordResponse(g, 1, false);
    s.recordResponse(h, 0, true);

    const acc = Object.fromEntries(s.accuracyByType().map((r: any) => [r.item_type, r]));
    expect(acc["goi_bunpou"].answered).toBe(2);
    expect(acc["goi_bunpou"].correct).toBe(1);
    expect(acc["goi_bunpou"].accuracy).toBe(0.5);
    expect(acc["hyougen"].accuracy).toBe(1.0);
  });

  test("recent topics dedup window", () => {
    const s = store();
    const goi = goiItem();
    for (let i = 0; i < 5; i++) {
      const item = { ...goi };
      item.topic = `topic-${i}`;
      s.insertItem("goi_bunpou", "J2", item, "m");
    }
    const topics = s.recentTopics("goi_bunpou", 3);
    expect(topics).toEqual(["topic-4", "topic-3", "topic-2"]);  // newest first
  });

  test("kept items excludes discarded", () => {
    const s = store();
    const goi = goiItem();
    s.insertItem("goi_bunpou", "J2", goi, "m", { gateVerdict: "kept" });
    s.insertItem("goi_bunpou", "J2", goi, "m", { gateVerdict: "skipped" });
    s.insertItem("goi_bunpou", "J2", goi, "m", { gateVerdict: "discarded:leaky" });
    const kept = s.keptItems("goi_bunpou", 10);
    expect(kept.length).toBe(2);
    expect(kept.every((k: any) => ["kept", "skipped"].includes(k.gate_verdict))).toBe(true);
  });

  test("gate summary", () => {
    const s = store();
    const goi = goiItem();
    s.insertItem("goi_bunpou", "J2", goi, "m",
                 { coldSuccessRate: 0.0, fullSuccessRate: 1.0, gateVerdict: "kept" });
    s.insertItem("goi_bunpou", "J2", goi, "m",
                 { coldSuccessRate: 0.33, fullSuccessRate: 1.0, gateVerdict: "kept" });
    const gs = Object.fromEntries(s.gateSummary().map((r: any) => [r.item_type, r]));
    expect(gs["goi_bunpou"].n).toBe(2);
    expect(Math.abs(gs["goi_bunpou"].avg_full - 1.0)).toBeLessThan(1e-9);
  });

  test("verdict counts", () => {
    const s = store();
    const goi = goiItem();
    s.insertItem("goi_bunpou", "J2", goi, "m", { gateVerdict: "kept" });
    s.insertItem("goi_bunpou", "J2", goi, "m", { gateVerdict: "discarded:leaky" });
    s.insertItem("goi_bunpou", "J2", goi, "m", { gateVerdict: "discarded:leaky" });
    const counts = Object.fromEntries(s.verdictCounts().map((r: any) => [r.gate_verdict, r.n]));
    expect(counts["kept"]).toBe(1);
    expect(counts["discarded:leaky"]).toBe(2);
  });

  test("discriminator run roundtrip", () => {
    const s = store();
    s.insertDiscriminatorRun("goi_bunpou", 5, 5, 0.6, ["tell A", "tell B"]);
    const latest = s.latestDiscriminatorRuns();
    expect(latest.length).toBe(1);
    expect(latest[0].discrimination_rate).toBe(0.6);
    expect(latest[0].reasons).toEqual(["tell A", "tell B"]);
  });

  test("calibration run roundtrip", () => {
    const s = store();
    const rid = s.insertCalibrationRun("hyougen", 0.7, 0.9, 10, 20);
    // `conn` is the node:sqlite DatabaseSync (sqlite3's `execute(...).fetchone()`).
    const row = s.conn.prepare("SELECT * FROM calibration_runs WHERE id = ?").get(rid);
    expect(row.item_type).toBe("hyougen");
    expect([row.official_accuracy, row.generated_accuracy]).toEqual([0.7, 0.9]);
  });
});
