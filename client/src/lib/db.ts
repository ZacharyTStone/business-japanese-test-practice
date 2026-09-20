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
import type { TypePace } from "./pace";
import { supabase } from "./supabase";
import type {
  DayStatus,
  HistoryEntry,
  Profile,
  QueuedItem,
  ReviewLoad,
  RoleTrap,
  SectionLevel,
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

/** The three levels being served, one per exam section.
 *
 *  Always three rows: the view fills in J2 for a section nobody has answered in
 *  yet. Shown, never chosen — there is no screen in this app where a level is a
 *  control, and `v_my_levels` has no write path to be one. `placed` comes from
 *  the same view, so whether a level is worth printing is the database's call
 *  and not a count the app keeps on its own. */
export async function fetchSectionLevels(): Promise<SectionLevel[]> {
  const { data, error } = await supabase
    .from("v_my_levels")
    .select("section, level, changed_at, placed");
  if (error) throw error;
  return (data ?? []) as SectionLevel[];
}

export async function fetchProfile(): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, display_name, target_level, daily_goal, exam_date, is_anonymous, linked_at, timed_reading"
    )
    .maybeSingle();
  if (error) throw error;
  return (data as Profile) ?? null;
}

/**
 * What the exam affords each problem type: the seconds a typical item gets, and
 * how much reading a typical item carries. The exam's own pacing, not a
 * preference — see `src/lib/pace.ts`, which turns the pair into a budget for a
 * particular question.
 *
 * Both are null for every type whose stimulus is heard: there the audio decides
 * how long the question takes and a countdown would only be a second clock
 * disagreeing with the first. A row here therefore means two things at once —
 * "this type is self-paced" and "this is the pace" — which is why the practice
 * screen asks this one question rather than asking for a section and a duration
 * separately.
 *
 * Three rows today. Fetched with the set rather than baked into the app, so
 * changing the pace is one UPDATE and not a release.
 */
export async function fetchPace(): Promise<Record<string, TypePace>> {
  const { data, error } = await supabase
    .from("item_types")
    .select("id, seconds_per_item, typical_chars")
    .not("seconds_per_item", "is", null);
  if (error) throw error;
  const out: Record<string, TypePace> = {};
  for (const row of data ?? []) {
    out[row.id as string] = {
      seconds: (row.seconds_per_item as number) ?? 0,
      typicalChars: (row.typical_chars as number) ?? 0,
    };
  }
  return out;
}

export async function updateProfile(
  // Not target_level: the database moves that, on the evidence of the answers.
  patch: Partial<Pick<Profile, "daily_goal" | "display_name" | "exam_date" | "timed_reading">>
) {
  // PostgREST refuses an unfiltered update, and row-level security would narrow
  // it to this row anyway — but saying which row is clearer than relying on a
  // policy to save us from a statement that reads as "update every profile".
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("not signed in");
  const { error } = await supabase.from("profiles").update(patch).eq("id", auth.user.id);
  if (error) throw error;
}

/** Why a question is being reported. A closed set, so that reports are a number
 *  the generator loop can act on rather than prose nobody counts; `other` carries
 *  its meaning in the note. Must match the check constraint on
 *  `item_feedback.reason`. */
export type FeedbackReason =
  | "unnatural"
  | "wrong_answer"
  | "ambiguous"
  | "unclear"
  | "audio"
  | "other";

/**
 * Report that a question is wrong or odd.
 *
 * One row per person per item, so pressing again corrects the earlier report
 * rather than counting twice. Done as an insert and then, on the unique
 * violation, an update — rather than an upsert — because the conflict target is
 * a column the client deliberately does not send: `user_id` is filled in by a
 * trigger from the session, exactly as it is for an attempt.
 *
 * Nothing about this reaches the queue. A reported item keeps being served until
 * a person reads the report, which is the only way "some tester pressed a
 * button" does not become a way to empty the bank.
 */
