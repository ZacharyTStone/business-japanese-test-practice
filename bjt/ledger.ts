/**
 * Reading and appending the line ledgers in `batches/`: withdrawn.txt
 * (bjt/withdrawn.ts) and regated.txt (bjt/regate.ts).
 *
 * Both are text a person edits: one entry per line, its fields separated by
 * whitespace and the last of them the rest of the line, blank lines and `#`
 * comments ignored. A tool only ever adds lines after what is there; what
 * each line must say, and the words it may use, are the caller's.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { splitlines, splitWsMax, strip, ValueError } from "./py.ts";

/** One entry: where it is (`withdrawn.txt:12`, for an error) and its fields. */
export type LedgerLine = { where: string; parts: string[] };

/**
 * The entries of the ledger at `p`, in the file's order, each split into
 * `fields` parts. A missing file has none. A line with fewer parts is a
 * ValueError saying what was `expected`, raised when the reader reaches it,
 * so an earlier line's own error still comes first.
 */
export function* entries(p: string, fields: number, expected: string): Generator<LedgerLine> {
  if (!existsSync(p)) {
    return;
  }
  const name = path.basename(p);
  const lines = splitlines(readFileSync(p, "utf8"));
  for (let i = 0; i < lines.length; i++) {
    const where = `${name}:${i + 1}`;
    const text = strip(lines[i]);
    if (!text || text.startsWith("#")) {
      continue;
    }
    const parts = splitWsMax(text, fields - 1);
    if (parts.length < fields) {
      throw new ValueError(`${where}: expected ${expected}`);
    }
    yield { where, parts };
  }
}

/** The ledger's text as Python's read_text reads it, line endings made "\n";
 *  null when there is no file. */
export function readText(p: string): string | null {
  return existsSync(p) ? readFileSync(p, "utf8").replace(/\r\n?/g, "\n") : null;
}

/** Add `text` after everything in the ledger at `p`, whose text is `before`
 *  (`readText`). A hand edit that left no newline must not swallow the first
 *  new line, so one goes in first. */
export function appendAfter(p: string, before: string | null, text: string): void {
  const sep = before && !before.endsWith("\n") ? "\n" : "";
  appendFileSync(p, sep + text, { encoding: "utf8" });
}
