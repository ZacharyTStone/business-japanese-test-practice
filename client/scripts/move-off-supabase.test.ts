import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { attemptTriggers, buildMoveSql, lit, r2Credential, ts, type Export } from "./move-off-supabase.mts";

const MIGRATION = readFileSync(resolve(__dirname, "../../d1/triggers.sql"), "utf8");
const ME = "6F1C2C1E-6F0A-4A77-9D1E-2B8F6C3A9E10";
const me = ME.toLowerCase();

function exported(over: Partial<Export> = {}): Export {
  return {
    users: [
      { id: ME, email: "Me@Example.com", created_at: new Date("2026-09-01T00:00:00Z") },
      { id: "00000000-0000-4000-8000-000000000001", email: null, created_at: new Date() }, // anonymous
    ],
    testers: [{ email: "me@example.com", note: "owner", added_at: new Date("2026-09-01T00:00:00Z"), unlimited: false, may_veto: true, max_daily_goal: 60 }],
    profiles: [
      {
        id: ME,
        display_name: "ザック",
        target_level: "J2",
        daily_goal: 20,
        exam_date: "2026-12-06",
        timed_reading: true,
        level_changed_at: new Date("2026-09-02T00:00:00Z"),
        created_at: new Date("2026-09-01T00:00:00Z"),
        updated_at: new Date("2026-09-03T00:00:00Z"),
      },
    ],
    practice_sessions: [],
    attempts: [
      {
        id: "41",
        user_id: ME,
        session_id: null,
        item_id: "known1",
        chosen_index: 2,
        is_correct: true,
        chosen_role: "correct",
        elapsed_ms: 1234,
        answered_at: "2026-09-20T03:04:05.123456+00:00",
        think_ms: null,
        replays: 0,
        peeked: false,
        stands_for: null,
      },
      { id: "42", user_id: ME, session_id: null, item_id: "gone-from-the-bank", chosen_index: 0, is_correct: false, chosen_role: "x", answered_at: new Date() },
      { id: "43", user_id: "00000000-0000-4000-8000-000000000001", item_id: "known1", chosen_index: 0, is_correct: false, chosen_role: "x", answered_at: new Date() },
    ],
    review_schedule: [],
    review_notes: [],
    section_levels: [],
    entitlements: [],
    item_feedback: [],
    item_vetoes: [],
    item_stats: [],
    audio_clips: [{ id: "clip1", audio_path: "openai/ab/clip1.wav", duration_ms: 2100 }],
    scenes: [],
    unpublished: [{ id: "known2" }, { id: "gone-from-the-bank" }],
    ...over,
  };
}

describe("the move off Supabase", () => {
  it("lifts the answer triggers for the history and puts them back word for word", () => {
    const triggers = attemptTriggers(MIGRATION);
    expect(triggers.map((t) => t.name).sort()).toEqual(["attempts_daily_ceiling", "attempts_need_a_live_question"]);
    const { sql } = buildMoveSql(exported(), new Set(["known1", "known2"]), MIGRATION);
    for (const t of triggers) {
      expect(sql.indexOf(`drop trigger if exists ${t.name};`)).toBeLessThan(sql.indexOf("insert into attempts"));
      expect(sql.lastIndexOf(t.sql)).toBeGreaterThan(sql.lastIndexOf("insert into attempts"));
    }
  });

  it("keeps the account's own id, lower-cases its address, and leaves anonymous accounts behind", () => {
    const { sql, counts, skipped } = buildMoveSql(exported(), new Set(["known1", "known2"]), MIGRATION);
    expect(counts.users).toBe(1);
    expect(sql).toContain(`insert into users (id, email, created_at) values ('${me}', 'me@example.com', '2026-09-01T00:00:00.000Z')`);
    // An account made by signing in before the move gives way to the old id.
    expect(sql).toContain(`delete from users where email = 'me@example.com' and id <> '${me}';`);
    expect(skipped.attempts).toBe(2); // the anonymous account's, and one about a question not in the bank
  });

  it("writes rows as D1 keeps them: 1/0, UTC to the millisecond, dates as dates", () => {
    const { sql } = buildMoveSql(exported(), new Set(["known1", "known2"]), MIGRATION);
    expect(sql).toContain(`values (41, '${me}', null, 'known1', 2, 1, 'correct', 1234, '2026-09-20T03:04:05.123Z', null, 0, 0, null) on conflict (id) do nothing;`);
    expect(sql).toContain("'2026-12-06'");
    expect(sql).toMatch(/insert into testers .* values \('me@example\.com', 'owner', '2026-09-01T00:00:00\.000Z', 0, 1, 60\)/);
  });

  it("points clips only where nothing is live, and never publishes anything again", () => {
    const { sql } = buildMoveSql(exported(), new Set(["known1", "known2"]), MIGRATION);
    expect(sql).toContain("update audio_clips set audio_path = 'openai/ab/clip1.wav', duration_ms = 2100 where id = 'clip1' and audio_path is null;");
    expect(sql).toContain("update items set is_published = 0 where id in ('known2');");
    expect(sql).not.toMatch(/set is_published = 1/);
  });

  it("quotes what it is given as data", () => {
    expect(lit("o'brien")).toBe("'o''brien'");
    expect(lit(true)).toBe("1");
    expect(lit(null)).toBe("null");
    expect(() => lit(Number.NaN)).toThrow();
    expect(() => lit("a\0b")).toThrow();
    expect(ts("2026-09-20 12:00:00+09")).toBe("2026-09-20T03:00:00.000Z");
    expect(ts(null)).toBeNull();
  });

  it("says which R2 key field was pasted wrong, by its length, never its value", () => {
    expect(r2Credential("R2_ACCESS_KEY_ID", "a".repeat(32))).toBe("a".repeat(32));
    expect(r2Credential("R2_SECRET_ACCESS_KEY", "0f".repeat(32))).toBe("0f".repeat(32));
    // The token value (a different, longer non-hex string) in the secret's place.
    const tokenValue = "Xy_" + "k".repeat(37);
    expect(() => r2Credential("R2_SECRET_ACCESS_KEY", tokenValue)).toThrow(/40 characters, not all hexadecimal.*Secret Access Key is 64/);
    expect(() => r2Credential("R2_SECRET_ACCESS_KEY", tokenValue)).not.toThrow(new RegExp(tokenValue));
    expect(() => r2Credential("R2_ACCESS_KEY_ID", "a".repeat(64))).toThrow(/64 characters; an R2 Access Key ID is 32/);
  });
});
