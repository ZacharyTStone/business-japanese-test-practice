/**
 * Bundle → SQL. How checked content gets into the database.
 *
 * The app never generates anything, so publishing is not an API the app calls; it
 * is a file. `bjt publish` turns a bundle into an idempotent SQL file for D1
 * (SQLite) that can be read before it is run, committed next to the schema that
 * shaped it (d1/migrations/), and applied with `wrangler d1 execute --file` or
 * pasted into the D1 console. Re-running it is always safe: every statement is an
 * upsert, so a corrected batch overwrites the old rows rather than duplicating
 * them.
 *
 * That is deliberately less convenient than a script that talks to the API with a
 * service key. It is also the reason there is no service key on anyone's laptop, no
 * half-finished import to reason about, and a diff to look at before a hundred
 * items reach real users.
 *
 * Three things this must get right:
 *
 * * **One file, all or nothing.** D1 runs a file with `wrangler d1 execute
 *   --remote --file` as one unit and rolls it back if any statement fails, so an
 *   item never lands without its options. The file holds no BEGIN/COMMIT: D1
 *   refuses them and supplies the transaction itself.
 * * **Small statements.** One row per INSERT. D1 refuses a statement over
 *   100 KB, and a bundle of long documents written as one multi-row INSERT
 *   would eventually be one.
 * * **Quoting.** Every value goes through `lit()`. The content is Japanese prose
 *   full of quotes and brackets, written by a model, and string-formatting it into
 *   SQL by hand is how you end up with a broken publish at best.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { writeAtomic } from "./files.ts";
import { FileNotFoundError, floatRepr, get, getitem, numStr, or, sorted, str, truthy, ValueError } from "./py.ts";
import { BUNDLE_FLOAT_KEYS, dumps, loads } from "./pyjson.ts";
import * as seedtable from "./seedtable.ts";
import * as withdrawn from "./withdrawn.ts";

/**
 * A SQL literal for anything we put in a bundle.
 *
 * Dicts and lists become JSON text. Booleans become 1 and 0, which is what a
 * SQLite boolean is. Everything else becomes a quoted string with embedded
 * quotes doubled, or NULL. A float that is not a number (nan, inf) is
 * refused: written bare it is an identifier SQL does not know, and quoted it
 * would be a value nobody measured. So is a NUL, which would cut a text
 * value short.
 *
 * `asFloat` says the number was a float in Python, so a whole one is written
 * as Python wrote it (`1.0`, not `1`): JavaScript has one number type, and
 * the bundle's `model_p_correct` reads back from JSON as `1`. `_upsert`
 * passes it for the columns named in `BUNDLE_FLOAT_KEYS`.
 */
export function lit(value: unknown, opts: { asFloat?: boolean } = {}): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new ValueError(`${floatRepr(value)} is not a number SQL can store`);
  }
  if (typeof value === "number") {
    // `str(int)` for a whole number Python held as an int, whatever its size
    // (`numStr` would switch a large one to exponent form, as for a float).
    if (Number.isInteger(value) && !opts.asFloat && !Object.is(value, -0)) {
      return BigInt(value).toString();
    }
    return numStr(value, opts.asFloat ?? false);
  }
  if (Array.isArray(value) || (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)) {
    // allowNan: false: JSON has no NaN either, and json_valid() would
    // refuse it.
    return _quote(dumps(value, { ensureAscii: false, allowNan: false, floatKeys: BUNDLE_FLOAT_KEYS }));
  }
  return _quote(str(value));
}

export function _quote(s: string): string {
  // Backslashes are literal in an SQLite string; only the quote needs
  // doubling.
  if (s.includes("\x00")) {
    throw new ValueError("a NUL cannot be stored in a text value");
  }
  return "'" + s.replaceAll("'", "''") + "'";
}

/** What ends a `--` comment line, or hides where one ends: a line break of any
 *  kind, and every other control character. */
export const _NOT_IN_A_COMMENT = new RegExp("[\\x00-\\x1f\\x7f\\x85\\u2028\\u2029]+", "gu");

/** What a statement splitter that does not know about comments would read as
 *  the start of a string or the end of a statement. D1 splits some SQL on its
 *  own side, and a "learner's" in a comment there swallowed the rest of a
 *  migration (2026-10-01), so no SQL this project ships has one in a comment
 *  (tests/sql_literals.test.ts sweeps them). */
export const _SPLITTER_CHARS: Readonly<Record<string, string>> = { "'": "’", ";": ",", "`": "", '"': "" };

