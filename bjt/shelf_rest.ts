/**
 * Which shelves rest tonight: the ones that have written nothing, night after night.
 *
 * The work order sends a night to the shelves furthest behind their share, and a
 * shelf that cannot be written — a schema the API refuses, distractors the gate
 * always finds leaky — stays furthest behind, so every night goes back to it and
 * pays for drafts that are all thrown away. From 2026-09-28 three nights in a row
 * spent their whole budget on the same three shelves and wrote nothing.
 *
 * So the night keeps a record, one tiny marker per shelf it tried:
 * `nightly/shelves/<type>.<level>.<when>.<outcome>` in the media bucket
 * (bjt/r2.ts), where the outcome is `written` or `missed`. A shelf whose last
 * `config.SHELF_REST_AFTER` markers are all misses rests: the work order passes it
 * over until `config.SHELF_REST_DAYS` after its last miss, then tries it once
 * more (a fix may have landed meanwhile), and one more miss rests it again. A
 * written night clears the streak. A night that stopped on a ceiling or an empty
 * account records nothing for the shelf it stopped in: that was not the shelf.
 *
 * The bucket, not a branch, is the memory, as for the picture job's refusals
 * (bjt/scene_art.ts): the runner forgets everything each night, and whether a
 * night runs is still decided by `main` and the ceilings alone. The Worker serves
 * only `audio/` and `scenes/`, so these markers are never public. An unconfigured
 * bucket rests nothing and records nothing; a ledger that cannot be read is a
 * warning, and every shelf is tried, as before — the dollar ceiling still holds.
 */
import * as config from "./config.ts";
import { errText, SystemExit, sorted } from "./py.ts";
import * as r2 from "./r2.ts";

export const PREFIX = "nightly/shelves/";
export const WRITTEN = "written";
export const MISSED = "missed";

/** A shelf: (item type, level). */
export type Shelf = [string, string];

/** A dict keyed by a shelf is a Map keyed by `shelfKey(item_type, level)`
 *  (a JavaScript Map compares arrays by identity, so the tuple cannot be the
 *  key itself); `shelfOf(key)` gives the tuple back. */
export function shelfKey(itemType: string, level: string): string {
  return JSON.stringify([itemType, level]);
}

export function shelfOf(key: string): Shelf {
  return JSON.parse(key) as Shelf;
}

/** A shelf's markers, oldest first: (when, outcome). */
export type History = Map<string, [Date, string][]>;

