/**
 * Every Worker query, run as a tester against the schema — the check that the
 * app and the database still agree, now that the app's queries live here.
 *
 * Not part of `npm test`: it needs the throwaway Postgres that
 * supabase/test/run.sh builds (every migration, every published bundle) and
 * is run by that script, which sets BJT_WORKER_DB_TEST. Each query goes
 * through `asCaller` exactly as a request does — `set local role
 * authenticated` and the caller's claims — so a column that does not exist, a
 * write the signed-in role may not make, a policy that hides what it should
 * show or shows what it should hide, fails here. A query with no case below
 * fails the last test: a new query is a new thing to prove.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asCaller } from "./db";
import { claimsFor, type Caller } from "./identity";
import { queries } from "./queries";

declare const process: { env: Record<string, string | undefined> };

const enabled = Boolean(process.env.BJT_WORKER_DB_TEST);

function connect() {
  const host = process.env.PGHOST ?? "localhost";
  const port = Number(process.env.PGPORT ?? 5432);
  const options = {
    database: process.env.BJT_TEST_DB ?? "bjt_schema_test",
    username: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD,
    max: 1,
    fetch_types: false,
    onnotice: () => {},
  };
  // run.sh's own cluster listens on a socket directory, not a port.
  return host.startsWith("/")
    ? postgres({ ...options, path: `${host}/.s.PGSQL.${port}` })
    : postgres({ ...options, host, port });
}

describe.runIf(enabled)("every Worker query, as a tester", () => {
  const sql = connect();
  const covered = new Set<string>();
  const stamp = Date.now();
  const learner: Caller = { userId: crypto.randomUUID(), email: `worker-${stamp}@example.com` };
  const other: Caller = { userId: crypto.randomUUID(), email: `worker-other-${stamp}@example.com` };
  const stranger: Caller = { userId: crypto.randomUUID(), email: `worker-stranger-${stamp}@example.com` };
  let first: { id: string; correct_index: number };
  let second: { id: string; correct_index: number };

  async function run<T = unknown>(name: string, args: Record<string, unknown> = {}, as: Caller = learner): Promise<T> {
    covered.add(name);
    return (await asCaller(sql, claimsFor(as), (tx) => queries[name](tx, args))) as T;
  }

  beforeAll(async () => {
    for (const c of [learner, other]) {
      await sql`insert into public.testers (email, note) values (${c.email}, 'worker query test')`;
    }
    for (const c of [learner, other, stranger]) {
      await sql`insert into auth.users (id, email) values (${c.userId}, ${c.email})`;
    }
    // A reading type: served without audio or a picture, so nothing about
    // media can keep it from being answered.
    const items = await sql<{ id: string; correct_index: number }[]>`
      select id, correct_index from public.items
      where is_published and item_type = 'goi_bunpou'
      order by id limit 2`;
    expect(items.length).toBe(2);
    [first, second] = items;
  });

  afterAll(async () => {
    await sql.end();
  });

  it("knows who may come in", async () => {
    expect(await run("whoami")).toEqual({ user_id: learner.userId, email: learner.email, is_tester: true });
    expect(await run("whoami", {}, stranger)).toMatchObject({ user_id: stranger.userId, is_tester: false });
  });

  it("reads and writes the learner's own row, in the shapes the app expects", async () => {
    const profile = await run<{ id: string; daily_goal: number }>("profile");
    expect(profile.id).toBe(learner.userId);
    await run("updateProfile", { patch: { display_name: "テスト", timed_reading: true, exam_date: "2026-12-01" } });
    const after = await run<{ display_name: string; timed_reading: boolean; exam_date: string }>("profile");
    expect(after).toMatchObject({ display_name: "テスト", timed_reading: true, exam_date: "2026-12-01" });
    // A goal is the owner's account's to choose; the trigger says no here.
    await expect(run("updateProfile", { patch: { daily_goal: 12 } })).rejects.toBeTruthy();
    // target_level is the database's; the Worker refuses to send it at all.
    await expect(run("updateProfile", { patch: { target_level: "J1" } })).rejects.toMatchObject({
      error: { code: "invalid_argument" },
    });
    const day = await run<{ goal: number; left_today: number }>("day");
    expect(day.goal).toBe(profile.daily_goal);
    expect(await run("hasAdFree")).toBe(false);
  });

  it("serves a set and grades an answer in the database", async () => {
    const set = await run<{ id: string }[]>("nextItems", { limit: 5 });
    expect(set.length).toBeGreaterThan(0);
    const pace = await run<{ id: string; seconds_per_item: number }[]>("pace");
    expect(pace.length).toBe(3);
    expect(Array.isArray(await run("optionLabels", { voice: "narrator_f", texts: ["いち", "に", "さん", "よん"] }))).toBe(true);

    const session = await run<{ id: string }>("startSession");
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    const right = await run<{ is_correct: boolean; chosen_role: string }>("recordAttempt", {
      itemId: first.id,
      chosenIndex: first.correct_index,
      sessionId: session.id,
      elapsedMs: 1234,
      thinkMs: null,
      replays: 0,
      peeked: false,
      standsFor: null,
    });
    expect(right).toEqual({ is_correct: true, chosen_role: "correct" });
    const wrong = await run<{ is_correct: boolean }>("recordAttempt", {
      itemId: second.id,
      chosenIndex: (second.correct_index + 1) % 4,
      sessionId: session.id,
      elapsedMs: 2345,
      thinkMs: 2000,
      replays: 1,
      peeked: false,
      standsFor: null,
    });
    expect(wrong.is_correct).toBe(false);
    await run("finishSession", { sessionId: session.id });

    const found = await run<{ elapsed_ms: number }[]>("findAttempt", {
      itemId: first.id,
      chosenIndex: first.correct_index,
      replays: 0,
    });
    expect(found[0]?.elapsed_ms).toBe(1234);
    expect(await run<{ elapsed_ms: number }[]>("recentPace", { limit: 10 })).toEqual([
      { elapsed_ms: 2345 },
      { elapsed_ms: 1234 },
    ]);
  });

  it("reads the record back, and only this learner's", async () => {
    const history = await run<{ attempts: unknown[]; items: unknown[]; options: unknown[]; types: unknown[] }>(
      "history",
      { limit: 50 }
    );
    expect(history.attempts.length).toBe(2);
    expect(history.items.length).toBe(2);
    expect(history.options.length).toBe(8);
    expect(history.types.length).toBe(10);
    const one = await run<{ attempts: { item_id: string }[] }>("history", { limit: 50, itemId: first.id });
    expect(one.attempts.map((a) => a.item_id)).toEqual([first.id]);
    // The claims are what scope it: another tester sees none of it.
    expect((await run<{ attempts: unknown[] }>("history", { limit: 50 }, other)).attempts).toEqual([]);
    // And somebody who is not a tester sees nothing at all.
    expect((await run<unknown[]>("nextItems", { limit: 5 }, stranger)).length).toBe(0);

    const detail = await run<{ item: { stem: string }; options: unknown[]; clips: unknown[] }>("itemDetail", {
      itemId: first.id,
    });
    expect(detail.item.stem.length).toBeGreaterThan(0);
    expect(detail.options.length).toBe(4);

    const vocab = await run<{ attempts: { item_id: string }[] }>("vocab", { limit: 200 });
    expect(vocab.attempts.map((a) => a.item_id)).toEqual([second.id]);
    const words = await run<{ items: unknown[]; correct: unknown[]; types: unknown[] }>("wordList");
    expect(words.items.length).toBe(2);
    expect(words.correct.length).toBe(2);

    expect((await run<unknown[]>("sectionLevels")).length).toBe(3);
    expect((await run<unknown[]>("typeStats")).length).toBeGreaterThan(0);
    expect(Array.isArray(await run("tagStats"))).toBe(true);
    expect(Array.isArray(await run("roleTraps"))).toBe(true);
    expect(await run("reviewLoad")).toHaveProperty("due_now");
    expect(typeof (await run("streak"))).toBe("number");
  });

  it("keeps the learner's notes and reports, and refuses a veto it may not make", async () => {
    await run("saveNote", { itemId: second.id, note: "  丁寧すぎた  " });
    expect(await run("notes", { itemIds: [second.id, first.id] })).toEqual([{ item_id: second.id, note: "丁寧すぎた" }]);
    await run("saveNote", { itemId: second.id, note: "" });
    expect(await run("notes", { itemIds: [second.id] })).toEqual([]);

    await run("reportItem", { itemId: first.id, reason: "unclear", note: "first" });
    await run("reportItem", { itemId: first.id, reason: "ambiguous", note: "second" });
    const reports = await sql`select reason, note from public.item_feedback
                              where item_id = ${first.id} and user_id = ${learner.userId}`;
    expect(reports.map((r) => ({ ...r }))).toEqual([{ reason: "ambiguous", note: "second" }]);
    await expect(run("reportItem", { itemId: first.id, reason: "boring" })).rejects.toMatchObject({
      error: { code: "invalid_argument" },
    });

    expect(await run("mayVeto")).toBe(false);
    await expect(run("vetoItem", { itemId: first.id, note: "" })).rejects.toMatchObject({
      message: expect.stringMatching(/may not veto/),
    });
  });

  it("starts again only from nothing", async () => {
    const counts = await run<{ attempts: number }>("resetProgress");
    expect(counts.attempts).toBe(2);
    expect((await run<{ attempts: unknown[] }>("history", { limit: 50 })).attempts).toEqual([]);
  });

  it("has a case for every query", () => {
    expect(Object.keys(queries).filter((name) => !covered.has(name))).toEqual([]);
  });
});
