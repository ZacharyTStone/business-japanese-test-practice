/**
 * What testers reported, as decisions the owner can make.
 *
 * A report (`item_feedback`: one row per person per question, a reason from
 * the closed set and an optional sentence) is a report, never a decision:
 * nothing in the queue reads it, and a reported question is served until
 * somebody looks. This is the looking. It lists every reported question that is
 * still live — the most-reported first — with its type, level and stem, what
 * people said, and the line `batches/withdrawn.txt` would need to take it out.
 *
 * It never writes the ledger. Withdrawing is the owner's call, made by pasting
 * the line (and rewording its sentence) and merging; `bjt publish` then writes
 * the unpublish, as for any other withdrawal.
 *
 * Read-only by construction: the pipeline holds no database key. `QUERY` is one
 * SELECT, printed (`COMMAND`) for the owner to run with wrangler; its `--json`
 * output is what `parse` reads. No user id is selected — who reported a question
 * is not needed to decide whether it goes.
 */
import * as batch from "./batch.ts";
import * as withdrawn from "./withdrawn.ts";

export const QUERY = (
  "select f.item_id, f.reason, f.note, f.updated_at, i.is_published "
  + "from item_feedback f join items i on i.id = f.item_id "
  + "order by f.updated_at desc"
);

export const COMMAND = (
  "(cd client && npx wrangler d1 execute business-japanese-drill --remote --json "
  + `--command "${QUERY}")`
);

export type Report = {
  item_id: string;
  reason: string;
  note: string;
  updated_at: string;
  is_published: boolean;
};

/** One reported question, everything said about it put together. */
export type Reported = {
  item_id: string;
  count: number;
  reasons: Record<string, number>;
  notes: string[];
  last: string;
  /** From the committed bundles; null for a question no bundle has. */
  item_type: string | null;
  level: string | null;
  stem: string | null;
};

/** The rows in wrangler's `--json` output (a list of results, one per
 *  statement), or in a plain list of rows. Anything wrangler prints before the
 *  JSON is skipped: the JSON starts on a line of its own, and a banner's
 *  「▲ [WARNING]」 does not. */
