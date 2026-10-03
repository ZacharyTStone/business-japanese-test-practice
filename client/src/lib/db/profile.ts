/**
 * The learner's own row: the few things they set, the one way to start again,
 * and whether they have bought the app out of its ads.
 */
import type {
  Profile,
} from "../types";
import { call } from "../api";

export async function fetchProfile(): Promise<Profile | null> {
  return (await call<Profile | null>("profile")) ?? null;
}

/**
 * Change one of the few things a learner sets.
 *
 * `userId` is kept in the signature the screens call with; the Worker updates
 * the signed-in learner's row and no other, as row-level security insists.
 */
export async function updateProfile(
  _userId: string,
  // Not target_level: the database moves that, on the evidence of the answers.
  patch: Partial<Pick<Profile, "daily_goal" | "display_name" | "exam_date" | "timed_reading">>
) {
  await call("updateProfile", { patch });
}

/** What a reset removed, for the line the screen shows afterwards. */
type ResetCounts = {
  attempts: number;
  sessions: number;
  reviews: number;
  notes: number;
  levels: number;
};

/**
 * Erase this learner's own practice history and start again.
 *
 * An RPC rather than a delete, because `attempts` has no delete policy and
 * `review_schedule` has no write policy at all: an answer already given is
 * history, and a client that could edit either could make the app tell it what
 * it wanted to hear. `reset_my_progress()` takes no arguments and reads the
 * user from the session, so there is no way to spell "delete the ones I got
 * wrong" with it — it is all of one person's history or none of it.
 *
 * Settings, the purchase and any reported questions are left alone; they are
 * not progress. See the migration for the whole list.
 */
export async function resetProgress(): Promise<ResetCounts> {
  return call<ResetCounts>("resetProgress");
}

/**
 * Delete the account and everything the app holds about the learner
 * (worker/core/profile.ts): all or nothing, like starting again, and the
 * sign-in with it. `email` is the address on the screen; the Worker deletes
 * nothing unless it is the signed-in account's.
 */
export async function deleteAccount(email: string): Promise<{ attempts: number; deleted: boolean }> {
  return call<{ attempts: number; deleted: boolean }>("deleteAccount", { email });
}

/** The ad-free unlock. Absence of a row is the normal case.
 *
 *  A revoked entitlement keeps its row rather than being deleted — a refund
 *  should still leave an answer to "why did this person have the unlock in
 *  March" — so the filter is on `revoked_at`, not on existence. Failure reads as
 *  "not unlocked", which errs toward showing an ad to a paying customer rather
 *  than withholding one from everybody; the reverse would be a worse trade for
 *  a free tier that is meant to be genuinely complete. */
export async function hasAdFree(): Promise<boolean> {
  try {
    return (await call<boolean>("hasAdFree")) === true;
  } catch {
    return false;
  }
}
