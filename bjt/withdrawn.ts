/**
 * Questions taken out of the bank after review, and why.
 *
 * `batches/withdrawn.txt` is the ledger: one line per item, the item id, a reason
 * from a closed set, and a sentence saying what is wrong. It exists because a
 * committed item is never simply deleted from its bundle, for three reasons that
 * each rule deleting out:
 *
 * * **The database keeps the row.** An item somebody has already answered is
 *   pointed at by `attempts`, `review_schedule` and `item_feedback`, so removal is
 *   an unpublish (`is_published = false`), exactly as `veto_item()` does it from
 *   inside the app. `bjt publish` writes that statement into the bundle's SQL for
 *   every withdrawn id, so the ledger and the bank cannot disagree after a deploy.
 * * **The seed cell stays spent.** `item_id` is a hash of (type, cell). Were the
 *   item deleted, `spent_cell_ids` would free its cell, the next night could write
 *   that cell again, and the new question would inherit the withdrawn id — and
 *   with it the unpublish, so it would never be served.
 * * **The record is the point.** A withdrawn item is a worked example of what the
 *   generator must not write; `bjt/fidelity/naturalness.ts` and the prompts cite
 *   these. Deleting it would delete the evidence.
 *
 * Everything that reads the library as a learner meets it — the shelf counts in
 * `bjt plan`, the phrasebook's recurring lines, the pictures the scene job draws,
 * the clips `bjt synth` records, the library-wide sweeps in the tests — reads it
 * through `liveItems` / `liveBundle`, so a withdrawn question stops counting the
 * moment its line is committed. The nightly planner then sees its shelf as
 * emptier and refills it.
 *
 * Un-withdrawing is deliberately not symmetrical. Deleting a line stops the next
 * publish from unpublishing the item, but it does not publish it again, because
 * the bundle SQL never sets `is_published = true`: that is what keeps an owner's
 * veto from the app from being undone by the next deploy. Putting an item back is
 * one `update public.items set is_published = true where id = '…'`, by hand.
 *
 * The ledger is written by hand, and by one tool: `bjt regate --withdraw`
 * proposes lines through `append`, which adds after what is there and never
 * rewrites or removes one. A tool may make the ledger longer; only a person makes
 * it shorter.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as config from "./config.ts";
import { deepcopy, get, has, or, repr, rstrip, sorted, splitlines, splitWs, strip, truthy, ValueError } from "./py.ts";

/** Why an item was withdrawn. The same closed set as `public.item_feedback.reason`
 *  (d1/migrations/0001_initial.sql), so a tester's
 *  report and the decision it leads to are counted in one vocabulary. A test
 *  holds the two equal. */
export const REASONS: readonly string[] = ["unnatural", "wrong_answer", "ambiguous", "unclear", "audio", "other"];

export const LEDGER_NAME = "withdrawn.txt";

export class Withdrawal {
  readonly item_id: string;
  readonly reason: string;
  readonly note: string;

  constructor(init: { item_id: string; reason: string; note: string }) {
    this.item_id = init.item_id;
    this.reason = init.reason;
    this.note = init.note;
  }
}

/** Read at call time, so a test that points BATCH_DIR elsewhere is obeyed. */
export function ledgerPath(): string {
  return path.join(config.BATCH_DIR, LEDGER_NAME);
}

/** Python's `str.isspace()` set, what `str.split()` splits on. */
const WS = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const WS_RUN = new RegExp(`[${WS}]+`, "u");
const WS_LEAD = new RegExp(`^[${WS}]+`, "u");

/** `s.split(None, maxsplit)`: at most `maxsplit` splits on runs of
 *  whitespace, the rest of the line kept whole (its trailing whitespace
 *  included, as Python keeps it). */
function splitWsMax(s: string, maxsplit: number): string[] {
  const parts: string[] = [];
  let rest = s.replace(WS_LEAD, "");
  while (rest !== "" && parts.length < maxsplit) {
    const m = WS_RUN.exec(rest);
    if (m === null) break;
    parts.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest !== "") parts.push(rest);
  return parts;
}

/**
 * The ledger, by item id. A missing file is an empty ledger.
 *
 * A malformed line is an error rather than something to skip: a typo that
 * silently dropped a withdrawal would put the question back in front of
 * learners without anybody deciding to.
 */
export function load(opts: { path?: string | null } = {}): Record<string, Withdrawal> {
  const p = opts.path ?? ledgerPath();
  if (!existsSync(p)) {
    return {};
  }
  const name = path.basename(p);
  const out: Record<string, Withdrawal> = {};
  const lines = splitlines(readFileSync(p, "utf8"));
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const line = strip(lines[i]);
    if (!line || line.startsWith("#")) {
      continue;
    }
    const parts = splitWsMax(line, 2);
    if (parts.length < 3) {
      throw new ValueError(`${name}:${n}: expected '<item id> <reason> <what is wrong>'`);
    }
    const [itemId, reason, note] = parts;
    if (!REASONS.includes(reason)) {
      throw new ValueError(`${name}:${n}: reason ${repr(reason)} is not one of ${REASONS.join(", ")}`);
    }
    if (has(out, itemId)) {
      throw new ValueError(`${name}:${n}: ${itemId} is withdrawn twice`);
    }
    out[itemId] = new Withdrawal({ item_id: itemId, reason, note: strip(note) });
  }
  return out;
}

