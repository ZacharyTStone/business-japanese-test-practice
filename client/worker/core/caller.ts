/**
 * Who is asking, to the database: the account an Access-verified email
 * belongs to, and what its tester row allows.
 *
 * This is the door that row-level security used to be. Every query but
 * `whoami` refuses a caller who is not on the tester list (queries.ts), and
 * every query filters on the caller's own id — there is no other user's row
 * a query here can reach.
 *
 * An account is made the first time a listed address signs in, with a
 * profile beside it, so there is never one without the other. An
 * address that is not listed gets no account at all, so nothing about it is
 * stored: the second lock that kept strangers out of a work in progress.
 *
 * For a Google sign-in (the Worker's own, worker/auth.ts) the account is made
 * only while that sign-in exists. Deleting an account deletes its sign-in
 * too (core/profile.ts), but a second device's session is vouched for by a
 * signed cookie for up to five minutes without the database being asked; in
 * those minutes it must not make the deleted account again.
 */
import { first, stmt, type Db } from "./sql";

export type Learner = {
  userId: string | null;
  email: string;
  isTester: boolean;
  /** No daily ceiling (testers.unlimited): for exercising the app. */
  unlimited: boolean;
  mayVeto: boolean;
  /** This account's own day (testers.max_daily_goal), or null. */
  maxDailyGoal: number | null;
};

/** The most anybody may answer in one Japanese day, unless their row says. */
export const DAILY_MAX = 15;

/** The day's ceiling and the largest set this caller may ask for. */
export function dailyMax(l: Learner): number {
  return l.maxDailyGoal ?? DAILY_MAX;
}

type TesterRow = { unlimited: number; may_veto: number; max_daily_goal: number | null };

export async function resolveLearner(
  db: Db,
  rawEmail: string,
  { viaSession = false, newId = () => crypto.randomUUID() }: { viaSession?: boolean; newId?: () => string } = {}
): Promise<Learner> {
  const email = rawEmail.trim().toLowerCase();
  const [testerRes, userRes] = await db.batch([
    stmt(db, "select unlimited, may_veto, max_daily_goal from testers where email = ?", email),
    stmt(db, "select id from users where email = ?", email),
  ]);
  const tester = (testerRes.results?.[0] as TesterRow | undefined) ?? null;
  let userId = ((userRes.results?.[0] as { id: string } | undefined) ?? null)?.id ?? null;

  const signInExists = async () =>
    !viaSession || (await first(db, 'select 1 as ok from "auth_users" where "email" = ?', email)) !== null;

  if (tester && !userId && (await signInExists())) {
    // First sign-in of a listed address: the account and its profile, in one
    // go, so there is never a user without a profile.
    const id = newId();
    await db.batch([
      stmt(db, "insert into users (id, email) values (?, ?) on conflict (email) do nothing", id, email),
      stmt(db, "insert into profiles (id) select id from users where email = ? on conflict (id) do nothing", email),
    ]);
    userId = (await first<{ id: string }>(db, "select id from users where email = ?", email))?.id ?? null;
  }

  return {
    userId,
    email,
    isTester: tester !== null && userId !== null,
    unlimited: tester?.unlimited === 1,
    mayVeto: tester?.may_veto === 1,
    maxDailyGoal: tester?.max_daily_goal ?? null,
  };
}
