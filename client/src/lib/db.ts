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
import { buildWordList, type WordEntry, type WordSourceItem } from "./words";
import type {
  DayStatus,
  HistoryEntry,
  Level,
  Profile,
  QueuedItem,
  ReviewDetail,
  ReviewLoad,
  RoleTrap,
  Section,
  SectionLevel,
  StimulusDocument,
  TagStat,
  TermSentence,
  TypeStat,
  VocabEntry,
  VocabNote,
} from "./types";

/** The practice queue — the only way this app asks for questions.
 *
 *  How many, and nothing else. The composition lives in SQL (see next_items)
 *  because it needs the whole library and the whole history to decide: the
 *  items that caught you before, the unseen ones aimed at your weakest ground,
 *  one from the level above. There is no level, type or mode to pass, because
 *  there is no screen where anybody chooses one. */
export async function fetchQueue(limit: number): Promise<QueuedItem[]> {
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
 * Note what is NOT sent: user_id, is_correct, the role, the time. The insert
 * trigger fills them in, and `select` returns the graded row — so the value this
 * resolves to is the database's verdict, not ours. The database refuses those
 * columns outright if a client sends them.
 *
 * What IS sent, beyond the answer, is how it was given, because the ladder and
 * the level both care: `thinkMs` (from the end of the audio, or from the question
 * appearing on a reading item — null when the audio did not set the pace),
 * `replays` and `peeked` (the exam plays once, and a right answer given with
 * help is not yet a known one), and `standsFor` (the lesson a 類題 re-tests,
 * which the database checks before believing).
 */
export async function recordAttempt(args: {
  itemId: string;
  chosenIndex: number;
  sessionId: string | null;
  elapsedMs: number | null;
  thinkMs: number | null;
  replays: number;
  peeked: boolean;
  standsFor: string | null;
}): Promise<{ isCorrect: boolean; chosenRole: string }> {
  const { data, error } = await supabase
    .from("attempts")
    .insert({
      item_id: args.itemId,
      chosen_index: args.chosenIndex,
      session_id: args.sessionId,
      elapsed_ms: args.elapsedMs,
      think_ms: args.thinkMs,
      replays: args.replays,
      peeked: args.peeked,
      stands_for: args.standsFor,
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
      "id, display_name, target_level, daily_goal, exam_date, timed_reading"
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

/**
 * Whether this account may veto — asked once, so the button is drawn or it is
 * not. A `false` here is cosmetic: `veto_item()` re-checks the same thing
 * server-side, because the client that draws a button is not the thing that
 * decides who may press it.
 */
export async function mayVeto(): Promise<boolean> {
  const { data, error } = await supabase.rpc("may_i_veto");
  if (error) return false;
  return data === true;
}

/**
 * Take one question out of the bank, for everybody, now.
 *
 * Unlike `reportItem`, which is an opinion somebody reads later, this is the
 * decision itself: the item is unpublished and the next set nobody draws will
 * contain it. Only an account whose tester row carries `may_veto` can do it —
 * one press emptying the bank is exactly the risk `item_feedback` exists to
 * avoid, and what makes it safe here is who is pressing rather than what the
 * press does.
 *
 * Nothing is recorded against the learner: vetoing happens instead of
 * answering, so no attempt is written and the day's count does not move.
 */
export async function vetoItem(itemId: string, note = ""): Promise<void> {
  const { error } = await supabase.rpc("veto_item", {
    p_item_id: itemId,
    p_note: note.trim(),
  });
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

/** How many lessons are due. Home says it in the button's second line, because
 *  "ten questions, three of them on traps that caught you" is what the set is. */
export async function fetchReviewLoad(): Promise<ReviewLoad> {
  const { data, error } = await supabase
    .from("v_my_review_load")
    .select("due_now, tracked, next_due_at")
    .single();
  if (error) throw error;
  return data as ReviewLoad;
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
    .select("goal, answered_today, unlimited, max_today, left_today, goal_max")
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
 * The four option numbers, spoken.
 *
 * A listening item shows nothing but 1 / 2 / 3 / 4 while its options play, so
 * the clip that says the number is what ties what is being heard to the button
 * that answers it; without it the learner is holding four unlabelled sentences
 * in their head. The exam reads its numbers aloud for the same reason.
 *
 * These are one clip each for the whole library rather than one per item — a
 * clip id is a hash of (voice, channel, text), so 「いち」 is synthesised once
 * and shared — which is why they are looked up by what is said rather than
 * arriving with the item. The four strings and the narrator's name are
 * `OPTION_LABELS` and `NARRATOR_VOICE` in bjt/tts/plan.py, which is where the
 * clips come from; a test holds the two files equal.
 */
// Numbers rather than letters: 「ビー」/「ディー」 are easily misheard for each
// other, and 「デー」 sounds like "day". See OPTION_LABELS in bjt/tts/plan.py.
const OPTION_LABELS = ["いち", "に", "さん", "よん"];
const NARRATOR_VOICE = "narrator_f";

/** The four number clips in 1–4 order, or null until every one of them has been
 *  synthesised. All four or none: a run that says the number before three of
 *  the options and not the fourth is worse than one that says none. */
export async function fetchOptionLabels(): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("audio_clips")
    .select("text, audio_path")
    .eq("voice", NARRATOR_VOICE)
    .in("text", OPTION_LABELS);
  if (error) throw error;
  const paths = new Map((data ?? []).map((row) => [row.text as string, row.audio_path]));
  const urls = OPTION_LABELS.map((label) => clipUrl(paths.get(label) ?? null));
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
export async function fetchHistory(limit = 50, itemId?: string): Promise<HistoryEntry[]> {
  // One question's answers, when the review screen is opened from a word on
  // the vocabulary screen: that question may be older than the latest fifty.
  let query = supabase
    .from("attempts")
    .select("id, item_id, answered_at, is_correct, chosen_index, chosen_role")
    .order("answered_at", { ascending: false })
    .limit(limit);
  if (itemId) query = query.eq("item_id", itemId);
  const { data: attempts, error } = await query;
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

/**
 * The rest of one past question — its documents, its conversation and
 * narration with their clips, its spoken options' clips and its notes — for
 * the moment an entry on the review screen is opened.
 *
 * Fetched per entry rather than with the list: fifty conversations and their
 * documents is a lot to carry for a list most people scroll past, and the
 * clips cannot be asked for in one go without a request line naming several
 * hundred ids. Opening one entry is two small queries.
 *
 * The clips are furniture, as they are on the practice screen: if they fail to
 * load the question is still shown, as text.
 */
export async function fetchReviewDetail(itemId: string): Promise<ReviewDetail> {
  const [item, options] = await Promise.all([
    supabase
      .from("items")
      .select("documents, dialogue, vocab_notes, narration_clip_id")
      .eq("id", itemId)
      .single(),
    supabase.from("item_options").select("position, clip_id").eq("item_id", itemId),
  ]);
  if (item.error) throw item.error;
  if (options.error) throw options.error;

  const turns = (item.data.dialogue ?? []) as { speaker_role: string; text: string; clip_id: string | null }[];
  const narrationId = item.data.narration_clip_id as string | null;
  const ids = [
    ...new Set(
      [...turns.map((turn) => turn.clip_id), narrationId, ...(options.data ?? []).map((o) => o.clip_id)].filter(
        (id): id is string => Boolean(id)
      )
    ),
  ];
  const paths = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: clips, error } = await supabase
      .from("audio_clips")
      .select("id, audio_path")
      .in("id", ids);
    if (!error) for (const clip of clips ?? []) paths.set(clip.id, clip.audio_path);
  }
  const pathOf = (id: string | null) => (id ? (paths.get(id) ?? null) : null);

  const optionAudio: Record<number, string | null> = {};
  for (const o of options.data ?? []) optionAudio[o.position] = pathOf(o.clip_id);

  return {
    documents: (item.data.documents ?? []) as StimulusDocument[],
    dialogue: turns.map((turn) => ({ ...turn, clip_id: turn.clip_id ?? null, audio_path: pathOf(turn.clip_id) })),
    narration_path: pathOf(narrationId),
    option_audio: optionAudio,
    vocab_notes: (item.data.vocab_notes ?? []) as VocabNote[],
  };
}

/**
 * The vocabulary notes of the questions that caught this learner, one entry per
 * word, the most recently missed first.
 *
 * Every item ships with notes — a reading and a meaning for the words it turns
 * on — and the practice screen shows them once, folded under the explanation.
 * This is where they are kept. Drawn from wrong answers only: a word in a
 * question that was answered right is not, on the evidence, the problem.
 *
 * A read of the record and nothing more; which questions come next is still
 * decided by next_items() alone.
 */
export async function fetchVocab(limit = 200): Promise<VocabEntry[]> {
  const { data: attempts, error } = await supabase
    .from("attempts")
    .select("item_id, answered_at")
    .eq("is_correct", false)
    .order("answered_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  if (!attempts?.length) return [];

  const ids = [...new Set(attempts.map((a) => a.item_id as string))];
  const { data: items, error: itemsError } = await supabase
    .from("items")
    .select("id, vocab_notes")
    .in("id", ids);
  if (itemsError) throw itemsError;
  const notesOf = new Map((items ?? []).map((i) => [i.id as string, (i.vocab_notes ?? []) as VocabNote[]]));

  // Newest first, so the first time a word is met here is its latest miss.
  const byTerm = new Map<string, VocabEntry>();
  for (const attempt of attempts) {
    for (const note of notesOf.get(attempt.item_id) ?? []) {
      const seen = byTerm.get(note.term);
      if (seen) seen.misses += 1;
      else
        byTerm.set(note.term, {
          ...note,
          misses: 1,
          last_missed_at: attempt.answered_at,
          item_id: attempt.item_id as string,
        });
    }
  }
  return [...byTerm.values()];
}

/**
 * The line of a question a word was met in — a turn of the conversation, the
 * narration, or an option — with its clip when that has been synthesised.
 *
 * A word learnt from a list is a word that is recognised on a list. The exam
 * says it in a sentence, at speed, so this finds the sentence. Asked for one
 * word at a time, when its entry is opened: a question's clips cannot all be
 * asked for in one request line anyway (see fetchReviewDetail). Null when the
 * word does not appear as written — a note may give the dictionary form of a
 * verb that the question conjugates.
 */
export async function fetchTermSentence(itemId: string, term: string): Promise<TermSentence | null> {
  const [item, options] = await Promise.all([
    supabase.from("items").select("stem, dialogue, narration_clip_id").eq("id", itemId).single(),
    supabase.from("item_options").select("text, clip_id").eq("item_id", itemId).order("position"),
  ]);
  if (item.error) throw item.error;
  if (options.error) throw options.error;
  const turns = (item.data.dialogue ?? []) as { text: string; clip_id: string | null }[];
  const lines: { text: string; clip_id: string | null }[] = [
    ...turns,
    { text: item.data.stem as string, clip_id: item.data.narration_clip_id as string | null },
    ...((options.data ?? []) as { text: string; clip_id: string | null }[]),
  ];
  const line = lines.find((l) => l.text?.includes(term));
  if (!line) return null;
  let url: string | null = null;
  if (line.clip_id) {
    const { data: clip } = await supabase
      .from("audio_clips")
      .select("audio_path")
      .eq("id", line.clip_id)
      .maybeSingle();
    url = clipUrl((clip?.audio_path as string | null) ?? null);
  }
  return { text: line.text, url };
}

/**
 * Every word noted by a question this learner has already answered, each with
 * a sentence from those questions — the word list.
 *
 * Read from the bank as it stands, and nothing written for it: the notes are
 * the ones each item shipped with, and the sentence is found in the questions
 * (see `words.ts`). Only answered questions, sentences included, so the list
 * never shows a line — or a correct answer — before the question is met. A
 * timed-out answer counts: the question was on screen.
 *
 * Attempts are paged, because PostgREST stops at a thousand rows, and the
 * items asked for a hundred ids at a time, so the request line stays short.
 * Row-level security already narrows attempts to this learner and hides
 * unpublished questions, so a withdrawn one's words go with it.
 */
export async function fetchWordList(): Promise<WordEntry[]> {
  const PAGE = 1000;
  const answered = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("attempts")
      .select("item_id")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) answered.add(row.item_id as string);
    if (!data || data.length < PAGE) break;
  }
  if (answered.size === 0) return [];

  const ids = [...answered];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const [itemPages, correctPages, types] = await Promise.all([
    Promise.all(
      chunks.map((chunk) =>
        supabase
          .from("items")
          .select("id, item_type, level, stem, dialogue, documents, vocab_notes")
          .in("id", chunk)
      )
    ),
    Promise.all(
      chunks.map((chunk) =>
        supabase.from("item_options").select("item_id, text").eq("role", "correct").in("item_id", chunk)
      )
    ),
    supabase.from("item_types").select("id, section"),
  ]);
  if (types.error) throw types.error;
  const items = itemPages.flatMap((page) => {
    if (page.error) throw page.error;
    return page.data ?? [];
  });
  const correct = correctPages.flatMap((page) => {
    if (page.error) throw page.error;
    return page.data ?? [];
  });
  const sectionOf = new Map((types.data ?? []).map((t) => [t.id as string, t.section as Section]));
  const answerOf = new Map(correct.map((o) => [o.item_id as string, o.text as string]));
  const sources: WordSourceItem[] = items.map((i) => ({
    id: i.id as string,
    level: i.level as Level,
    section: sectionOf.get(i.item_type as string) ?? "dokkai",
    stem: (i.stem as string) ?? "",
    dialogue: (i.dialogue ?? []) as { text: string }[],
    documents: (i.documents ?? []) as StimulusDocument[],
    vocab_notes: (i.vocab_notes ?? []) as VocabNote[],
    correct_text: answerOf.get(i.id as string) ?? null,
  }));
  return buildWordList(sources);
}

/**
 * The learner's own notes on questions, by item — 復習ノート.
 *
 * An answer is worth little if you cannot come back to the one that caught you.
 * A note is the learner's sentence about why they fell for it, which is the
 * part of a review that does the learning.
 */
export async function fetchNotes(itemIds: string[]): Promise<Record<string, string>> {
  if (itemIds.length === 0) return {};
  const { data, error } = await supabase
    .from("review_notes")
    .select("item_id, note")
    .in("item_id", itemIds);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((row) => [row.item_id as string, row.note as string]));
}

/** Keep a note, or remove it when it has been emptied. */
export async function saveNote(itemId: string, note: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("not signed in");
  const text = note.trim();
  if (!text) {
    const { error } = await supabase.from("review_notes").delete().eq("item_id", itemId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("review_notes")
    .upsert({ user_id: auth.user.id, item_id: itemId, note: text }, { onConflict: "user_id,item_id" });
  if (error) throw error;
}
