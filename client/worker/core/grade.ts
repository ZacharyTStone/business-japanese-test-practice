/**
 * An answer: graded, filed, and what it moves.
 *
 * Ported from three Postgres triggers on attempts — grade_attempt() before
 * the insert, schedule_review() and adjust_level() after it — and kept as one
 * all-or-nothing D1 batch:
 *
 *   1. the INSERT, which grades the answer from the item itself (the app sends
 *      only which option was touched) while the schema's triggers refuse it if
 *      the day is full (`daily_limit_reached`) or the question is not in the
 *      bank (`item_unavailable`);
 *   2. the lesson's rung on the spacing ladder;
 *   3. the section's level, when this answer moves it, and the one-line
 *      summary on the profile.
 *
 * Steps 2 and 3 are worked out here from the same snapshot the grade is read
 * from, with this answer added to it, and written in the same batch — so a
 * refused answer moves nothing, and an accepted one moves everything at once.
 */
import type { Learner } from "./caller";
import { apiError } from "./errors";
import { nextLevel, overallLevel } from "./levels";
import { loadSnapshot, SECTIONS, type Answer, type Level, type Snapshot } from "./snapshot";
import { stmt, type Db } from "./sql";
import { DAY, HOUR, iso, jstMidnight } from "./time";

export type AttemptArgs = {
  itemId: string;
  chosenIndex: number;
  sessionId: string | null;
  elapsedMs: number | null;
  thinkMs: number | null;
  replays: number;
  peeked: boolean;
  standsFor: string | null;
};

/** The spacing ladder, rung by rung (review_interval()). */
export const LADDER_MS = [20 * HOUR, 3 * DAY, 7 * DAY, 21 * DAY, 60 * DAY];

/** The reading clock's largest scale on seconds_per_item (pace.ts MAX_SCALE).
 *  A right answer slower than this holds its rung. */
export const PACE_MAX_SCALE = 1.6;

/** Whether a `stands_for` is one the queue could have served (grade_attempt()):
 *  the lesson is this learner's, due, of the same type, and the new question
 *  carries its trap as a wrong answer — or, for a lesson learnt without being
 *  caught, shares its 機能 — and the new question has never been answered. */
export function validStandsFor(snap: Snapshot, itemId: string, standsFor: string | null, nowIso: string): string | null {
  if (standsFor === null || standsFor === itemId) return null;
  if (snap.answers.some((a) => a.item_id === itemId)) return null;
  const item = snap.items.get(itemId);
  const lesson = snap.lessons.get(standsFor);
  const lessonItem = snap.items.get(standsFor);
  if (!item || !lesson || !lessonItem || lesson.due_at > nowIso || lessonItem.item_type !== item.item_type) return null;
  if (lesson.trap !== null) {
    const fits = (snap.options.get(itemId) ?? []).some((o) => o.role === lesson.trap && o.position !== item.correct_index);
    return fits ? standsFor : null;
  }
  return lessonItem.function === null || lessonItem.function === item.function ? standsFor : null;
}

export type Rung = { lesson: string; due_at: string; step: number; trap: string | null; missed: boolean };

/** Where this answer puts its lesson on the ladder (schedule_review()). */
export function nextRung(
  snap: Snapshot,
  a: { item_id: string; is_correct: boolean; chosen_role: string; elapsed_ms: number | null; think_ms: number | null; replays: number; peeked: boolean },
  lesson: string,
  answeredAt: number
): Rung {
  const known = snap.lessons.get(lesson);
  let step = known?.step ?? null;
  let trap = known?.trap ?? null;
  const item = snap.items.get(a.item_id);
  const secs = item ? (snap.types.get(item.item_type)?.seconds_per_item ?? null) : null;

  // A self-paced type is slow past the most its clock ever gives; a type the
  // audio paces, thirty seconds after the audio ended; with no think time,
  // two minutes for the whole item.
  const slow =
    secs !== null
      ? (a.think_ms ?? a.elapsed_ms ?? 0) > secs * 1000 * PACE_MAX_SCALE
      : a.think_ms !== null
        ? a.think_ms > 30_000
        : (a.elapsed_ms ?? 0) > 120_000;
  const helped = a.replays > 0 || a.peeked;

  if (!a.is_correct) {
    step = 0;
    if (a.chosen_role !== "timed_out") trap = a.chosen_role;
  } else if (slow || helped) {
    step = step ?? 0;
  } else if (!known) {
    step = 1;
  } else {
    step = Math.min((step ?? 0) + 1, 4);
  }

  let due = answeredAt + LADDER_MS[Math.min(Math.max(step, 0), 4)];
  // A due date is brought in to land before the exam.
  const examDate = snap.profile?.exam_date ?? null;
  if (examDate) {
    const exam = jstMidnight(examDate);
    if (exam > answeredAt && due > exam - 2 * DAY) due = Math.max(answeredAt + 20 * HOUR, exam - 2 * DAY);
  }
  return { lesson, due_at: iso(due), step, trap, missed: !a.is_correct };
}

