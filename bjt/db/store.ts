/**
 * SQLite persistence.
 *
 * Everything the brief asks to keep: generated items, answers, and every fidelity
 * metric, so per-item-type accuracy history is available and generation can
 * weight toward weak areas.
 *
 * Single-user, local, synchronous. node:sqlite is built into Node, so no
 * dependency. It is loaded the first time a Store is opened, not when this
 * module is imported, so a command that never opens the database never loads
 * it.
 */
import type { DatabaseSync, StatementResultingChanges } from "node:sqlite";

import * as config from "../config.ts";
import { dumps, loads, BUNDLE_FLOAT_KEYS } from "../pyjson.ts";
import { get, KeyError, or, repr, RuntimeError, time, truthy } from "../py.ts";
import { correctIndex } from "../schemas.ts";

type Sqlite = typeof import("node:sqlite");

/** node:sqlite, once loaded. */
let sqlite: Sqlite | null = null;

/** node:sqlite, loaded on first use. Node announces it with a one-time
 *  "SQLite is an experimental feature" ExperimentalWarning on stderr; that
 *  one warning, and only while the module loads, is not passed on — every
 *  other warning, then or later, is. */
function loadSqlite(): Sqlite {
  if (sqlite === null) {
    const emitWarning = process.emitWarning;
    process.emitWarning = function (warning: string | Error, ...rest: unknown[]): void {
      const message = typeof warning === "string" ? warning : warning.message;
      const kind = typeof rest[0] === "string"
        ? rest[0]
        : (rest[0] as { type?: string } | undefined)?.type ?? (warning instanceof Error ? warning.name : "Warning");
      if (kind === "ExperimentalWarning" && message.startsWith("SQLite is an experimental feature")) return;
      return (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
    } as typeof process.emitWarning;
    try {
      sqlite = process.getBuiltinModule("node:sqlite");
    } finally {
      process.emitWarning = emitWarning;
    }
  }
  return sqlite;
}

/** The id SQLite gave the row an INSERT just wrote. */
function _newId(result: StatementResultingChanges): number {
  if (result.lastInsertRowid === null || result.lastInsertRowid === undefined) {
    // SQLite sets it after every INSERT
    throw new RuntimeError("the insert returned no row id");
  }
  return Number(result.lastInsertRowid);
}

/** `d[key]`: the value, or a KeyError when the key is absent. */
function _need(d: Record<string, any>, key: string): any {
  if (!Object.prototype.hasOwnProperty.call(d, key)) throw new KeyError(repr(key));
  return d[key];
}

const _SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
    id              INTEGER PRIMARY KEY,
    item_type       TEXT NOT NULL,
    level           TEXT NOT NULL,
    topic           TEXT NOT NULL,
    stem            TEXT NOT NULL,
    options_json    TEXT NOT NULL,       -- list of {text, role}, already shuffled
    correct_index   INTEGER NOT NULL,    -- index into options_json
    explanation_ja  TEXT NOT NULL,
    explanation_en  TEXT NOT NULL,
    vocab_notes_json TEXT NOT NULL,
    model           TEXT NOT NULL,
    seed_cell_id    TEXT,                -- the seed-table cell this item was written for
    extra_json      TEXT,                -- type-specific fields (scene_id, channel, roles, ...)
    -- fidelity metrics captured at generation time (nullable until the gate runs)
    cold_success_rate REAL,
    full_success_rate REAL,
    gate_verdict    TEXT,                -- 'kept' | 'discarded:<reason>' | 'skipped'
    vocab_violations_json TEXT,
    created_at      REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS responses (
    id          INTEGER PRIMARY KEY,
    item_id     INTEGER NOT NULL REFERENCES items(id),
    chosen_index INTEGER NOT NULL,
    correct     INTEGER NOT NULL,        -- 0/1
    answered_at REAL NOT NULL
);

-- One row per trial: the gate's cold/full sides, for auditing consistency, and
-- the difficulty probe's, so the prior a batch shipped with can be re-derived.
CREATE TABLE IF NOT EXISTS gate_trials (
    id          INTEGER PRIMARY KEY,
    item_id     INTEGER REFERENCES items(id),
    side        TEXT NOT NULL,           -- 'cold' | 'full' | 'difficulty'
    trial       INTEGER NOT NULL,
    chosen_index INTEGER,
    correct     INTEGER NOT NULL,        -- 0/1
    created_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS discriminator_runs (
    id                  INTEGER PRIMARY KEY,
    item_type           TEXT NOT NULL,
    n_generated         INTEGER NOT NULL,
    n_official          INTEGER NOT NULL,
    discrimination_rate REAL NOT NULL,   -- fraction the judge labelled correctly
    reasons_json        TEXT NOT NULL,   -- judge's stated tells
    created_at          REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS calibration_runs (
    id                  INTEGER PRIMARY KEY,
    item_type           TEXT NOT NULL,
    official_accuracy   REAL,
    generated_accuracy  REAL,
    n_official          INTEGER NOT NULL,
    n_generated         INTEGER NOT NULL,
    created_at          REAL NOT NULL
);
`;


/** Columns added to an existing table. SQLite has no "ADD COLUMN IF NOT
 *  EXISTS", so we diff against PRAGMA table_info and add what is missing, and an
 *  older local database keeps working. */
const _MIGRATIONS: [string, string, string][] = [
  ["items", "seed_cell_id", "TEXT"],
  ["items", "extra_json", "TEXT"],
];

/** A row as plain data (`dict(row)`): node:sqlite hands each row back as an
 *  object without a prototype. */
type Row = Record<string, any>;

/** One line of `Store.accuracyByType`. */
export type TypeAccuracy = { item_type: string; answered: number; correct: number; accuracy: number | null };

// node:sqlite runs in autocommit mode: every statement below is committed as
// it runs, which is what the `commit()` after each write did in the sqlite3
// original.
export class Store {
  path: string;
  conn: DatabaseSync;

  constructor(opts: { path?: string | null } = {}) {
    this.path = opts.path || config.DB_PATH;
    // The connection Python's sqlite3 opens: foreign keys not enforced (an
    // answer or a trial may name an item this file does not hold) and
    // double-quoted string literals read as strings. node:sqlite's defaults
    // are the other way round on both.
    this.conn = new (loadSqlite().DatabaseSync)(this.path, {
      enableForeignKeyConstraints: false,
      enableDoubleQuotedStringLiterals: true,
    });
    this.conn.exec(_SCHEMA);
    this._migrate();
  }

  _migrate(): void {
    for (const [table, column, decl] of _MIGRATIONS) {
      const existing = new Set(this.conn.prepare(`PRAGMA table_info(${table})`).all().map((r) => r["name"]));
      if (!existing.has(column)) {
        this.conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
      }
    }
  }

  /** Closing a closed Store does nothing, as in sqlite3 (node:sqlite would
   *  throw). */
  close(): void {
    if (this.conn.isOpen) this.conn.close();
  }

  // ----- items ----------------------------------------------------------

  insertItem(
    itemType: string,
    level: string,
    item: Record<string, any>,
    model: string,
    opts: {
      coldSuccessRate?: number | null;
      fullSuccessRate?: number | null;
      gateVerdict?: string;
      vocabViolations?: string[] | null;
    } = {},
  ): number {
    const coldSuccessRate = opts.coldSuccessRate ?? null;
    const fullSuccessRate = opts.fullSuccessRate ?? null;
    const gateVerdict = opts.gateVerdict ?? "skipped";
    const vocabViolations = opts.vocabViolations ?? null;
    const options = _need(item, "options");
    const cur = this.conn.prepare(
      `INSERT INTO items (item_type, level, topic, stem, options_json,
                    correct_index, explanation_ja, explanation_en, vocab_notes_json,
                    model, seed_cell_id, extra_json, cold_success_rate,
                    full_success_rate, gate_verdict, vocab_violations_json, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      itemType,
      level,
      get(item, "topic", ""),
      _need(item, "stem"),
      dumps(options, { ensureAscii: false }),
      correctIndex(options),
      _need(item, "explanation_ja"),
      _need(item, "explanation_en"),
      dumps(get(item, "vocab_notes", []), { ensureAscii: false }),
      model,
      get(or(get(item, "seed_cell"), {}), "id"),
      dumps(extraFields(item), { ensureAscii: false, floatKeys: BUNDLE_FLOAT_KEYS }),
      coldSuccessRate,
      fullSuccessRate,
      gateVerdict,
      dumps(or(vocabViolations, []), { ensureAscii: false }),
      time(),
    );
    return _newId(cur);
  }

  getItem(itemId: number): Row | null {
    const row = this.conn.prepare("SELECT * FROM items WHERE id = ?").get(itemId);
    return row ? _itemRowToDict(row) : null;
  }

  /** Recent items that passed the gate (or were stored gate-skipped) — the
   *  pool the discriminator draws its generated side from. */
  keptItems(itemType: string, limit: number): Row[] {
    const rows = this.conn.prepare(
      `SELECT * FROM items
               WHERE item_type = ? AND gate_verdict IN ('kept', 'skipped')
               ORDER BY id DESC LIMIT ?`,
    ).all(itemType, limit);
    return rows.map((r) => _itemRowToDict(r));
  }

  /** Seed-table cells already spent on this item type. Passed to
   *  SeedTable.sample as excludeIds so a cell is never written twice. */
  usedCellIds(itemType: string): Set<string> {
    const rows = this.conn.prepare(
      "SELECT DISTINCT seed_cell_id FROM items WHERE item_type = ? AND seed_cell_id IS NOT NULL",
    ).all(itemType);
    return new Set(rows.map((r) => r["seed_cell_id"] as string));
  }

  recentTopics(itemType: string, limit: number): string[] {
    const rows = this.conn.prepare(
      "SELECT topic FROM items WHERE item_type = ? ORDER BY id DESC LIMIT ?",
    ).all(itemType, limit);
    return rows.filter((r) => truthy(r["topic"])).map((r) => r["topic"] as string);
  }

  // ----- responses ------------------------------------------------------

  recordResponse(itemId: number, chosenIndex: number, correct: boolean): void {
    this.conn.prepare(
      "INSERT INTO responses (item_id, chosen_index, correct, answered_at) VALUES (?,?,?,?)",
    ).run(itemId, chosenIndex, Number(correct), time());
  }

  accuracyByType(): TypeAccuracy[] {
    const rows = this.conn.prepare(
      `SELECT i.item_type,
                      COUNT(*)              AS answered,
                      SUM(r.correct)        AS n_correct
               FROM responses r JOIN items i ON i.id = r.item_id
               GROUP BY i.item_type ORDER BY i.item_type`,
    ).all();
    const out: TypeAccuracy[] = [];
    for (const r of rows) {
      const answered = r["answered"] as number;
      const nCorrect = (r["n_correct"] as number | null) || 0;
      out.push(
        {
          item_type: r["item_type"] as string,
          answered: answered,
          correct: nCorrect,
          accuracy: truthy(answered) ? (nCorrect / answered) : null,
        },
      );
    }
    return out;
  }

  // ----- gate trials ----------------------------------------------------

  recordGateTrial(
    itemId: number | null, side: string, trial: number, chosenIndex: number | null, correct: boolean,
  ): void {
    this.conn.prepare(
      "INSERT INTO gate_trials (item_id, side, trial, chosen_index, correct, created_at) VALUES (?,?,?,?,?,?)",
    ).run(itemId, side, trial, chosenIndex, Number(correct), time());
  }

  gateSummary(): Row[] {
    const rows = this.conn.prepare(
      `SELECT item_type,
                      AVG(cold_success_rate) AS avg_cold,
                      AVG(full_success_rate) AS avg_full,
                      COUNT(*)               AS n
               FROM items
               WHERE cold_success_rate IS NOT NULL
               GROUP BY item_type ORDER BY item_type`,
    ).all();
    return rows.map((r) => ({ ...r }));
  }

  /** Per type: how many items the difficulty probe measured and the mean
   *  of their per-item pass rates. Derived from the trials, which is the one
   *  place the probe's answers are kept. */
  difficultySummary(): Row[] {
    const rows = this.conn.prepare(
      `SELECT item_type, AVG(rate) AS avg_rate, COUNT(*) AS n
               FROM (SELECT i.item_type, AVG(g.correct) AS rate
                     FROM gate_trials g JOIN items i ON i.id = g.item_id
                     WHERE g.side = 'difficulty'
                     GROUP BY g.item_id)
               GROUP BY item_type ORDER BY item_type`,
    ).all();
    return rows.map((r) => ({ ...r }));
  }

  verdictCounts(): Row[] {
    const rows = this.conn.prepare(
      `SELECT item_type, gate_verdict, COUNT(*) AS n
               FROM items GROUP BY item_type, gate_verdict ORDER BY item_type`,
    ).all();
    return rows.map((r) => ({ ...r }));
  }

  // ----- discriminator & calibration -----------------------------------

  insertDiscriminatorRun(
    itemType: string, nGenerated: number, nOfficial: number, rate: number, reasons: string[],
  ): number {
    const cur = this.conn.prepare(
      `INSERT INTO discriminator_runs
               (item_type, n_generated, n_official, discrimination_rate, reasons_json, created_at)
               VALUES (?,?,?,?,?,?)`,
    ).run(itemType, nGenerated, nOfficial, rate, dumps(reasons, { ensureAscii: false }), time());
    return _newId(cur);
  }

  /** The tells from the most recent discriminator run for this item type —
   *  fed back into the generator prompt so the loop actually closes. */
  latestTells(itemType: string, opts: { limit?: number } = {}): string[] {
    const limit = opts.limit ?? 6;
    const row = this.conn.prepare(
      "SELECT reasons_json FROM discriminator_runs WHERE item_type = ? ORDER BY id DESC LIMIT 1",
    ).get(itemType);
    if (!row) {
      return [];
    }
    return (loads(row["reasons_json"] as string) as string[]).slice(0, limit);
  }

  latestDiscriminatorRuns(): Row[] {
    const rows = this.conn.prepare(
      `SELECT * FROM discriminator_runs
               WHERE id IN (SELECT MAX(id) FROM discriminator_runs GROUP BY item_type)
               ORDER BY item_type`,
    ).all();
    const out: Row[] = [];
    for (const r of rows) {
      const d: Row = { ...r };
      const reasonsJson = d["reasons_json"];
      delete d["reasons_json"];
      d["reasons"] = loads(reasonsJson);
      out.push(d);
    }
    return out;
  }

  insertCalibrationRun(
    itemType: string, officialAcc: number | null, genAcc: number | null, nOff: number, nGen: number,
  ): number {
    const cur = this.conn.prepare(
      `INSERT INTO calibration_runs
               (item_type, official_accuracy, generated_accuracy, n_official, n_generated, created_at)
               VALUES (?,?,?,?,?,?)`,
    ).run(itemType, officialAcc, genAcc, nOff, nGen, time());
    return _newId(cur);
  }
}


/** Item keys that live in their own columns; everything else an item carries is
 *  type-specific and goes to extra_json. */
export const _CORE_KEYS: ReadonlySet<string> = new Set([
  "item_type", "level", "topic", "stem", "options", "explanation_ja",
  "explanation_en", "vocab_notes", "seed_cell",
]);


/** The type-specific fields of an item (scene_id, channel, speaker_role...). */
export function extraFields(item: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(item).filter(([k]) => !_CORE_KEYS.has(k)));
}


export function _itemRowToDict(row: Record<string, unknown>): Row {
  const d: Row = { ...row };
  const pop = (key: string): any => {
    const v = get(d, key);
    delete d[key];
    return v;
  };
  d["options"] = loads(pop("options_json"));
  d["vocab_notes"] = loads(pop("vocab_notes_json"));
  const vv = pop("vocab_violations_json");
  d["vocab_violations"] = truthy(vv) ? loads(vv) : [];
  const extra = pop("extra_json");
  // Type-specific fields are flattened back onto the item so callers see the
  // same shape the generator produced.
  Object.assign(d, truthy(extra) ? loads(extra) : {});
  return d;
}
