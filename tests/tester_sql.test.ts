/**
 * Re-adding a tester changes only what the command names.
 *
 * The deploy workflow re-adds a tester with `bjt tester "$EMAIL" --note "$NOTE"`,
 * and the statement it wrote set every flag from the command line — false,
 * false, null for a command that named none — so re-adding the owner took away
 * the veto, the unlimited day and the day's size.
 */
import { describe, expect, test } from "vitest";
import * as cli from "../bjt/cli/index.ts";
import { capture, type Captured } from "./helpers.ts";

async function _sql(cap: Captured, ...argv: string[]): Promise<string> {
  expect(await cli.main({ argv: ["tester", ...argv] })).toBe(0);
  const out = cap.readouterr().out;
  const at = out.indexOf("insert into");
  expect(at).toBeGreaterThanOrEqual(0);
  return out.slice(at);
}

function _updated(sql: string): string[] {
  const at = sql.indexOf("on conflict");
  expect(at).toBeGreaterThanOrEqual(0);
  const tail = sql.slice(at);
  return [...tail.matchAll(/([\p{L}\p{N}_]+) = excluded\.\1/gu)].map((m) => m[1]);
}

describe("tester sql", () => {
  test("the deploy workflows re add keeps the owners flags", async () => {
    const cap = capture();
    const sql = await _sql(cap, "owner@example.com", "--note", "the owner");
    expect(_updated(sql)).toEqual(["note"]);
    for (const flag of ["unlimited", "may_veto", "max_daily_goal"]) {
      expect(sql).not.toContain(`${flag} = excluded`);
    }
  });

  test("a re add that names nothing changes nothing", async () => {
    const cap = capture();
    const sql = await _sql(cap, "owner@example.com");
    expect(sql).toContain("on conflict (email) do nothing;");
    expect(sql).not.toContain("do update");
  });

  test("each named flag is the only one written", async () => {
    const cap = capture();
    expect(_updated(await _sql(cap, "a@example.com", "--veto"))).toEqual(["may_veto"]);
    expect(_updated(await _sql(cap, "a@example.com", "--unlimited"))).toEqual(["unlimited"]);
    expect(_updated(await _sql(cap, "a@example.com", "--max-goal", "60"))).toEqual(["max_daily_goal"]);
    expect(_updated(await _sql(cap, "a@example.com", "--note", "x", "--veto", "--max-goal", "60")))
      .toEqual(["note", "may_veto", "max_daily_goal"]);
  });

  test("a flag can still be taken away by name", async () => {
    const cap = capture();
    const sql = await _sql(cap, "a@example.com", "--no-veto", "--no-unlimited", "--no-max-goal");
    expect(sql).toContain("values ('a@example.com', '', 0, 0, null)");
    expect(_updated(sql)).toEqual(["unlimited", "may_veto", "max_daily_goal"]);
  });

  test("a new row still gets the defaults", async () => {
    const cap = capture();
    const sql = await _sql(cap, "new@example.com", "--note", "new");
    expect(sql).toContain("values ('new@example.com', 'new', 0, 0, null)");
  });

  test("contradicting the day is refused", async () => {
    capture();
    expect(await cli.main({ argv: ["tester", "a@example.com", "--max-goal", "60", "--no-max-goal"] })).toBe(2);
  });
});
