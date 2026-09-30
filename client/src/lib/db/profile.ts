/**
 * The learner's own row: the few things they set, the one way to start again,
 * and whether they have bought the app out of its ads.
 */
import type {
  Profile,
} from "../types";
import { supabase } from "../supabase";

export async function fetchProfile(): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, display_name, target_level, daily_goal, exam_date, timed_reading"
    )
    .maybeSingle();
  if (error) throw error;
  return (data as Profile) ?? null;
}

/**
 * Change one of the few things a learner sets.
 *
 * `userId` is the signed-in session's, passed in rather than asked for:
 * `auth.getUser()` is a round trip to the auth server on every call, and the
 * session the screen already holds says the same thing. Row-level security
 * checks the id against the token either way.
 */
export async function updateProfile(
  userId: string,
  // Not target_level: the database moves that, on the evidence of the answers.
  patch: Partial<Pick<Profile, "daily_goal" | "display_name" | "exam_date" | "timed_reading">>
) {
  // PostgREST refuses an unfiltered update, and row-level security would narrow
  // it to this row anyway — but saying which row is clearer than relying on a
  // policy to save us from a statement that reads as "update every profile".
  const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
  if (error) throw error;
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
  const { data, error } = await supabase.rpc("reset_my_progress");
  if (error) throw error;
  return data as ResetCounts;
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
  const { data, error } = await supabase
    .from("entitlements")
    .select("product")
    .eq("product", "ads_free")
    .is("revoked_at", null)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}
