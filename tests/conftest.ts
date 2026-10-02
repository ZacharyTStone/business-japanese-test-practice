/**
 * The shared fixtures (pytest's, once), as plain functions a test calls.
 *
 * pytest's `no_network` (no credential in the environment, every network seam
 * refusing) is tests/setup.ts, which runs before every test by itself; what
 * is here is what a test asks for by name.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterEach } from "vitest";
import { Store } from "../bjt/db/index.ts";
import * as fixtures from "../bjt/fixtures.ts";
import { deepcopy } from "../bjt/py.ts";
import * as seedtable from "../bjt/seedtable.ts";
import { setConfig, tmpPath } from "./helpers.ts";

/** The Stores `store()` opened in this test, closed after it. */
const openStores: Store[] = [];

afterEach(() => {
  while (openStores.length) openStores.pop()!.close();
});

/** `store`: a Store on a fresh database, `test.db` in a temp dir, closed after
 *  the test. Pass the test's own `tmpPath()` when it uses one too, so that the
 *  database sits inside it as it sat inside pytest's `tmp_path`. */
export function store(tmp: string = tmpPath()): Store {
  const s = new Store({ path: path.join(tmp, "test.db") });
  openStores.push(s);
  return s;
}

/** `goi_item`: a fresh copy of the 語彙・文法 fixture, the test's to change. */
export function goiItem(): Record<string, any> {
  return deepcopy(fixtures.FIXTURES["goi_bunpou"]);
}

/** `hyougen_item`: a fresh copy of the 表現読解 fixture. */
export function hyougenItem(): Record<string, any> {
  return deepcopy(fixtures.FIXTURES["hyougen"]);
}

/** `seeds_dir`: a temp seeds/ dir the test can populate; points config at it.
 *  Pass the test's own `tmpPath()` when it uses one too, so that the seeds
 *  sit inside it as they sat inside pytest's `tmp_path`. */
export function seedsDir(tmp: string = tmpPath()): string {
  const d = path.join(tmp, "seeds");
  mkdirSync(path.join(d, "vocab"), { recursive: true });
  setConfig({ SEEDS_DIR: d });
  return d;
}

/** `goi_cell`: a real goi_bunpou seed cell. Every type whose variety comes from the
 *  table refuses to generate without one, so the tests hand it a genuine cell
 *  rather than a stub — a stub would let the assignment drift out of sync with
 *  the committed table without anything noticing. */
export function goiCell(): seedtable.Cell {
  return seedtable.load("goi_bunpou").cells({ level: "J2" })[0];
}
