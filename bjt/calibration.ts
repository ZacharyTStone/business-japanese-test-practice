/**
 * `bjt calibrate`: your accuracy on the official samples, against the bank's.
 *
 * The honesty check the README describes. There is no IRT calibration for a
 * generated item, so the only evidence that the bank is pitched like the exam is
 * one person answering both: a learner who scores much higher on the bank than
 * on the official samples is looking at prompts that have drifted soft. Both
 * numbers are easy to get wrong in a way that flatters the bank:
 *
 * * **A skip is not a wrong answer.** An accuracy is right over answered: the
 *   official items left unanswered ('s') and those never shown (more than four
 *   options) are not in it, or skipping half the paper would cap the official
 *   score at half and make the bank look that much easier than the exam. How
 *   much was answered — answered over total — is reported beside it, never
 *   folded in.
 * * **The bank's side is the app, not the terminal.** The local SQLite
 *   `responses` table holds only what `bjt practice` writes; the app's record is
 *   `attempts` in D1, which comes in as a CSV exported with
 *   `ATTEMPTS_EXPORT_SQL` (`--attempts-csv`). The SQLite table is read when no
 *   file is given, for somebody who practised here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { get, percent, PyError, repr, strip, ValueError } from "./py.ts";

/** What to run in the D1 console of the Cloudflare dashboard to export the
 *  app's side, then download the result as CSV (or `npx wrangler d1 execute
 *  business-japanese-drill --remote --json --command "..."`). One select, so it
 *  changes nothing.
 *
 *  * **First attempts only**: each question's first answer, before its 解説
 *    was on screen, which is the only answer comparable with an official item
 *    sat once. A second attempt is a memory test.
 *  * **One account**: calibration compares one person with themself.
 *    Everybody's answers would compare one person's official score with the
 *    testers' ability.
 *  * **The live bank**: a withdrawn question left for being broken, and its
 *    answers say nothing about how the bank is pitched now.
 *  * `chosen_index` -1 is the reading clock running out. It is exported so it
 *    can be counted apart, the way a skip is on the official side. */
export const ATTEMPTS_EXPORT_SQL = `select i.item_type, a.is_correct, a.chosen_index
  from (select att.item_id, att.is_correct, att.chosen_index,
               row_number() over (partition by att.item_id
                                  order by att.answered_at, att.id) as nth
          from attempts att
          join users u on u.id = att.user_id
         where u.email = lower('you@example.com')  -- your sign-in address
       ) a
  join items i on i.id = a.item_id
 where a.nth = 1 and i.is_published = 1
 order by i.item_type;`;

/** The columns `--attempts-csv` cannot do without. `chosen_index` is optional:
 *  without it a timed-out answer is indistinguishable from a wrong one, which
 *  is how the app grades it, and the tally says nothing ran out. */
export const REQUIRED_COLUMNS: readonly string[] = ["item_type", "is_correct"];

export const _TRUE: ReadonlySet<string> = new Set(["true", "t", "1", "yes", "y"]);
export const _FALSE: ReadonlySet<string> = new Set(["false", "f", "0", "no", "n"]);

/** Right over answered, and answered over total, kept apart. */
export class Tally {
  right: number;
  answered: number;
  /** Official side: the items in the sitting. App side: the first attempts
   *  in the file, timed-out ones included. */
  total: number;

  constructor(init: { right?: number; answered?: number; total?: number } = {}) {
    this.right = init.right ?? 0;
    this.answered = init.answered ?? 0;
    this.total = init.total ?? 0;
  }

  get accuracy(): number | null {
    return this.answered ? this.right / this.answered : null;
  }

  get unanswered(): number {
    return this.total - this.answered;
  }
}

// ------------------------------------------------------------------ CSV
//
// Python's `csv.DictReader` over a file opened with `newline=""` and
// `encoding="utf-8-sig"`, for the excel dialect: what the D1 console's
// download writes, read the way the Python read it (quoted fields that hold
// commas, doubled quotes and line breaks; blank lines skipped; a short row
// padded with nothing, a long one's extra fields kept apart).

/** Python's `csv.Error`. */
export class CsvError extends PyError {}

/** What Python raised when a long row's extra fields (a list) reached
 *  `.strip()`. */
export class AttributeError extends PyError {}

/** `csv.field_size_limit()`'s default. */
const FIELD_SIZE_LIMIT = 131072;

/** The file's lines as Python reads them with `newline=""`: split after
 *  "\n", "\r" or "\r\n", each keeping its ending. */