/**
 * A value made safe to write inside a `-- ...` SQL comment line.
 *
 * The comment ends at the line break, so a newline in a value put into one —
 * a model name, a date, an address typed into a form — would start a line of
 * SQL that runs. Every line break and control character becomes one space,
 * and nothing a splitter could read as a quote or a statement end is kept.
 */
export function comment(value: unknown): string {
  const text = str(value).replace(_NOT_IN_A_COMMENT, " ");
  let out = "";
  for (const ch of text) {
    out += Object.prototype.hasOwnProperty.call(_SPLITTER_CHARS, ch) ? _SPLITTER_CHARS[ch] : ch;
  }
  return out;
}

/** An INSERT ... ON CONFLICT DO UPDATE per row (see "Small statements"). */
export function _upsert(table: string, columns: string[], rows: unknown[][], key: string[]): string {
  if (rows.length === 0) {
    return "";
  }
  const updatable = columns.filter((c) => !key.includes(c));
  let onConflict: string;
  if (updatable.length > 0) {
    onConflict = `on conflict (${key.join(", ")}) do update set ` + updatable.map((c) => `${c} = excluded.${c}`).join(", ");
  } else {
    onConflict = `on conflict (${key.join(", ")}) do nothing`;
  }
  return rows
    .map(
      (row) =>
        `insert into ${table} (${columns.join(", ")}) values ` +
        `(${row.map((v, i) => lit(v, { asFloat: BUNDLE_FLOAT_KEYS.has(columns[i]) })).join(", ")}) ${onConflict};`,
    )
    .join("\n");
}

/** Japanese labels for the scene bank. The bundle carries scene ids only;
 *  the seed table is what knows what each picture shows. */
export function sceneLabels(itemType: string): Record<string, string> {
  try {
    return seedtable.load(itemType).scene_labels;
  } catch (e) {
    if (e instanceof FileNotFoundError) {
      return {};
    }
    throw e;
  }
}

/**
 * The whole publish, as one file D1 applies all or nothing.
 *
 * `withdrawnIds` defaults to the committed ledger (`batches/withdrawn.txt`).
 */
