/**
 * What the schema and the logic beside it promise, against a local D1 with the
 * whole published bank. The queue's ranking, the grading, the spacing ladder
 * and the per-section levels were checked step by step against the Postgres
 * functions they replace before the move; what is held here is what must not
 * quietly stop being true: the day's ceiling, an answer that cannot be
 * changed, a question that cannot be deleted, a veto, starting again, and the
 * arithmetic the exam's shape rests on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveLearner, type Learner } from "../core/caller";
import { toApiError } from "../core/errors";
import { recordAttempt, type AttemptArgs } from "../core/grade";
import * as bank from "../core/bank";
import * as profile from "../core/profile";
import { nextItems } from "../core/queue";
import * as record from "../core/record";
import { addTester, address, openBank, type Bank } from "./d1";

describe("the schema's promises", () => {
  let b: Bank;
  let db: D1Database;
  let reading: { id: string; correct_index: number };
  let others: { id: string; correct_index: number }[];

  async function learner(opts: Parameters<typeof addTester>[2] = {}): Promise<Learner> {
    const email = address("schema");
    await addTester(db, email, opts);
    return resolveLearner(db, email, { checkSignIn: false });
  }

  function answer(l: Learner, itemId: string, chosenIndex: number, now = Date.now(), extra: Partial<AttemptArgs> = {}) {
    return recordAttempt(
      db,
      l,
      { itemId, chosenIndex, sessionId: null, elapsedMs: 5000, thinkMs: 4000, replays: 0, peeked: false, standsFor: null, ...extra },
      now
    );
  }

  /** How the app would see a refusal: the error after the Worker's mapping. */
  async function refusal(p: Promise<unknown>) {
    try {
      await p;
    } catch (e) {
      return toApiError(e).error;
    }
    throw new Error("expected a refusal");
  }

  async function count(sql: string, ...params: unknown[]): Promise<number> {
    return (await db.prepare(sql).bind(...params).first<{ n: number }>())!.n;
  }

  beforeAll(async () => {
    b = await openBank();
    db = b.db;
    const { results } = await db
      .prepare("select id, correct_index from items where is_published = 1 and item_type = 'goi_bunpou' order by id")
      .all<{ id: string; correct_index: number }>();
    [reading, ...others] = results;
    expect(others.length).toBeGreaterThan(3);
  });

  afterAll(async () => {
    await b.dispose();
  });

  // --- the shape of the exam -------------------------------------------------

  it("divides the 30-minute reading block exactly among its 30 questions", async () => {
    const { results } = await db.prepare("select id, section, seconds_per_item, exam_questions from item_types").all<{
      id: string;
      section: string;
      seconds_per_item: number | null;
      exam_questions: number;
    }>();
    const reading = results.filter((t) => t.seconds_per_item !== null);
    expect(reading.map((t) => t.id).sort()).toEqual(["goi_bunpou", "hyougen", "sougou_dokkai"]);
    expect(reading.reduce((s, t) => s + t.seconds_per_item! * 10, 0)).toBe(1800);
    expect(results.filter((t) => t.section === "dokkai").reduce((n, t) => n + t.exam_questions, 0)).toBe(30);
  });

  // --- grading is the database's ---------------------------------------------

  it("grades an answer from the item, and a timeout as wrong", async () => {
    const l = await learner({ unlimited: true });
    expect(await answer(l, reading.id, reading.correct_index)).toEqual({ is_correct: true, chosen_role: "correct" });
    expect(await answer(l, reading.id, -1)).toEqual({ is_correct: false, chosen_role: "timed_out" });
    // A row written around the logic with a grade of its own is refused.
    const wrong = (reading.correct_index + 1) % 4;
    const raw = (isCorrect: number, role: string) =>
      db
        .prepare(
          `insert into attempts (user_id, item_id, chosen_index, is_correct, chosen_role, answered_at)
           values (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
        )
        .bind(l.userId, reading.id, wrong, isCorrect, role)
        .run();
    await expect(raw(1, "correct")).rejects.toThrow(/graded_wrongly/);
    const role = (await db.prepare("select role from item_options where item_id = ? and position = ?").bind(reading.id, wrong).first<{ role: string }>())!.role;
    await expect(raw(0, "correct")).rejects.toThrow(/graded_wrongly/);
    await raw(0, role);
    expect(await count("select count(*) as n from attempts where user_id = ?", l.userId)).toBe(3);
  });

  it("never changes an answer once given", async () => {
    const l = await learner({ unlimited: true });
    await answer(l, reading.id, (reading.correct_index + 1) % 4);
    await expect(db.prepare("update attempts set is_correct = 1 where user_id = ?").bind(l.userId).run()).rejects.toThrow(
      /cannot be changed/
    );
  });

  it("refuses an answer to a question that is not in the bank, or an option it does not have", async () => {
    const l = await learner({ unlimited: true });
    const { id: withdrawn } = (await db.prepare("select id from items where is_published = 0 limit 1").first<{ id: string }>())!;
    await expect(answer(l, withdrawn, 0)).rejects.toMatchObject({ error: { hint: "item_unavailable" } });
    await expect(answer(l, reading.id, 4)).rejects.toMatchObject({ error: { message: /no such option/ } });
    // And the schema says the same to a write that skips the logic.
    await expect(
      db
        .prepare("insert into attempts (user_id, item_id, chosen_index, is_correct, chosen_role, answered_at) values (?, ?, 0, 0, 'x', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))")
        .bind(l.userId, withdrawn)
        .run()
    ).rejects.toThrow(/item_unavailable/);
  });

  // --- the day ----------------------------------------------------------------

  it("stops the day at fifteen, in the database", async () => {
    const l = await learner();
    for (let i = 0; i < 15; i++) await answer(l, reading.id, reading.correct_index);
    expect(await nextItems(db, l, 10, Date.now())).toEqual([]);
    expect(await record.day(db, l, Date.now())).toMatchObject({ answered_today: 15, left_today: 0, max_today: 15 });
    expect(await refusal(answer(l, reading.id, reading.correct_index))).toMatchObject({ code: "P0001", hint: "daily_limit_reached" });
    expect(await count("select count(*) as n from attempts where user_id = ?", l.userId)).toBe(15);
    // Nothing else the refused answer would have moved has moved.
    expect(await count("select count(*) as n from review_schedule where user_id = ?", l.userId)).toBe(1);
  });

  it("counts the day in Japan, from the answer's own time", async () => {
    const l = await learner();
    const lastMinute = Date.parse("2026-09-10T14:59:00.000Z"); // 23:59 in Tokyo
    for (let i = 0; i < 15; i++) await answer(l, reading.id, reading.correct_index, lastMinute + i * 1000);
    expect(await refusal(answer(l, reading.id, reading.correct_index, lastMinute + 30_000))).toMatchObject({ hint: "daily_limit_reached" });
    // Midnight in Tokyo: a new day, whatever the database's own clock says.
    const midnight = Date.parse("2026-09-10T15:00:00.000Z");
    expect(await answer(l, reading.id, reading.correct_index, midnight)).toMatchObject({ is_correct: true });
    expect(await record.day(db, l, midnight + 1000)).toMatchObject({ answered_today: 1, left_today: 14 });
  });

  it("lifts the ceiling for an unlimited tester, and sizes one account's own day", async () => {
    const free = await learner({ unlimited: true });
    for (let i = 0; i < 16; i++) await answer(free, reading.id, reading.correct_index);
    expect((await nextItems(db, free, 5, Date.now())).length).toBeGreaterThan(0);

    const owner = await learner({ maxDailyGoal: 18 });
    expect(await record.day(db, owner, Date.now())).toMatchObject({ max_today: 18, goal_max: 18 });
    for (let i = 0; i < 18; i++) await answer(owner, reading.id, reading.correct_index);
    expect(await refusal(answer(owner, reading.id, reading.correct_index))).toMatchObject({ hint: "daily_limit_reached" });
  });

  it("lets only the account with its own ceiling choose the size of its day", async () => {
    const l = await learner();
    await expect(profile.updateProfile(db, l, { daily_goal: 12 }, Date.now())).rejects.toMatchObject({ error: { code: "42501" } });
    await profile.updateProfile(db, l, { daily_goal: 10, display_name: "x" }, Date.now());

    const owner = await learner({ maxDailyGoal: 60 });
    await profile.updateProfile(db, owner, { daily_goal: 40 }, Date.now());
    expect(await profile.profile(db, owner)).toMatchObject({ daily_goal: 40 });
    await expect(profile.updateProfile(db, owner, { daily_goal: 61 }, Date.now())).rejects.toMatchObject({ error: { code: "P0001" } });
    // A day of at least one question, whoever asks.
    await expect(db.prepare("update profiles set daily_goal = 0 where id = ?").bind(owner.userId).run()).rejects.toThrow();
  });

  it("asks for no more than the day has left", async () => {
    const l = await learner();
    for (let i = 0; i < 12; i++) await answer(l, reading.id, reading.correct_index);
    expect((await nextItems(db, l, 10, Date.now())).length).toBe(3);
  });

  // --- the door ---------------------------------------------------------------

  it("makes no account for an address that is not on the list, and closes the door on one taken off it", async () => {
    const stranger = await resolveLearner(db, address("stranger"), { checkSignIn: false });
    expect(stranger).toMatchObject({ userId: null, isTester: false });
    expect(await count("select count(*) as n from users where email = ?", stranger.email)).toBe(0);

    const l = await learner();
    await db.prepare("delete from testers where email = ?").bind(l.email).run();
    const again = await resolveLearner(db, l.email, { checkSignIn: false });
    expect(again).toMatchObject({ userId: l.userId, isTester: false });
  });

  // --- a question leaves the bank by being unpublished ---------------------------

  it("refuses to delete a question anybody has answered, or a bundle that holds questions", async () => {
    const l = await learner({ unlimited: true });
    await answer(l, others[0].id, others[0].correct_index);
    await expect(db.prepare("delete from items where id = ?").bind(others[0].id).run()).rejects.toThrow(/FOREIGN KEY/i);
    await expect(db.prepare("delete from bundles where id = (select bundle_id from items where id = ?)").bind(others[0].id).run()).rejects.toThrow(
      /FOREIGN KEY/i
    );
  });

  it("lets only the owner veto, for everybody at once, and keeps the answers resolving", async () => {
    const target = others[1];
    const ordinary = await learner({ unlimited: true });
    await answer(ordinary, target.id, target.correct_index);
    expect(bank.mayVeto(ordinary)).toBe(false);
    await expect(bank.vetoItem(db, ordinary, target.id, "", Date.now())).rejects.toMatchObject({ error: { message: /may not veto/ } });

    const owner = await learner({ mayVeto: true });
    expect(bank.mayVeto(owner)).toBe(true);
    await bank.vetoItem(db, owner, target.id, "unnatural", Date.now());
    expect(await count("select is_published as n from items where id = ?", target.id)).toBe(0);
    expect(await count("select count(*) as n from item_vetoes where item_id = ?", target.id)).toBe(1);
    // Gone for everybody: never served, never answerable, not on the review screen.
    const someone = await learner({ unlimited: true });
    const served = await nextItems(db, someone, 200, Date.now());
    expect(served.map((i) => i.id)).not.toContain(target.id);
    await expect(answer(someone, target.id, 0)).rejects.toMatchObject({ error: { hint: "item_unavailable" } });
    await expect(record.itemDetail(db, target.id)).rejects.toBeTruthy();
    // ...and the answer already given to it is still there.
    expect(await count("select count(*) as n from attempts where user_id = ? and item_id = ?", ordinary.userId, target.id)).toBe(1);
  });

  // --- starting again -----------------------------------------------------------

  it("erases a history whole, and leaves settings, purchases and reports alone", async () => {
    const l = await learner({ unlimited: true });
    await profile.updateProfile(db, l, { display_name: "残る", exam_date: "2027-01-10" }, Date.now());
    await db.prepare("insert into entitlements (user_id, product, source) values (?, 'ads_free', 'grant')").bind(l.userId).run();
    await bank.reportItem(db, l, others[2].id, "unclear", "", Date.now());
    const session = await profile.startSession(db, l, Date.now());
    for (const it of others.slice(2, 4)) await answer(l, it.id, (it.correct_index + 1) % 4, Date.now(), { sessionId: session.id });
    await bank.saveNote(db, l, others[2].id, "メモ");

    const counts = await profile.resetProgress(db, l, Date.now());
    expect(counts).toEqual({ attempts: 2, sessions: 1, reviews: 2, notes: 1, levels: 3 });
    for (const table of ["attempts", "review_schedule", "review_notes", "practice_sessions", "section_levels"]) {
      expect(await count(`select count(*) as n from ${table} where user_id = ?`, l.userId)).toBe(0);
    }
    expect(await profile.profile(db, l)).toMatchObject({ display_name: "残る", exam_date: "2027-01-10", target_level: "J2" });
    expect(await profile.hasAdFree(db, l)).toBe(true);
    expect(await count("select count(*) as n from item_feedback where user_id = ?", l.userId)).toBe(1);
  });

  // --- the bank's own difficulty -------------------------------------------------

  it("recounts each person's first answer, timeouts left out, from nothing", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const recount = readFileSync(resolve(__dirname, "../../../d1/refresh_item_stats.sql"), "utf8");
    const run = () => db.exec(recount.replace(/^--.*$/gm, "").replace(/\s+/g, " ").trim());

    const target = others[4] ?? others[0];
    const people = await Promise.all([1, 2, 3].map(() => learner({ unlimited: true })));
    await answer(people[0], target.id, target.correct_index); // right first
    await answer(people[0], target.id, (target.correct_index + 1) % 4); // a second answer: not counted
    await answer(people[1], target.id, (target.correct_index + 1) % 4); // wrong first
    await answer(people[2], target.id, -1); // a timeout: not about the Japanese
    await db.prepare("insert into item_stats (item_id, answered, correct, p_correct) values (?, 99, 0, 0)").bind(reading.id).run();

    await run();
    const stats = await db.prepare("select answered, correct, p_correct from item_stats where item_id = ?").bind(target.id).first();
    // Earlier tests in this file answered `target`? Then those first answers count too.
    const firsts = await db
      .prepare(
        `select count(*) as answered, sum(is_correct) as correct from (
           select is_correct, chosen_role, row_number() over (partition by user_id order by answered_at, id) as nth
             from attempts where item_id = ?) where nth = 1 and chosen_role <> 'timed_out'`
      )
      .bind(target.id)
      .first<{ answered: number; correct: number }>();
    expect(stats).toEqual({ answered: firsts!.answered, correct: firsts!.correct, p_correct: firsts!.correct / firsts!.answered });
    // A count left over from before is gone, not added to.
    expect((await db.prepare("select answered from item_stats where item_id = ?").bind(reading.id).first<{ answered: number }>())!.answered).not.toBe(99);
  });

  // --- JSON is checked where it is stored -----------------------------------------

  it("refuses a question whose documents are not JSON", async () => {
    await expect(db.prepare("update items set documents = 'not json' where id = ?").bind(reading.id).run()).rejects.toThrow(/CHECK/i);
  });
});