function physicalLines(text: string): string[] {
  const lines: string[] = [];
  const re = /\r\n|\r|\n/g;
  let start = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    lines.push(text.slice(start, m.index + m[0].length));
    start = m.index + m[0].length;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

type CsvState = "START_RECORD" | "START_FIELD" | "IN_FIELD" | "IN_QUOTED_FIELD" | "QUOTE_IN_QUOTED_FIELD" | "EAT_CRNL";

/** `csv.reader(fh)` with the excel dialect: the rows, a blank line as `[]`.
 *  The same state machine as CPython's `Modules/_csv.c` (delimiter ",",
 *  quotechar '"', doublequote, not strict, no escapechar). */
export function* _csvRows(text: string): Generator<string[]> {
  const EOL = null;
  // In an object, so that what a closure sets is what the loop reads.
  const st: { state: CsvState } = { state: "START_RECORD" };
  let fields: string[] = [];
  let field = "";
  let fieldLen = 0;

  const saveField = () => {
    fields.push(field);
    field = "";
    fieldLen = 0;
  };
  const addChar = (c: string) => {
    if (fieldLen >= FIELD_SIZE_LIMIT) {
      throw new CsvError(`field larger than field limit (${FIELD_SIZE_LIMIT})`);
    }
    field += c;
    fieldLen += 1;
  };
  const isLineBreak = (c: string | null) => c === "\n" || c === "\r";

  const startField = (c: string | null) => {
    // expecting field
    if (isLineBreak(c) || c === EOL) {
      // save empty field - return [fields]
      saveField();
      st.state = c === EOL ? "START_RECORD" : "EAT_CRNL";
    } else if (c === '"') {
      // start quoted field
      st.state = "IN_QUOTED_FIELD";
    } else if (c === ",") {
      // save empty field
      saveField();
    } else {
      // begin new unquoted field
      addChar(c);
      st.state = "IN_FIELD";
    }
  };

  const processChar = (c: string | null) => {
    switch (st.state) {
      case "START_RECORD":
        // start of record
        if (c === EOL) {
          // empty line - return []
        } else if (isLineBreak(c)) {
          st.state = "EAT_CRNL";
        } else {
          // normal character - handle as START_FIELD
          st.state = "START_FIELD";
          startField(c);
        }
        break;
      case "START_FIELD":
        startField(c);
        break;
      case "IN_FIELD":
        // in unquoted field
        if (isLineBreak(c) || c === EOL) {
          // end of line - return [fields]
          saveField();
          st.state = c === EOL ? "START_RECORD" : "EAT_CRNL";
        } else if (c === ",") {
          // save field - wait for new field
          saveField();
          st.state = "START_FIELD";
        } else {
          // normal character - save in field
          addChar(c);
        }
        break;
      case "IN_QUOTED_FIELD":
        // in quoted field
        if (c === EOL) {
          // a line break inside quotes: the next line continues the field
        } else if (c === '"') {
          // doublequote; " represented by ""
          st.state = "QUOTE_IN_QUOTED_FIELD";
        } else {
          // normal character - save in field
          addChar(c);
        }
        break;
      case "QUOTE_IN_QUOTED_FIELD":
        // doublequote - seen a quote in a quoted field
        if (c === '"') {
          // save "" as "
          addChar(c);
          st.state = "IN_QUOTED_FIELD";
        } else if (c === ",") {
          // save field - wait for new field
          saveField();
          st.state = "START_FIELD";
        } else if (isLineBreak(c) || c === EOL) {
          // end of line - return [fields]
          saveField();
          st.state = c === EOL ? "START_RECORD" : "EAT_CRNL";
        } else {
          // not strict: the character is kept, and the field goes on unquoted
          addChar(c);
          st.state = "IN_FIELD";
        }
        break;
      case "EAT_CRNL":
        if (isLineBreak(c)) {
          // more of the line ending
        } else if (c === EOL) {
          st.state = "START_RECORD";
        } else {
          throw new CsvError("new-line character seen in unquoted field - do you need to open the file with newline=''?");
        }
        break;
    }
  };

  const lines = physicalLines(text);
  let i = 0;
  for (;;) {
    fields = [];
    let atEnd = false;
    do {
      if (i >= lines.length) {
        // End of input: a field still open (a quote never closed) is kept.
        if (fieldLen !== 0 || st.state === "IN_QUOTED_FIELD") {
          saveField();
          atEnd = true;
          break;
        }
        return;
      }
      for (const c of lines[i++]) {
        processChar(c);
      }
      processChar(EOL);
    } while (st.state !== "START_RECORD");
    yield fields;
    if (atEnd) return;
  }
}

/** The text of a file opened with `encoding="utf-8-sig"`: a leading
 *  byte-order mark dropped, and bytes that are not UTF-8 refused (Python's
 *  UnicodeDecodeError is a ValueError). */
function readUtf8Sig(p: string): string {
  const bytes = readFileSync(p);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch (e) {
    throw new ValueError(`'utf-8' codec can't decode ${path.basename(p)}: it is not UTF-8`, { cause: e });
  }
}

/**
 * The app's first attempts at one item type, from the exported CSV.
 *
 * Accepts whatever the SQL editor's download writes: a byte-order mark,
 * `true`/`false` or `t`/`f`, extra columns. A row that cannot be read is an
 * error naming its line, not a row skipped: a skipped row is a number that
 * looks measured and is not.
 */
export function readAttemptsCsv(p: string, itemType: string): Tally {
  const name = path.basename(p);
  const tally = new Tally();
  const reader = _csvRows(readUtf8Sig(p));
  // DictReader's fieldnames: the first row, blank or not; none in an empty file.
  const first = reader.next();
  const fieldnames: string[] = first.done ? [] : first.value;
  const columns = new Set(fieldnames.map((c) => strip(c || "")));
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.has(c));
  if (missing.length > 0) {
    throw new ValueError(`${name} has no ${missing.join(", ")} column; export it ` + "with the SQL in `bjt calibrate --help`");
  }
  let line = 2;
  for (const fields of reader) {
    if (fields.length === 0) {
      continue; // DictReader skips a blank line, and does not count it
    }
    const n = line++;
    // dict(zip(fieldnames, fields)), the missing fields None; a long row's
    // extra fields go under the key None as a list, which has no strip().
    const row: Record<string, string> = {};
    fieldnames.forEach((k, i) => {
      row[strip(k || "")] = strip(i < fields.length ? fields[i] || "" : "");
    });
    if (fields.length > fieldnames.length) {
      throw new AttributeError("'list' object has no attribute 'strip'");
    }
    if (row["item_type"] !== itemType) {
      continue;
    }
    tally.total += 1;
    if (get(row, "chosen_index") === "-1") {
      continue; // the clock ran out: no answer was given
    }
    const value = row["is_correct"].toLowerCase();
    if (!_TRUE.has(value) && !_FALSE.has(value)) {
      throw new ValueError(`${name}:${n}: is_correct is ${repr(row["is_correct"])}, ` + "not true or false");
    }
    tally.answered += 1;
    tally.right += _TRUE.has(value) ? 1 : 0;
  }
  return tally;
}