export async function reportItem(args: {
  itemId: string;
  reason: FeedbackReason;
  note?: string;
}): Promise<void> {
  const row = { item_id: args.itemId, reason: args.reason, note: (args.note ?? "").trim() };
  const { error } = await supabase.from("item_feedback").insert(row);
  if (!error) return;
  // 23505 — this person has already reported this item. Replace what they said.
  if (error.code !== "23505") throw error;
  const { error: updateError } = await supabase
    .from("item_feedback")
    .update({ reason: row.reason, note: row.note })
    .eq("item_id", args.itemId);
  if (updateError) throw updateError;
}

/** The radar. All nine types come back, including untouched ones — "not tried
 *  yet" is the most useful thing this can say early on, and a chart that hides
 *  the gaps is worse than no chart. */
/** What a reset removed, for the line the screen shows afterwards. */
export type ResetCounts = {
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
 * Settings, the purchase and any reported questions are left alone; they were
 * never progress. See the migration for the whole list.
 */
export async function resetProgress(): Promise<ResetCounts> {
  const { data, error } = await supabase.rpc("reset_my_progress");
  if (error) throw error;
  return data as ResetCounts;
}

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

/** What the spacing ladder has waiting.
 *
 *  Only ever used to let home say one true sentence — "three are due today" —
 *  and never to let anybody act on it: there is no button that serves the due
 *  items on their own, because there is no button that serves anything on its
 *  own. The queue already puts them first. */
export async function fetchReviewLoad(): Promise<ReviewLoad> {
  const { data, error } = await supabase
    .from("v_my_review_load")
    .select("due_now, tracked, next_due_at")
    .maybeSingle();
  if (error) throw error;
  return (data as ReviewLoad) ?? { due_now: 0, tracked: 0, next_due_at: null };
}

export async function fetchStreak(): Promise<number> {
  const { data, error } = await supabase.rpc("my_streak");
  if (error) throw error;
  return (data as number) ?? 0;
}

/** Today, against the goal and the ceiling.
 *
 *  Always one row. The day ends at midnight in Japan and the view does that
 *  arithmetic, so the app never has to guess the date. Home sizes its button
 *  from this and shows the "done" screen from it; practice sizes its set from
 *  it — and next_items() would cap the set anyway, so the two cannot disagree. */
export async function fetchDay(): Promise<DayStatus> {
  const { data, error } = await supabase
    .from("v_my_day")
    .select("goal, answered_today, unlimited, max_today, left_today")
    .single();
  if (error) throw error;
  return data as DayStatus;
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

/**
 * The four option letters, spoken.
 *
 * A listening item shows nothing but A / B / C / D while its options play, so
 * the clip that names the letter is what ties what is being heard to the button
 * that answers it; without it the learner is holding four unlabelled sentences
 * in their head. The exam reads its numbers aloud for the same reason.
 *
 * These are one clip each for the whole library rather than one per item — a
 * clip id is a hash of (voice, channel, text), so 「エー」 is synthesised once
 * and shared — which is why they are looked up by what is said rather than
 * arriving with the item. The four strings and the narrator's name are
 * `OPTION_LABELS` and `NARRATOR_VOICE` in bjt/tts/plan.py, which is where the
 * clips come from; a test holds the two files equal.
 */
const OPTION_LETTERS = ["エー", "ビー", "シー", "ディー"];
const NARRATOR_VOICE = "narrator_f";

/** The four letter clips in A–D order, or null until every one of them has been
 *  synthesised. All four or none: a run that says the letter before three of
 *  the options and not the fourth is worse than one that says none. */
export async function fetchOptionLetters(): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("audio_clips")
    .select("text, audio_path")
    .eq("voice", NARRATOR_VOICE)
    .in("text", OPTION_LETTERS);
  if (error) throw error;
  const paths = new Map((data ?? []).map((row) => [row.text as string, row.audio_path]));
  const urls = OPTION_LETTERS.map((letter) => clipUrl(paths.get(letter) ?? null));
  return urls.every((u): u is string => Boolean(u)) ? (urls as string[]) : null;
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
