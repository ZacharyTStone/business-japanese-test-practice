/**
 * The record, read back: the three levels, the statistics 記録 draws, today
 * against the goal, the answered questions and what each one taught — its
 * words, its sentence, the learner's note on it.
 *
 * All of it is a read of what the answers add up to. Nothing here decides
 * what is served next; that is next_items() alone. The one write is the
 * learner's own note on a question.
 */
import type {
  DayStatus,
  HistoryEntry,
  Level,
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
} from "../types";
import { buildWordList, type WordEntry, type WordSourceItem } from "../words";
import { supabase } from "../supabase";
import { clipUrl } from "./media";
import { joinHistory, missedWords, type AttemptRow, type HistoryItemRow, type OptionRow } from "./shape";

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

/** How long this learner's latest answers took, newest first, in ms — the
 *  learner's own pace, for how long home says a set will take
 *  (lib/estimate.ts). Answers from an older client carry no time and are
 *  left out. */
export async function fetchRecentPace(limit = 30): Promise<number[]> {
  const { data, error } = await supabase
    .from("attempts")
    .select("elapsed_ms")
    .not("elapsed_ms", "is", null)
    .order("answered_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => row.elapsed_ms as number);
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
  // An unpublished question's answers are skipped, not shown broken (db/shape.ts).
  return joinHistory(
    attempts as AttemptRow[],
    (items.data ?? []) as HistoryItemRow[],
    (options.data ?? []) as OptionRow[],
    (types.data ?? []) as { id: string; label_ja: string }[]
  );
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
  // Newest first, so each word keeps its latest miss (db/shape.ts).
  return missedWords(attempts as { item_id: string; answered_at: string }[], notesOf);
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

/** Keep a note, or remove it when it has been emptied. `userId` is the
 *  session's, as for `updateProfile`. */
export async function saveNote(userId: string, itemId: string, note: string): Promise<void> {
  const text = note.trim();
  if (!text) {
    const { error } = await supabase.from("review_notes").delete().eq("item_id", itemId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("review_notes")
    .upsert({ user_id: userId, item_id: itemId, note: text }, { onConflict: "user_id,item_id" });
  if (error) throw error;
}
