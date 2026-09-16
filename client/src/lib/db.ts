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
  HistoryEntry,
  Profile,
  QueuedItem,
  RoleTrap,
  TagStat,
  TypeStat,
} from "./types";

/** The practice queue — the only way this app asks for questions.
 *
 *  How many, and nothing else. The composition lives in SQL (see next_items)
 *  because it needs the whole library and the whole history to decide: the
 *  items that caught you before, the unseen ones aimed at your weakest ground,
 *  one from the level above. There is no level, type or mode to pass, because
 *  there is no screen where anybody chooses one. */
export async function fetchQueue(limit = 5): Promise<QueuedItem[]> {
  const { data, error } = await supabase.rpc("next_items", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as QueuedItem[];
}

export async function startSession(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("practice_sessions")
    .insert({ user_id: userId })
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
    .select("id, display_name, target_level, daily_goal, exam_date, is_anonymous, linked_at")
    .maybeSingle();
  if (error) throw error;
  return (data as Profile) ?? null;
}

export async function updateProfile(
  // Not target_level: the database moves that, on the evidence of the answers.
  patch: Partial<Pick<Profile, "daily_goal" | "display_name" | "exam_date">>
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

/** Public URL for a clip that has been synthesised. Null means "no audio yet" —
 *  the screen shows the text instead, which is how the app works until the TTS
 *  step has run. */
export function clipUrl(audioPath: string | null): string | null {
  if (!audioPath) return null;
  return supabase.storage.from("audio").getPublicUrl(audioPath).data.publicUrl;
}

/** Public URL for a scene illustration, on exactly the same terms: null is the
 *  ordinary case, because items are published long before their artwork. */
export function sceneUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  return supabase.storage.from("scenes").getPublicUrl(imagePath).data.publicUrl;
}

/**
 * Past answers, newest first — the review screen.
 *
 * `attempts` has no update or delete policy: an answer already given is
 * history, and this is the screen that treats it as such. Two queries rather
 * than an embedded select, because PostgREST's nested filtering across a
 * many-to-one would still fetch the same rows and the join is clearer here.
 */
export async function fetchHistory(limit = 50): Promise<HistoryEntry[]> {
  const { data: attempts, error } = await supabase
    .from("attempts")
    .select("id, item_id, answered_at, is_correct, chosen_index, chosen_role")
    .order("answered_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  if (!attempts?.length) return [];

  const ids = [...new Set(attempts.map((a) => a.item_id))];
  const [items, options, types] = await Promise.all([
    supabase
      .from("items")
      .select("id, item_type, level, topic, stem, correct_index, explanation_ja, explanation_en")
      .in("id", ids),
    supabase.from("item_options").select("item_id, position, text, role, why").in("item_id", ids),
    supabase.from("item_types").select("id, label_ja"),
  ]);
  if (items.error) throw items.error;
  if (options.error) throw options.error;

  const byId = new Map((items.data ?? []).map((i) => [i.id, i]));
  const labels = new Map((types.data ?? []).map((t) => [t.id, t.label_ja]));
  const optionsById = new Map<string, HistoryEntry["options"]>();
  for (const o of options.data ?? []) {
    const list = optionsById.get(o.item_id) ?? [];
    list.push({ ...o, clip_id: null, audio_path: null });
    optionsById.set(o.item_id, list);
  }

  const out: HistoryEntry[] = [];
  for (const attempt of attempts) {
    const item = byId.get(attempt.item_id);
    // An item can be unpublished without deleting the attempts that reference
    // it, so a missing row here is expected rather than broken data.
    if (!item) continue;
    out.push({
      attempt_id: attempt.id,
      item_id: attempt.item_id,
      answered_at: attempt.answered_at,
      is_correct: attempt.is_correct,
      chosen_index: attempt.chosen_index,
      chosen_role: attempt.chosen_role,
      item_type: item.item_type,
      label_ja: labels.get(item.item_type) ?? item.item_type,
      level: item.level,
      topic: item.topic,
      stem: item.stem,
      correct_index: item.correct_index,
      explanation_ja: item.explanation_ja,
      explanation_en: item.explanation_en ?? "",
      options: (optionsById.get(item.id) ?? []).sort((a, b) => a.position - b.position),
    });
  }
  return out;
}