export function bundleSql(
  bundle: Record<string, any>,
  bundleId: string,
  opts: { withdrawnIds?: Iterable<string> | null } = {},
): string {
  const itemType: string = getitem(bundle, "item_type");
  const items: Record<string, any>[] = getitem(bundle, "items");
  const labels = sceneLabels(itemType);
  const gone: ReadonlySet<string> = opts.withdrawnIds == null ? withdrawn.ids() : new Set(opts.withdrawnIds);

  let parts: string[] = [
    `-- ${comment(bundleId)}: ${items.length} × ${comment(itemType)} (${comment(getitem(bundle, "level"))})`,
    `-- generated ${comment(get(bundle, "generated_at", ""))} ` + `by ${comment(get(bundle, "generator_model", ""))}`,
    "-- Produced by bjt publish. Idempotent: re-running replaces these rows.",
    "",
  ];

  const scenes = sorted(new Set(items.filter((it) => truthy(get(it, "scene_id"))).map((it) => it["scene_id"] as string)));
  // A per-item picture is labelled by its item's topic; a bank scene by the
  // seed table. Either way image_path is left alone here.
  const pictureLabels: Record<string, any> = {};
  for (const it of items) {
    if (truthy(get(it, "scene_id")) && truthy(get(it, "image_brief"))) {
      pictureLabels[it["scene_id"]] = get(it, "topic", "");
    }
  }
  if (scenes.length > 0) {
    parts = parts.concat([
      "-- Scenes are a shared bank (or, for 画像把握, one picture per item),",
      "-- image_path stays null until the art exists, and is deliberately not",
      "-- overwritten by a re-publish.",
      _upsert(
        "scenes",
        ["id", "label_ja"],
        scenes.map((s) => [s, or(get(pictureLabels, s), get(labels, s, ""))]),
        ["id"],
      ),
      "",
    ]);
  }

  const clips: Record<string, any>[] = get(bundle, "audio_manifest", []);
  if (truthy(clips)) {
    parts = parts.concat([
      "-- One row per distinct utterance. audio_path is filled in by the TTS step.",
      _upsert(
        "audio_clips",
        ["id", "text", "voice", "channel"],
        clips.map((c) => [getitem(c, "clip_id"), getitem(c, "text"), getitem(c, "voice"), getitem(c, "channel")]),
        ["id"],
      ),
      "",
    ]);
  }

  parts = parts.concat([
    _upsert(
      "bundles",
      ["id", "item_type", "level", "generator_model", "generated_at"],
      [[
        bundleId,
        itemType,
        getitem(bundle, "level"),
        get(bundle, "generator_model", "unknown"),
        get(bundle, "generated_at"),
      ]],
      ["id"],
    ),
    "",
  ]);

  const itemColumns = [
    "id", "bundle_id", "item_type", "level", "seed_cell_id", "setting", "relation",
    "function", "channel", "scene_id", "speaker_role", "listener_role", "topic",
    "stem", "correct_index", "explanation_ja", "explanation_en", "vocab_notes",
    "documents", "dialogue", "narration_clip_id", "model_p_correct",
  ];
  const itemRows: unknown[][] = [];
  const optionRows: unknown[][] = [];
  for (const it of items) {
    const cell = or(get(it, "seed_cell"), {}) as Record<string, any>;
    itemRows.push([
      getitem(it, "id"), bundleId, itemType, getitem(it, "level"),
      get(cell, "id"), get(cell, "setting"), get(cell, "relation"), get(cell, "function"),
      or(get(it, "channel"), get(cell, "channel")),
      get(it, "scene_id"), get(it, "speaker_role"), get(it, "listener_role"),
      get(it, "topic", ""), getitem(it, "stem"), getitem(it, "correct_index"),
      get(it, "explanation_ja", ""), get(it, "explanation_en", ""),
      get(it, "vocab_notes", []),
      // Always arrays, even for the types that carry exactly one document
      // or no conversation: the column's default is `[]` and the app would
      // rather branch on emptiness than on null.
      get(it, "documents", []),
      get(it, "dialogue", []),
      get(or(get(it, "audio"), {}), "narration"),
      // The difficulty prior, as measured at generation time by the
      // difficulty probe (or by the gate's full view, when the probe did
      // not run). Null for the hand-written batches, which skip both. The
      // queue reads null as "no opinion" rather than as "average", so an
      // unmeasured item is neither promoted nor buried.
      get(it, "model_p_correct"),
    ]);
    const clipIds = or(get(or(get(it, "audio"), {}), "options"), []) as (string | null)[];
    (getitem(it, "options") as Record<string, any>[]).forEach((opt, pos) => {
      optionRows.push([
        getitem(it, "id"), pos, getitem(opt, "text"), getitem(opt, "role"), get(opt, "why", ""),
        pos < clipIds.length ? clipIds[pos] : null,
      ]);
    });
  }

  const ids = items.map((it) => lit(getitem(it, "id"))).join(", ");
  parts = parts.concat([
    _upsert("items", itemColumns, itemRows, ["id"]),
    "",
    "-- Options are replaced wholesale rather than upserted: a corrected item can",
    "-- have fewer options or a different order, and a stale row left behind would",
    "-- be a fifth answer nobody meant to publish.",
    `delete from item_options where item_id in (${ids});`,
    _upsert(
      "item_options",
      ["item_id", "position", "text", "role", "why", "clip_id"],
      optionRows,
      ["item_id", "position"],
    ),
    "",
  ]);

  // After the upsert, so an item this transaction inserts for the first time
  // is withdrawn in the same breath rather than served until the next deploy.
  const pulled = items.filter((it) => gone.has(getitem(it, "id"))).map((it) => getitem(it, "id") as string);
  if (pulled.length > 0) {
    parts = parts.concat([
      "-- Withdrawn after review: batches/withdrawn.txt says why. An unpublish,",
      "-- never a delete, so every answer already given keeps resolving. Nothing",
      "-- here ever sets is_published back to 1: a question the owner vetoed",
      "-- in the app stays vetoed however often this file is applied.",
      "update items set is_published = 0",
      ` where id in (${pulled.map((i) => lit(i)).join(", ")});`,
      "",
    ]);
  }

  return [...parts, ""].join("\n");
}

/** Read a bundle, write its SQL next to it (or wherever asked). */
export function publishBundle(p: string, opts: { out?: string | null } = {}): [string, Record<string, any>] {
  const bundle = loads(readFileSync(p, "utf8"));
  const bundleId = path.basename(p, path.extname(p));
  const sql = bundleSql(bundle, bundleId);
  const out = or(opts.out ?? null, path.join(path.dirname(p), bundleId + ".sql")) as string;
  writeAtomic(out, sql);
  return [out, bundle];
}