function _ids(opts: { path?: string | null } = {}): ReadonlySet<string> {
  return new Set(Object.keys(load(opts)));
}

/** What the tests fake: `ids()`, and every call this module makes to it
 *  (`liveItems` with no list), go through `seams.ids`, so a test that
 *  replaces it here is obeyed everywhere. */
export const seams = { ids: _ids };

export function ids(opts: { path?: string | null } = {}): ReadonlySet<string> {
  return seams.ids(opts);
}

/** One ledger line, laid out the way the hand-written ones are. */
export function line(entry: Withdrawal): string {
  return `${entry.item_id}  ${entry.reason.padEnd(12)}  ${entry.note}`;
}

/**
 * Add lines after everything already in the ledger. Returns how many.
 *
 * Append-only on purpose, and the only writer this module has. Nothing here
 * rewrites or removes a line: a line removed is a question put back in front
 * of learners, and that is a decision for a person with an editor, never for
 * a tool. Every line is held to the rules `load` applies — a reason from the
 * closed set, a note on one line — and an item already in the ledger is
 * refused rather than written twice, before anything is written at all.
 * `heading` goes above the new lines as comments, to say who proposed them.
 */
export function append(entries: Iterable<Withdrawal>, opts: { heading?: string; path?: string | null } = {}): number {
  const heading = opts.heading ?? "";
  const p = opts.path ?? ledgerPath();
  const existing = load({ path: p });
  const list = [...entries];
  const seen = new Set<string>();
  for (const e of list) {
    if (!REASONS.includes(e.reason)) {
      throw new ValueError(`${e.item_id}: reason ${repr(e.reason)} is not one of ${REASONS.join(", ")}`);
    }
    if (has(existing, e.item_id) || seen.has(e.item_id)) {
      throw new ValueError(`${e.item_id} is already withdrawn`);
    }
    if (!strip(e.note) || e.note.includes("\n") || splitWs(e.item_id).length !== 1) {
      throw new ValueError(`${e.item_id}: a withdrawal is an id and a one-line note`);
    }
    seen.add(e.item_id);
  }
  if (list.length === 0) {
    return 0;
  }
  // Read as Python's read_text reads, line endings made "\n".
  const before = existsSync(p) ? readFileSync(p, "utf8").replace(/\r\n?/g, "\n") : "";
  const block: string[] = before ? [""] : [];
  block.push(...splitlines(heading).map((h) => rstrip(`# ${h}`)));
  block.push(...list.map((e) => line(e)));
  let text = "";
  if (before && !before.endsWith("\n")) {
    text += "\n";
  }
  text += block.join("\n") + "\n";
  appendFileSync(p, text, { encoding: "utf8" });
  return list.length;
}

/** The bundle's items a learner can still be served. */
export function liveItems(bundle: Record<string, any>, opts: { withdrawn?: Iterable<string> | null } = {}): Record<string, any>[] {
  const gone: ReadonlySet<string> = opts.withdrawn == null ? ids() : new Set(opts.withdrawn);
  return (get(bundle, "items", []) as Record<string, any>[]).filter((it) => !gone.has(get(it, "id")));
}

/**
 * A copy of the bundle holding only what is still served: the items that
 * are not withdrawn, and the clips at least one of them plays.
 *
 * The manifest is de-duplicated across the bundle, so a clip is kept when any
 * live item uses it, whichever item happened to list it first. The spoken
 * option labels belong to no item — they are four clips for the whole library
 * — and are kept while any live item remains.
 */
export function liveBundle(bundle: Record<string, any>, opts: { withdrawn?: Iterable<string> | null } = {}): Record<string, any> {
  const out = deepcopy(bundle);
  const items = liveItems(out, { withdrawn: opts.withdrawn ?? null });
  out["items"] = items;
  const used = new Set<string>();
  for (const it of items) {
    const audio = or(get(it, "audio"), {}) as Record<string, any>;
    if (truthy(get(audio, "narration"))) {
      used.add(audio["narration"]);
    }
    for (const c of or(get(audio, "options"), []) as string[]) if (truthy(c)) used.add(c);
    for (const c of or(get(audio, "dialogue"), []) as string[]) if (truthy(c)) used.add(c);
  }
  out["audio_manifest"] = (get(out, "audio_manifest", []) as Record<string, any>[]).filter(
    (c) => used.has(get(c, "clip_id")) || (items.length > 0 && get(c, "kind") === "option_label"),
  );
  out["scenes"] = sorted(new Set(items.filter((it) => truthy(get(it, "scene_id"))).map((it) => it["scene_id"] as string)));
  return out;
}
