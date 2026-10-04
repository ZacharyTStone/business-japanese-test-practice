/**
 * Every Worker query, run as a tester against a real local D1 with the whole
 * published bank — the check that the app and the database still agree.
 *
 * Each call goes through `runQuery` exactly as a request does after the
 * sign-in (index.ts), with no sign-in to check (`checkSignIn: false`;
 * test/auth.db.test.ts has that half): the address is resolved to an account,
 * a caller not on the tester list is refused, and the query runs as that
 * learner. So a column that
 * does not exist, a write the schema refuses, or a learner seeing another's
 * rows, fails here. A query with no case below fails the last test: a new
 * query is a new thing to prove.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runQuery } from "../index";
import { queries } from "../queries";
import { addTester, address, openBank, type Bank } from "./d1";

describe("every Worker query, as a tester", () => {
  let bank: Bank;
  const covered = new Set<string>();
  const learner = address("worker");
  const other = address("worker-other");
  const stranger = address("worker-stranger");
  let first: { id: string; correct_index: number };
  let second: { id: string; correct_index: number };

  async function run<T = unknown>(name: string, args: Record<string, unknown> = {}, as = learner): Promise<T> {
    covered.add(name);
    const res = await runQuery(bank.db, as, name, args, { checkSignIn: false });
    const body = (await res.json()) as { data?: T; error?: unknown };
    if (body.error) throw { status: res.status, error: body.error };
    return body.data as T;
  }

  beforeAll(async () => {
    bank = await openBank();
    await addTester(bank.db, learner);
    await addTester(bank.db, other);
    // A reading type: served without audio or a picture, so nothing about
    // media can keep it from being answered.
    const { results } = await bank.db
      .prepare("select id, correct_index from items where is_published = 1 and item_type = 'goi_bunpou' order by id limit 2")
      .all<{ id: string; correct_index: number }>();
    expect(results.length).toBe(2);
    [first, second] = results;
  });

  afterAll(async () => {
    await bank.dispose();
  });

  it("knows who may come in, and makes no account for anybody else", async () => {
    const me = await run<{ user_id: string; email: string; is_tester: boolean }>("whoami");
    expect(me).toMatchObject({ email: learner, is_tester: true });
    expect(me.user_id).toMatch(/^[0-9a-f-]{36}$/);
    // The same account every time, whatever case the address arrives in.
    expect(await run("whoami", {}, learner.toUpperCase())).toEqual(me);

    await expect(run("whoami", {}, stranger)).rejects.toMatchObject({
      status: 403,
      error: { code: "not_a_tester", details: stranger },
    });
    await expect(run("nextItems", { limit: 5 }, stranger)).rejects.toMatchObject({ status: 403 });
    const made = await bank.db.prepare("select count(*) as n from users where email = ?").bind(stranger).first<{ n: number }>();
    expect(made?.n).toBe(0);
  });

  it("refuses a query that does not exist", async () => {
    const res = await runQuery(bank.db, learner, "dropEverything", {}, { checkSignIn: false });
    expect(res.status).toBe(404);
  });

  it("reads and writes the learner's own row, in the shapes the app expects", async () => {
    const profile = await run<{ id: string; daily_goal: number; target_level: string; timed_reading: boolean }>("profile");
    expect(profile).toMatchObject({ daily_goal: 10, target_level: "J2", timed_reading: true });
    await run("updateProfile", { patch: { display_name: "テスト", timed_reading: false, exam_date: "2026-12-01" } });
    const after = await run<{ display_name: string; timed_reading: boolean; exam_date: string }>("profile");
    expect(after).toMatchObject({ display_name: "テスト", timed_reading: false, exam_date: "2026-12-01" });
    // The same goal again is not a change, and is let through.
    await run("updateProfile", { patch: { daily_goal: 10 } });
    // A different one is the owner's account's to choose, not this one's.
    await expect(run("updateProfile", { patch: { daily_goal: 12 } })).rejects.toMatchObject({ error: { code: "42501" } });
    // target_level is the database's; the Worker refuses to send it at all.
    await expect(run("updateProfile", { patch: { target_level: "J1" } })).rejects.toMatchObject({
      error: { code: "invalid_argument" },
    });
    await expect(run("updateProfile", { patch: { exam_date: "soon" } })).rejects.toMatchObject({
      error: { code: "invalid_argument" },
    });
    const day = await run<{ goal: number; left_today: number; max_today: number; goal_max: number | null }>("day");
    expect(day).toMatchObject({ goal: 10, max_today: 15, left_today: 15, goal_max: null });
    expect(await run("hasAdFree")).toBe(false);
  });

  it("serves a set and grades an answer in the database", async () => {
    const set = await run<{ id: string; options: unknown[] }[]>("nextItems", { limit: 5 });
    expect(set.length).toBeGreaterThan(0);
    expect(set[0].options.length).toBe(4);
    const pace = await run<{ id: string; seconds_per_item: number }[]>("pace");
    expect(pace.length).toBe(3);
    expect(Array.isArray(await run("optionLabels", { voice: "narrator_f", texts: ["いち", "に", "さん", "よん"] }))).toBe(true);
    expect(await run("optionLabels", { voice: "narrator_f", texts: [] })).toEqual([]);

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
    const wrong = await run<{ is_correct: boolean; chosen_role: string }>("recordAttempt", {
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
    expect(wrong.chosen_role).not.toBe("correct");
    await run("finishSession", { sessionId: session.id });

    // An option the question does not have, and a question not in the bank.
    await expect(
      run("recordAttempt", { itemId: first.id, chosenIndex: 7, replays: 0, peeked: false })
    ).rejects.toMatchObject({ error: { code: "P0001" } });
    await expect(
      run("recordAttempt", { itemId: "no-such-item", chosenIndex: 0, replays: 0, peeked: false })
    ).rejects.toMatchObject({ error: { hint: "item_unavailable" } });

    const found = await run<{ elapsed_ms: number; is_correct: boolean }[]>("findAttempt", {
      itemId: first.id,
      chosenIndex: first.correct_index,
      replays: 0,
    });
    expect(found).toMatchObject([{ elapsed_ms: 1234, is_correct: true }]);
    expect(await run<{ elapsed_ms: number }[]>("recentPace", { limit: 10 })).toEqual([
      { elapsed_ms: 2345 },
      { elapsed_ms: 1234 },
    ]);
  });

  it("reads the record back, and only this learner's", async () => {
    const history = await run<{ attempts: { is_correct: boolean }[]; items: unknown[]; options: unknown[]; types: unknown[] }>(
      "history",
      { limit: 50 }
    );
    expect(history.attempts.length).toBe(2);
    expect(typeof history.attempts[0].is_correct).toBe("boolean");
    expect(history.items.length).toBe(2);
    expect(history.options.length).toBe(8);
    expect(history.types.length).toBe(10);
    const one = await run<{ attempts: { item_id: string }[] }>("history", { limit: 50, itemId: first.id });
    expect(one.attempts.map((a) => a.item_id)).toEqual([first.id]);
    // Another tester sees none of it.
    expect((await run<{ attempts: unknown[] }>("history", { limit: 50 }, other)).attempts).toEqual([]);
    expect(await run("findAttempt", { itemId: first.id, chosenIndex: first.correct_index, replays: 0 }, other)).toEqual([]);

    const detail = await run<{ item: { stem: string; documents: unknown[] }; options: unknown[]; clips: unknown[] }>("itemDetail", {
      itemId: first.id,
    });
    expect(detail.item.stem.length).toBeGreaterThan(0);
    expect(Array.isArray(detail.item.documents)).toBe(true);
    expect(detail.options.length).toBe(4);

    const vocab = await run<{ attempts: { item_id: string }[] }>("vocab", { limit: 200 });
    expect(vocab.attempts.map((a) => a.item_id)).toEqual([second.id]);
    const words = await run<{ items: unknown[]; correct: unknown[]; types: unknown[] }>("wordList");
    expect(words.items.length).toBe(2);
    expect(words.correct.length).toBe(2);

    const levels = await run<{ section: string; level: string; placed: boolean }[]>("sectionLevels");
    expect(levels.map((l) => l.section).sort()).toEqual(["choudokkai", "choukai", "dokkai"]);
    expect((await run<unknown[]>("typeStats")).length).toBeGreaterThan(0);
    expect(Array.isArray(await run("tagStats"))).toBe(true);
    expect((await run<{ role: string }[]>("roleTraps")).length).toBe(1);
    expect(await run("reviewLoad")).toMatchObject({ due_now: 0, tracked: 2 });
    expect(await run("streak")).toBe(1);
    expect(await run("day")).toMatchObject({ answered_today: 2, left_today: 13 });
  });

  it("keeps the learner's notes and reports, and refuses a veto it may not make", async () => {
    await run("saveNote", { itemId: second.id, note: "  丁寧すぎた  " });
    expect(await run("notes", { itemIds: [second.id, first.id] })).toEqual([{ item_id: second.id, note: "丁寧すぎた" }]);
    expect(await run("notes", { itemIds: [second.id] }, other)).toEqual([]);
    await run("saveNote", { itemId: second.id, note: "" });
    expect(await run("notes", { itemIds: [second.id] })).toEqual([]);

    await run("reportItem", { itemId: first.id, reason: "unclear", note: "first" });
    await run("reportItem", { itemId: first.id, reason: "ambiguous", note: "second" });
    const { results: reports } = await bank.db
      .prepare("select f.reason, f.note from item_feedback f join users u on u.id = f.user_id where f.item_id = ? and u.email = ?")
      .bind(first.id, learner)
      .all();
    expect(reports).toEqual([{ reason: "ambiguous", note: "second" }]);
    await expect(run("reportItem", { itemId: first.id, reason: "boring" })).rejects.toMatchObject({
      error: { code: "invalid_argument" },
    });

    expect(await run("mayVeto")).toBe(false);
    await expect(run("vetoItem", { itemId: first.id, note: "" })).rejects.toMatchObject({
      error: { message: expect.stringMatching(/may not veto/) },
    });
  });

  it("starts again only from nothing", async () => {
    const counts = await run<{ attempts: number; sessions: number; levels: number }>("resetProgress");
    expect(counts).toMatchObject({ attempts: 2, sessions: 1, levels: 3 });
    expect((await run<{ attempts: unknown[] }>("history", { limit: 50 })).attempts).toEqual([]);
    // Settings are not progress.
    expect(await run("profile")).toMatchObject({ display_name: "テスト", target_level: "J2" });
  });

  it("deletes an account and everything about it, and nobody else's", async () => {
    const leaving = address("worker-leaving");
    await addTester(bank.db, leaving);
    // Answers inside a session, a note and a report: what cascades, and the
    // answer-to-session link that must go before its session does.
    const me = await run<{ user_id: string }>("whoami", {}, leaving);
    const session = await run<{ id: string }>("startSession", {}, leaving);
    for (const [it, chosen] of [[first, first.correct_index], [second, (second.correct_index + 1) % 4]] as const) {
      await run("recordAttempt", { itemId: it.id, chosenIndex: chosen, sessionId: session.id, elapsedMs: 1000, thinkMs: null, replays: 0, peeked: false, standsFor: null }, leaving);
    }
    await run("saveNote", { itemId: second.id, note: "敬語" }, leaving);
    await run("reportItem", { itemId: first.id, reason: "unclear", note: "" }, leaving);
    const otherBefore = (await run<{ attempts: unknown[] }>("history", { limit: 50 }, other)).attempts.length;

    // The address on the screen must be this account's.
    await expect(run("deleteAccount", { email: other }, leaving)).rejects.toMatchObject({ error: { code: "invalid_argument" } });
    expect((await run<{ attempts: unknown[] }>("history", { limit: 50 }, leaving)).attempts.length).toBe(2);

    expect(await run("deleteAccount", { email: leaving.toUpperCase() }, leaving)).toEqual({ attempts: 2, deleted: true });
    for (const table of ["attempts", "practice_sessions", "review_schedule", "review_notes", "section_levels", "item_feedback"]) {
      const left = await bank.db.prepare(`select count(*) as n from ${table} where user_id = ?`).bind(me.user_id).first<{ n: number }>();
      expect(left?.n, table).toBe(0);
    }
    for (const table of ["users", "profiles"]) {
      const left = await bank.db.prepare(`select count(*) as n from ${table} where id = ?`).bind(me.user_id).first<{ n: number }>();
      expect(left?.n, table).toBe(0);
    }
    expect((await run<{ attempts: unknown[] }>("history", { limit: 50 }, other)).attempts.length).toBe(otherBefore);
    // Still listed, so the address may come back: to a new, empty account.
    const again = await run<{ user_id: string }>("whoami", {}, leaving);
    expect(again.user_id).not.toBe(me.user_id);
    expect((await run<{ attempts: unknown[] }>("history", { limit: 50 }, leaving)).attempts).toEqual([]);
  });

  it("has a case for every query", () => {
    expect(Object.keys(queries).filter((name) => !covered.has(name))).toEqual([]);
  });
});