/** The row `Store.accuracyByType` gives for one item type. */
export type AccuracyRow = { item_type: string; correct: number; answered: number };

/** The fallback: what `bjt practice` recorded in the local database. */
export function fromStore(store: { accuracyByType(): Iterable<AccuracyRow> }, itemType: string): Tally {
  for (const row of store.accuracyByType()) {
    if (row["item_type"] === itemType) {
      return new Tally({ right: row["correct"], answered: row["answered"], total: row["answered"] });
    }
  }
  return new Tally();
}

export function _score(tally: Tally): string {
  if (tally.accuracy === null) {
    return "n/a, nothing answered";
  }
  return `${tally.right} right of ${tally.answered} answered (${percent(tally.accuracy)})`;
}

/** The comparison, as the lines `bjt calibrate` prints. */
export function report(itemType: string, official: Tally, bank: Tally, source: string): string {
  const pad = " ".repeat(19);
  const lines = ["", "=".repeat(50), `CALIBRATION — ${itemType}`];
  lines.push(`  official items:  ${_score(official)}; ` + `answered ${official.answered} of ${official.total}`);
  if (official.unanswered) {
    lines.push(`${pad}${official.unanswered} left unanswered, ` + "which is not the same as wrong");
  }
  lines.push(`  generated items: ${_score(bank)}`);
  lines.push(`${pad}from ${source}` + (bank.unanswered ? `; ${bank.unanswered} timed out, not counted as answers` : ""));
  if (official.accuracy !== null && bank.accuracy !== null) {
    const gap = bank.accuracy - official.accuracy;
    if (gap > 0.1) {
      lines.push("  → Generated items look consistently EASIER than official ones.");
      lines.push("    The prompts may have drifted soft — tighten them.");
    } else if (gap < -0.1) {
      lines.push("  → Generated items look harder than official ones.");
    } else {
      lines.push("  → Generated and official difficulty look comparable.");
    }
  }
  lines.push("=".repeat(50));
  return lines.join("\n");
}