export async function recordAttempt(db: Db, learner: Learner, args: AttemptArgs, now: number) {
  const uid = learner.userId!;
  const nowIso = iso(now);
  const snap = await loadSnapshot(db, learner);

  const item = snap.items.get(args.itemId);
  if (!item || !item.is_published) {
    throw apiError("P0001", "this question is no longer in the bank", 400, "item_unavailable");
  }
  const option = (snap.options.get(item.id) ?? []).find((o) => o.position === args.chosenIndex);
  if (args.chosenIndex !== -1 && !option) throw apiError("P0001", "no such option for this question");
  const isCorrect = args.chosenIndex !== -1 && args.chosenIndex === item.correct_index;
  const role = args.chosenIndex === -1 ? "timed_out" : option!.role;
  const standsFor = validStandsFor(snap, item.id, args.standsFor, nowIso);

  // The snapshot as it will be once this answer is in: what the ladder and the
  // levels are judged on.
  const answer: Answer = {
    id: Number.MAX_SAFE_INTEGER,
    item_id: item.id,
    is_correct: isCorrect,
    chosen_role: role,
    answered_at: nowIso,
    replays: args.replays,
    peeked: args.peeked,
  };
  const rung = nextRung(
    snap,
    { item_id: item.id, is_correct: isCorrect, chosen_role: role, elapsed_ms: args.elapsedMs, think_ms: args.thinkMs, replays: args.replays, peeked: args.peeked },
    standsFor ?? item.id,
    now
  );
  const after: Snapshot = { ...snap, answers: [...snap.answers, answer], levels: new Map(snap.levels) };

  // The first answer seeds all three sections at the profile's level, so a
  // strong reader does not meet 聴解 already at J1.
  const seedLevel: Level = snap.profile?.target_level ?? "J2";
  const seeded = SECTIONS.filter((s) => !after.levels.has(s));
  for (const s of seeded) after.levels.set(s, { section: s, level: seedLevel, changed_at: nowIso, moves: 0 });
  const move = nextLevel(after, item.section);
  if (move !== null) {
    const held = after.levels.get(item.section)!;
    after.levels.set(item.section, { ...held, level: move, changed_at: nowIso, moves: held.moves + 1 });
  }
  const overall = overallLevel(SECTIONS.map((s) => after.levels.get(s)!.level));

  const writes = [
    stmt(
      db,
      `insert into attempts (user_id, session_id, item_id, chosen_index, is_correct, chosen_role,
                             elapsed_ms, answered_at, think_ms, replays, peeked, stands_for)
       values (?1, ?2, ?3, ?4,
               (select case when ?4 = -1 then 0 else (?4 = i.correct_index) end from items i where i.id = ?3),
               (select case when ?4 = -1 then 'timed_out'
                            else (select o.role from item_options o where o.item_id = ?3 and o.position = ?4) end),
               ?5, ?6, ?7, ?8, ?9, ?10)
       returning is_correct, chosen_role`,
      uid, args.sessionId, item.id, args.chosenIndex, args.elapsedMs, nowIso, args.thinkMs, args.replays, args.peeked ? 1 : 0, standsFor
    ),
    stmt(
      db,
      `insert into review_schedule (user_id, item_id, due_at, step, last_at, trap, missed)
       values (?, ?, ?, ?, ?, ?, ?)
       on conflict (user_id, item_id) do update set
         due_at = excluded.due_at, step = excluded.step, last_at = excluded.last_at,
         trap = excluded.trap, missed = excluded.missed`,
      uid, rung.lesson, rung.due_at, rung.step, nowIso, rung.trap, rung.missed ? 1 : 0
    ),
    ...seeded.map((s) =>
      stmt(
        db,
        "insert into section_levels (user_id, section, level, changed_at) values (?, ?, ?, ?) on conflict (user_id, section) do nothing",
        uid, s, seedLevel, nowIso
      )
    ),
  ];
  if (move !== null) {
    writes.push(
      stmt(db, "update section_levels set level = ?, changed_at = ?, moves = moves + 1 where user_id = ? and section = ?", move, nowIso, uid, item.section)
    );
  }
  if (overall !== null && overall !== snap.profile?.target_level) {
    writes.push(
      stmt(db, "update profiles set target_level = ?, level_changed_at = ?, updated_at = ? where id = ? and target_level <> ?", overall, nowIso, nowIso, uid, overall)
    );
  }

  const [inserted] = await db.batch(writes);
  const row = (inserted.results as { is_correct: number; chosen_role: string }[])[0];
  return { is_correct: row.is_correct === 1, chosen_role: row.chosen_role };
}
