/**
 * The learner's own row and the one way to start again.
 *
 * Of its profile a learner may change only `display_name`, `daily_goal`,
 * `exam_date` and `timed_reading` (what the column grants allowed); the
 * level summary is the database's to move. The size of the day is the
 * owner's to give, one account at a time (keep_the_daily_goal_under_its_
 * ceiling()): without a max_daily_goal on this account's tester row the goal
 * is not the learner's to change at all, and with one it may not go above it.
 * A goal is judged when it is written, never an existing row.
 */
import type { Learner } from "./caller";
import { apiError } from "./errors";
import { bool, first, run, stmt, type Db, type Param } from "./sql";
import { iso } from "./time";

export async function profile(db: Db, learner: Learner) {
  const r = await first<Record<string, unknown>>(
    db,
    "select id, display_name, target_level, daily_goal, exam_date, timed_reading from profiles where id = ?",
    learner.userId
  );
  return r ? { ...r, timed_reading: bool(r.timed_reading) } : null;
}

export type ProfilePatch = Partial<{ display_name: string | null; daily_goal: number; exam_date: string | null; timed_reading: boolean }>;

export async function updateProfile(db: Db, learner: Learner, patch: ProfilePatch, now: number) {
  const keys = Object.keys(patch) as (keyof ProfilePatch)[];
  if (keys.length === 0) return null;
  if ("daily_goal" in patch) {
    const current = await first<{ daily_goal: number }>(db, "select daily_goal from profiles where id = ?", learner.userId);
    if (current?.daily_goal !== patch.daily_goal) {
      if (learner.maxDailyGoal === null) {
        throw apiError("42501", "the size of the day is not this account's to choose");
      }
      if ((patch.daily_goal ?? 0) > learner.maxDailyGoal) {
        throw apiError("P0001", `a daily goal of ${patch.daily_goal} is above this account's ceiling of ${learner.maxDailyGoal}`);
      }
    }
  }
  const values: Param[] = keys.map((k) => {
    const v = patch[k];
    return typeof v === "boolean" ? (v ? 1 : 0) : (v ?? null);
  });
  await run(
    db,
    `update profiles set ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? where id = ?`,
    ...values,
    iso(now),
    learner.userId
  );
  return null;
}

/**
 * Erase this learner's practice history and start again: answers, sessions,
 * the spacing schedule, review notes and the three section levels, all or
 * none, and the level summary back to the starting J2. Settings, the
 * purchase and any reports are not progress and are left alone. It takes no
 * arguments, so it cannot be aimed at part of a history.
 */
export async function resetProgress(db: Db, learner: Learner, now: number) {
  const uid = learner.userId;
  const nowIso = iso(now);
  const [attempts, reviews, notes, sessions, levels] = await db.batch([
    stmt(db, "delete from attempts where user_id = ?", uid),
    stmt(db, "delete from review_schedule where user_id = ?", uid),
    stmt(db, "delete from review_notes where user_id = ?", uid),
    stmt(db, "delete from practice_sessions where user_id = ?", uid),
    stmt(db, "delete from section_levels where user_id = ?", uid),
    stmt(db, "update profiles set target_level = 'J2', level_changed_at = ?, updated_at = ? where id = ?", nowIso, nowIso, uid),
  ]);
  return {
    attempts: attempts.meta.changes,
    sessions: sessions.meta.changes,
    reviews: reviews.meta.changes,
    notes: notes.meta.changes,
    levels: levels.meta.changes,
  };
}

/** The ad-free unlock: a row that has not been revoked. */
export async function hasAdFree(db: Db, learner: Learner): Promise<boolean> {
  const r = await first(
    db,
    "select 1 as x from entitlements where user_id = ? and product = 'ads_free' and revoked_at is null",
    learner.userId
  );
  return r !== null;
}

export async function startSession(db: Db, learner: Learner, now: number, newId: () => string = () => crypto.randomUUID()) {
  const id = newId();
  await run(db, "insert into practice_sessions (id, user_id, started_at) values (?, ?, ?)", id, learner.userId, iso(now));
  return { id };
}

export async function finishSession(db: Db, learner: Learner, sessionId: string, now: number) {
  await run(db, "update practice_sessions set finished_at = ? where id = ? and user_id = ?", iso(now), sessionId, learner.userId);
  return null;
}
