/**
 * `bjt reports`: what testers reported, as decisions. It reads wrangler's JSON,
 * leaves out what is already withdrawn or vetoed, puts the most-reported first,
 * and proposes a ledger line that `withdrawn.load` accepts. It selects nothing
 * about who reported what.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as reports from "../bjt/reports.ts";
import * as withdrawn from "../bjt/withdrawn.ts";

const ITEMS = new Map<string, Record<string, any>>([
  ["aaaaaaaaaa", { item_type: "hyougen", level: "J2", stem: "取引先にお礼のメールを書きます。" }],
  ["bbbbbbbbbb", { item_type: "sougou_choukai", level: "J3", stem: "何が変わりましたか。" }],
]);

function _row(item_id: string, reason: string, note: string, updated_at: string, is_published = 1) {
  return { item_id, reason, note, updated_at, is_published };
}

describe("reports", () => {
  test("wrangler's json is read, whatever it printed first", () => {
    const text = "⛅️ wrangler\n▲ [WARNING] this may take some time\n" + JSON.stringify([{ results: [_row("aaaaaaaaaa", "unnatural", " 不自然 ", "2026-10-08")],
                                                    success: true, meta: {} }]);
    expect(reports.parse(text)).toEqual([
      { item_id: "aaaaaaaaaa", reason: "unnatural", note: "不自然", updated_at: "2026-10-08", is_published: true },
    ]);
    expect(reports.parse("")).toEqual([]);
  });

  test("the most reported come first, and what is out already is only counted", () => {
    const rows = reports.parse(JSON.stringify([
      _row("aaaaaaaaaa", "ambiguous", "", "2026-10-01"),
      _row("bbbbbbbbbb", "unnatural", "Bの発言", "2026-10-02"),
      _row("bbbbbbbbbb", "wrong_answer", "", "2026-10-03"),
      _row("cccccccccc", "audio", "", "2026-10-04"),          // in the ledger
      _row("dddddddddd", "other", "", "2026-10-05", 0),       // vetoed in the app
    ]));
    const { open, handled } = reports.summarise(rows, { ledger: new Set(["cccccccccc"]), items: ITEMS });
    expect(open.map((e) => [e.item_id, e.count])).toEqual([["bbbbbbbbbb", 2], ["aaaaaaaaaa", 1]]);
    expect(handled).toBe(2);
    expect(open[0].last).toBe("2026-10-03");
    expect(open[0].stem).toBe("何が変わりましたか。");
  });

  test("the proposed line is one the ledger accepts", () => {
    const rows = reports.parse(JSON.stringify([
      _row("bbbbbbbbbb", "unnatural", "Bの発言が\n不自然", "2026-10-02"),
      _row("aaaaaaaaaa", "ambiguous", "", "2026-10-01"),
    ]));
    const { open } = reports.summarise(rows, { ledger: new Set(), items: ITEMS });
    const dir = mkdtempSync(path.join(tmpdir(), "bjt-reports-"));
    const ledger = path.join(dir, withdrawn.LEDGER_NAME);
    writeFileSync(ledger, open.map((e) => reports.proposedLine(e)).join("\n") + "\n", "utf8");
    const loaded = withdrawn.load({ path: ledger });
    expect(loaded["bbbbbbbbbb"].reason).toBe("unnatural");
    expect(loaded["bbbbbbbbbb"].note).toBe("Bの発言が 不自然");
    expect(loaded["aaaaaaaaaa"].reason).toBe("ambiguous");
  });

  test("a night with nothing open adds nothing to its pull request", () => {
    expect(reports.markdown({ open: [], handled: 3 })).toBe("");
  });

  test("the query reads, and reads nobody", () => {
    expect(reports.QUERY.toLowerCase().startsWith("select ")).toBe(true);
    expect(reports.QUERY).not.toMatch(/user_id|\b(?:insert|update|delete|drop)\b|;/iu);
    expect(reports.COMMAND).toContain("--remote --json");
  });
});
