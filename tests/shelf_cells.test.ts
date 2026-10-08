/**
 * A shelf never writes two items on one seed cell.
 *
 * After a near-duplicate the shelf moves on to its next cell. With the cells
 * drawn for exactly `n` items, "next" wrapped round to a cell an item had
 * already been kept on (n=2: kept on A, duplicate on B, back to A), the bundle
 * failed "seed cells distinct", and the whole shelf was thrown away.
 */
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as batch from "../bjt/batch.ts";
import type { Store } from "../bjt/db/index.ts";
import * as fixtures from "../bjt/fixtures.ts";
import * as pipeline from "../bjt/pipeline.ts";
import { deepcopy } from "../bjt/py.ts";
import * as seedtable from "../bjt/seedtable.ts";
import * as answerability from "../bjt/fidelity/answerability.ts";
import * as dedupe from "../bjt/fidelity/dedupe.ts";
import { Generator } from "../bjt/generators/base.ts";
import { store } from "./conftest.ts";
import { iter, patch, setConfig, tmpPath } from "./helpers.ts";

type Item = Record<string, any>;

/** `shelf`: a bank in a temporary directory, no proofreader or probe, and a
 *  generator that writes the fixture on whatever cell it is handed, recording
 *  each cell it was handed. */
function shelf(tmp: string): string[] {
  setConfig({ BATCH_DIR: tmp, SANITY_ENABLED: false, DIFFICULTY_ENABLED: false });
  const drafted: string[] = [];

  const generate = async function (
    this: Generator,
    opts: { level?: string | null; cell?: seedtable.Cell | null; feedback?: string | null } = {},
  ): Promise<Item> {
    const cell = opts.cell!;
    drafted.push(cell.id);
    const item = deepcopy(fixtures.FIXTURES["goi_bunpou"]);
    [item["item_type"], item["level"]] = ["goi_bunpou", cell.level];
    item["seed_cell"] = cell.toDict();
    item["topic"] = `topic ${drafted.length}`;
    return item;
  };

  patch(Generator.prototype, "generate", generate);
  return drafted;
}

describe("shelf cells", () => {
  test("a near-duplicate never sends the shelf back to a kept cell", async () => {
    const tmp = tmpPath();
    const s = store(tmp);
    const drafted = shelf(tmp);
    // Kept, near-duplicate, kept.
    const similarity = iter([0.0, 1.0, 0.0]);
    patch(dedupe, "maxSimilarity", () => similarity());

    const [p, kept] = await pipeline.runBatch(s, "goi_bunpou", "J2", 2, {
      gate: false, sanityCheck: false, force: true, out: path.join(tmp, "b.json") });

    expect(kept === 2 && drafted.length === 3).toBe(true);
    expect(new Set(drafted).size, `a cell was drafted twice: ${drafted}`).toBe(3);
    const report = batch.checkBundle(batch.load(p!));
    const distinct = report.checks.find((c) => c.name === "seed cells distinct")!;
    expect(distinct.status).toBe("pass");
  });

  test("a shelf past its drawn cells draws a fresh one", async () => {
    // Every draft but the last is a near-duplicate of the first: more cells
    // are spent than were drawn up front, and each is new.
    const tmp = tmpPath();
    const s = store(tmp);
    const drafted = shelf(tmp);
    setConfig({ SLOT_PATIENCE: 10 });
    const similarity = iter([0.0, 1.0, 1.0, 1.0, 1.0, 0.0]);
    patch(dedupe, "maxSimilarity", () => similarity());

    const [, kept] = await pipeline.runBatch(s, "goi_bunpou", "J2", 2, {
      gate: false, sanityCheck: false, force: true, out: path.join(tmp, "b.json") });
    expect(kept).toBe(2);
    expect(drafted.length === 6 && new Set(drafted).size === 6).toBe(true);
    expect(drafted.length).toBeGreaterThan(2 + pipeline.CELL_SURPLUS);
  });

  test("a discard keeps the same cell", async () => {
    // The one time a cell is drafted again: the gate refused it, and the next
    // draft is the same situation with the reviewer's reason in hand.
    const tmp = tmpPath();
    const s = store(tmp);
    const drafted = shelf(tmp);
    const verdicts = iter(["discarded:leaky", "kept"]);
    patch(answerability, "runGate", async () => ({
      cold_success_rate: 0.0, full_success_rate: 1.0,
      verdict: verdicts(), trials: [] }) as unknown as answerability.GateResult);
    patch(dedupe, "maxSimilarity", () => 0.0);
    await pipeline.runBatch(s, "goi_bunpou", "J2", 1, {
      gate: true, sanityCheck: false, force: true, out: path.join(tmp, "b.json") });
    expect(drafted.length === 2 && drafted[0] === drafted[1]).toBe(true);
  });

  test("a shelf whose table runs dry keeps what it has", async () => {
    const tmp = tmpPath();
    const s = store(tmp);
    const drafted = shelf(tmp);
    const table = seedtable.load("goi_bunpou");
    const only = table.cells({ level: "J2" }).slice(0, 2);
    const onlyIds = new Set(only.map((c) => c.id));
    patch(pipeline.seams, "spentCells", (_store: Store, _t: string) =>
      new Set(table.cells({ level: "J2" }).map((c) => c.id).filter((id) => !onlyIds.has(id))));
    const similarity = iter([0.0, 1.0]);
    patch(dedupe, "maxSimilarity", () => similarity());

    const [p, kept] = await pipeline.runBatch(s, "goi_bunpou", "J2", 2, {
      gate: false, sanityCheck: false, force: true, out: path.join(tmp, "b.json") });
    expect(kept === 1 && p !== null).toBe(true);
    expect(drafted.length).toBe(2);
  });
});