export function parse(text: string): Report[] {
  const start = text.search(/^[ \t]*[[{]/mu);
  if (start < 0) {
    return [];
  }
  const data: unknown = JSON.parse(text.slice(start));
  const blocks = Array.isArray(data) ? data : [data];
  const rows: Record<string, any>[] = blocks.flatMap((b: any) =>
    b !== null && typeof b === "object" && Array.isArray(b.results) ? b.results : [b]);
  return rows
    .filter((r) => r !== null && typeof r === "object" && typeof r.item_id === "string")
    .map((r) => ({
      item_id: r.item_id,
      reason: String(r.reason ?? "other"),
      note: String(r.note ?? "").trim(),
      updated_at: String(r.updated_at ?? ""),
      // D1 gives a boolean column back as 0/1; a row without it is taken as live.
      is_published: r.is_published === undefined || r.is_published === null || Boolean(Number(r.is_published)),
    }));
}

/** Every committed item, by id: what a report's question was. */
function _committed(): Map<string, Record<string, any>> {
  const out = new Map<string, Record<string, any>>();
  for (const p of batch.bundles()) {
    const bundle = batch.load(p);
    for (const it of bundle["items"] as Record<string, any>[]) {
      out.set(it["id"], { ...it, item_type: it["item_type"] ?? bundle["item_type"],
                          level: it["level"] ?? bundle["level"] });
    }
  }
  return out;
}

/**
 * The reported questions still in front of learners, most-reported first (then
 * most recent), and how many reported ones are already out — in the ledger or
 * vetoed in the app, which the database says by `is_published`.
 */
export function summarise(
  reports: Report[],
  opts: { ledger?: ReadonlySet<string>; items?: Map<string, Record<string, any>> } = {},
): { open: Reported[]; handled: number } {
  const ledger = opts.ledger ?? withdrawn.ids();
  const items = opts.items ?? _committed();
  const byItem = new Map<string, Reported>();
  const handled = new Set<string>();
  for (const r of reports) {
    if (ledger.has(r.item_id) || !r.is_published) {
      handled.add(r.item_id);
      continue;
    }
    let entry = byItem.get(r.item_id);
    if (entry === undefined) {
      const it = items.get(r.item_id);
      entry = {
        item_id: r.item_id, count: 0, reasons: {}, notes: [], last: "",
        item_type: it?.["item_type"] ?? null, level: it?.["level"] ?? null, stem: it?.["stem"] ?? null,
      };
      byItem.set(r.item_id, entry);
    }
    entry.count += 1;
    entry.reasons[r.reason] = (entry.reasons[r.reason] ?? 0) + 1;
    if (r.note) {
      entry.notes.push(r.note);
    }
    if (r.updated_at > entry.last) {
      entry.last = r.updated_at;
    }
  }
  const open = [...byItem.values()].sort(
    (a, b) => b.count - a.count || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) || (a.item_id < b.item_id ? -1 : 1));
  return { open, handled: handled.size };
}

/** The reason most people gave, ties going to the closed set's order. */
export function topReason(entry: Reported): string {
  return [...withdrawn.REASONS].sort((a, b) => (entry.reasons[b] ?? 0) - (entry.reasons[a] ?? 0))[0];
}

/** The ledger line that would withdraw it: the commonest reason, and the first
 *  thing anybody wrote as its sentence (to be reworded before it is pasted). */
export function proposedLine(entry: Reported): string {
  const note = (entry.notes[0] ?? "<what is wrong, in one sentence>").replace(/\s+/gu, " ");
  return withdrawn.line(new withdrawn.Withdrawal({ item_id: entry.item_id, reason: topReason(entry), note }));
}

function _reasons(entry: Reported): string {
  return withdrawn.REASONS.filter((r) => entry.reasons[r]).map((r) => `${r} ×${entry.reasons[r]}`).join(", ");
}

/** For a terminal. */
export function render(summary: { open: Reported[]; handled: number }): string {
  const { open, handled } = summary;
  const lines = [
    `Reported questions still live: ${open.length}`
    + (handled ? ` (${handled} more already withdrawn or vetoed)` : ""),
  ];
  for (const e of open) {
    const where = e.item_type ? `${e.item_type} ${e.level}` : "not in any committed bundle";
    lines.push("", `  ${e.item_id}  ${where}  ${e.count} report(s), last ${e.last.slice(0, 10)}: ${_reasons(e)}`);
    if (e.stem) {
      lines.push(`    「${e.stem}」`);
    }
    for (const n of e.notes) {
      lines.push(`    note: ${n.replace(/\s+/gu, " ")}`);
    }
    lines.push(`    to withdraw, add to batches/${withdrawn.LEDGER_NAME}:`, `      ${proposedLine(e)}`);
  }
  return lines.join("\n");
}

/** For the night's pull request: nothing when nothing is open. */
export function markdown(summary: { open: Reported[]; handled: number }): string {
  const { open } = summary;
  if (open.length === 0) {
    return "";
  }
  const lines = [
    `## Reported questions still live (${open.length})`,
    "",
    "A report is not a decision: each of these is still served. To take one out, add its line to "
    + `\`batches/${withdrawn.LEDGER_NAME}\` (reword the sentence), run \`bjt publish\` on its bundle, `
    + "and merge; or veto it in the app.",
    "",
    "| question | type | reports | what people said |",
    "|---|---|---|---|",
  ];
  for (const e of open) {
    const where = e.item_type ? `${e.item_type} ${e.level}` : "—";
    const said = e.notes.length ? e.notes.map((n) => n.replace(/[|\s]+/gu, " ")).join(" / ") : "—";
    lines.push(`| \`${e.item_id}\` | ${where} | ${_reasons(e)} | ${said} |`);
  }
  return lines.join("\n");
}