/** `f"{when:%Y%m%dT%H%M%S}"` in UTC. */
function _strftime(when: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${when.getUTCFullYear()}${p(when.getUTCMonth() + 1)}${p(when.getUTCDate())}`
    + `T${p(when.getUTCHours())}${p(when.getUTCMinutes())}${p(when.getUTCSeconds())}`;
}

/** The object key one night's outcome on one shelf is recorded under. */
export function marker(itemType: string, level: string, outcome: string, when: Date): string {
  return `${PREFIX}${itemType}.${level}.${_strftime(when)}.${outcome}`;
}

/** `datetime.strptime(stamp, "%Y%m%dT%H%M%S")`'s pattern: Python's own regex for
 *  each directive (a month or a day may be one digit, `\d` is any decimal digit,
 *  the match is case-insensitive), matched from the start, the whole stamp
 *  consumed. */
const _STAMP_RE = new RegExp(
  "^(\\p{Nd}\\p{Nd}\\p{Nd}\\p{Nd})"
  + "(1[0-2]|0[1-9]|[1-9])"
  + "(3[0-1]|[1-2]\\p{Nd}|0[1-9]|[1-9]| [1-9])"
  + "T"
  + "(2[0-3]|[0-1]\\p{Nd}|\\p{Nd})"
  + "([0-5]\\p{Nd}|\\p{Nd})"
  + "(6[0-1]|[0-5]\\p{Nd}|\\p{Nd})",
  "iu",
);

const _ND = /\p{Nd}/u;

/** `int()` of decimal digits, any script's (Unicode puts each script's ten
 *  digits in a run of ten, zero first). */
function _digits(s: string): number {
  let n = 0;
  for (const ch of s.trim()) {
    const cp = ch.codePointAt(0)!;
    let start = cp;
    while (_ND.test(String.fromCodePoint(start - 1))) start--;
    n = n * 10 + ((cp - start) % 10);
  }
  return n;
}

/** The stamp as a UTC time, or null where strptime raises ValueError. */
function _strptime(stamp: string): Date | null {
  const m = _STAMP_RE.exec(stamp);
  if (!m || m[0].length !== stamp.length) return null;
  const [year, month, day, hour, minute, second] = m.slice(1).map(_digits);
  const daysIn = [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || day > daysIn[month - 1] || second > 59) return null;
  const when = new Date(0);
  when.setUTCFullYear(year, month - 1, day);
  when.setUTCHours(hour, minute, second, 0);
  return when;
}

/** Markers back into each shelf's history. A key that is not a marker is
 *  ignored rather than fatal: the ledger is a courtesy, not the job. */
export function parse(keys: Iterable<string>): History {
  const history: History = new Map();
  for (const key of keys) {
    const name = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key;
    const parts = name.split(".");
    if (parts.length !== 4 || ![WRITTEN, MISSED].includes(parts[3])) {
      continue;
    }
    const [itemType, level, stamp, outcome] = parts;
    const when = _strptime(stamp);
    if (when === null) {
      continue;
    }
    const k = shelfKey(itemType, level);
    if (!history.has(k)) history.set(k, []);
    history.get(k)!.push([when, outcome]);
  }
  for (const [k, marks] of history) {
    history.set(k, sorted(marks, { key: ([when, outcome]) => [when.getTime(), outcome] }));
  }
  return history;
}

/** Shelf → when it may be tried again, for every shelf resting at `now`.
 *
 *  Resting means its last `after` markers are all misses and the newest is
 *  less than `days` old. `after` of 0 or less turns resting off. */
export function resting(history: History, now: Date,
                        opts: { after?: number | null; days?: number | null } = {}): Map<string, Date> {
  const after = opts.after ?? config.SHELF_REST_AFTER;
  const days = opts.days ?? config.SHELF_REST_DAYS;
  if (after <= 0) {
    return new Map();
  }
  const out = new Map<string, Date>();
  for (const [shelf, marks] of history) {
    const tail = marks.slice(-after).map(([, outcome]) => outcome);
    if (tail.length < after || tail.some((o) => o !== MISSED)) {
      continue;
    }
    // timedelta(days=...) is whole microseconds; a Date holds milliseconds.
    const until = new Date(marks[marks.length - 1][0].getTime() + Math.round(days * 86400000));
    if (now.getTime() < until.getTime()) {
      out.set(shelf, until);
    }
  }
  return out;
}

/** The shelves resting tonight, read from the bucket, and a warning when
 *  it could not be read. No bucket: nothing rests, and nothing is said. */
export async function load(now: Date, opts: { creds?: r2.Credentials | null } = {}
                           ): Promise<[Map<string, Date>, string | null]> {
  const creds = opts.creds ?? r2.Credentials.fromEnv();
  if (creds === null) {
    return [new Map(), null];
  }
  let keys: string[];
  try {
    keys = await r2.listKeys(creds, PREFIX, { delimiter: "/" });
  } catch (exc) { // the ledger is a courtesy, not the job
    if (exc instanceof SystemExit) throw exc;
    return [new Map(), `could not read the shelf ledger (${errText(exc)}); every shelf is tried tonight`];
  }
  return [resting(parse(keys), now), null];
}

/** Write tonight's markers: (item type, level, outcome) each. Returns a
 *  warning if any could not be written, or null. */
export async function record(outcomes: Iterable<[string, string, string]>, now: Date,
                             opts: { creds?: r2.Credentials | null } = {}): Promise<string | null> {
  const creds = opts.creds ?? r2.Credentials.fromEnv();
  if (creds === null) {
    return null;
  }
  const failed: string[] = [];
  for (const [itemType, level, outcome] of outcomes) {
    try {
      await r2.put(creds, marker(itemType, level, outcome, now), new Uint8Array(0),
                   "text/plain; charset=utf-8", { overwrite: false });
    } catch (exc) {
      if (exc instanceof r2.AlreadyExists) {
        // already recorded
      } else if (exc instanceof SystemExit) {
        throw exc;
      } else {
        failed.push(`${itemType} ${level}: ${errText(exc)}`);
      }
    }
  }
  return failed.length ? `could not record in the shelf ledger: ${failed.join("; ")}` : null;
}
