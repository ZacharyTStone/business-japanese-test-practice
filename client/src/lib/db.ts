/**
 * Every query the app makes, in one file.
 *
 * Two rules hold throughout:
 *
 * 1. **The app never decides whether an answer was right.** It posts which
 *    option was touched and the database grades it. That keeps the answer key
 *    and the statistics from ever disagreeing, and it means a bug in this file
 *    cannot corrupt someone's weakness profile.
 *
 * 2. **No `select *` over items.** A practice set arrives from one RPC with its
 *    options already attached, because five questions should be one round trip,
 *    not eleven — and on a phone on a train that difference is the difference
 *    between usable and not.
 */
import { supabase } from "./supabase";
import type {
  PracticeMode,
  Profile,
  QueuedItem,
  RoleTrap,
  TagStat,
  TypeStat,
} from "./types";

/** The practice queue: unseen first, then items that caught you, then weakness
 *  order. The ordering lives in SQL (see next_items) rather than here, because
 *  it needs the whole library and the whole history to decide. */
export async function fetchQueue(options: {
  limit?: number;
  mode?: PracticeMode;
  itemType?: string | null;
  level?: string | null;
}): Promise<QueuedItem[]> {
  const { data, error } = await supabase.rpc("next_items", {
    p_limit: options.limit ?? 5,
    p_mode: options.mode ?? "daily",
    p_item_type: options.itemType ?? null,
    p_level: options.level ?? null,
  });
  if (error) throw error;
  return (data ?? []) as QueuedItem[];
}

export async function startSession(mode: PracticeMode, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("practice_sessions")
    .insert({ user_id: userId, mode })
    .select("id")
    .single();
  // A session is only a grouping label. If creating it fails we still want the
  // person to be able to practise, so this is not allowed to throw.
  if (error) return null;
  return data?.id ?? null;
}

export async function finishSession(sessionId: string): Promise<void> {
  await supabase
    .from("practice_sessions")
    .update({ finished_at: new Date().toISOString() })
    .eq("id", sessionId);
}

/**
 * Record an answer and find out whether it was right.
 *
 * Note what is NOT sent: user_id, is_correct, the role. The insert trigger fills
 * all three in, and `select` returns the graded row — so the value this resolves
 * to is the database's verdict, not ours.
 */
export async function recordAttempt(args: {
  itemId: string;
  chosenIndex: number;
  sessionId: string | null;
  elapsedMs: number | null;
}): Promise<{ isCorrect: boolean; chosenRole: string }> {
  const { data, error } = await supabase
    .from("attempts")
    .insert({
      item_id: args.itemId,
      chosen_index: args.chosenIndex,
      session_id: args.sessionId,
      elapsed_ms: args.elapsedMs,
    })
    .select("is_correct, chosen_role")
    .single();
  if (error) throw error;
  return { isCorrect: data.is_correct, chosenRole: data.chosen_role };
}

export async function fetchProfile(): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, target_level, daily_goal, is_anonymous, linked_at")
    .maybeSingle();
  if (error) throw error;
  return (data as Profile) ?? null;
}

export async function updateProfile(
  patch: Partial<Pick<Profile, "target_level" | "daily_goal" | "display_name">>
) {
  // PostgREST refuses an unfiltered update, and row-level security would narrow
  // it to this row anyway — but saying which row is clearer than relying on a
  // policy to save us from a statement that reads as "update every profile".
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("not signed in");
  const { error } = await supabase.from("profiles").update(patch).eq("id", auth.user.id);
  if (error) throw error;
}

/** The radar. All nine types come back, including untouched ones — "not tried
 *  yet" is the most useful thing this can say early on, and a chart that hides
 *  the gaps is worse than no chart. */
export async function fetchTypeStats(): Promise<TypeStat[]> {
  const { data, error } = await supabase
    .from("v_my_type_stats")
    .select("*")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as TypeStat[];
}

export async function fetchTagStats(): Promise<TagStat[]> {
  const { data, error } = await supabase
    .from("v_my_tag_stats")
    .select("*")
    .order("accuracy");
  if (error) throw error;
  return (data ?? []) as TagStat[];
}

/** Which traps keep catching this person. The most actionable thing in the app. */
export async function fetchRoleTraps(): Promise<RoleTrap[]> {
  const { data, error } = await supabase
    .from("v_my_role_traps")
    .select("*")
    .order("times_chosen", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RoleTrap[];
}

export async function fetchStreak(): Promise<number> {
  const { data, error } = await supabase.rpc("my_streak");
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function fetchAnsweredToday(): Promise<number> {
  // JST, to match the streak function: a day should end at midnight where the
  // user is, not at UTC midnight.
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from("v_my_daily").select("answered").eq("day", today);
  if (error) throw error;
  return data?.[0]?.answered ?? 0;
}

/** The ad-free unlock. Absence of a row is the normal case. */
export async function hasAdFree(): Promise<boolean> {
  const { data, error } = await supabase
    .from("entitlements")
    .select("product")
    .eq("product", "ads_free")
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

/** Public URL for a clip that has been synthesised. Null means "no audio yet" —
 *  the screen shows the text instead, which is how the app works until the TTS
 *  step has run. */
export function clipUrl(audioPath: string | null): string | null {
  if (!audioPath) return null;
  return supabase.storage.from("audio").getPublicUrl(audioPath).data.publicUrl;
}
