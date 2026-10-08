/**
 * The record, read back: the three levels, the statistics 記録 draws, today
 * against the goal, the answered questions and what each one taught — its
 * words, its sentence, the learner's note on it.
 *
 * All of it is a read of what the answers add up to. Nothing here decides
 * what is served next; that is the queue alone. The one write is the
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
import { call } from "../api";
import { clipUrl } from "./media";
import { joinHistory, missedWords, type AttemptRow, type HistoryItemRow, type OptionRow } from "./shape";

/** The three levels being served, one per exam section.
 *
 *  Always three rows: `myLevels()` (worker/core/levels.ts) fills in J2 for a
 *  section nobody has answered in yet. Shown, never chosen — there is no screen
 *  in this app where a level is a control, and no query writes one. `placed`
 *  comes from the same function, so whether a level is worth printing is the
 *  database's call and not a count the app keeps on its own. */
export async function fetchSectionLevels(): Promise<SectionLevel[]> {
  return (await call<SectionLevel[]>("sectionLevels")) ?? [];
}

/** The radar. All nine types come back, including untouched ones — "not tried
 *  yet" is the most useful thing this can say early on, and a chart that hides
 *  the gaps is worse than no chart. */
export async function fetchTypeStats(): Promise<TypeStat[]> {
  return (await call<TypeStat[]>("typeStats")) ?? [];
}

export async function fetchTagStats(): Promise<TagStat[]> {
  return (await call<TagStat[]>("tagStats")) ?? [];
}

/** Which traps keep catching this person. The most actionable thing in the app. */
export async function fetchRoleTraps(): Promise<RoleTrap[]> {
  return (await call<RoleTrap[]>("roleTraps")) ?? [];
}

/** How many lessons are due. Home says it in the button's second line, because
 *  "ten questions, three of them on traps that caught you" is what the set is. */
export async function fetchReviewLoad(): Promise<ReviewLoad> {
  return call<ReviewLoad>("reviewLoad");
}

/** How long this learner's latest answers took, newest first, in ms — the
 *  learner's own pace, for how long home says a set will take
 *  (lib/estimate.ts). Answers from an older client carry no time and are
 *  left out. */
export async function fetchRecentPace(limit = 30): Promise<number[]> {
  const data = await call<{ elapsed_ms: number }[]>("recentPace", { limit });
  return (data ?? []).map((row) => row.elapsed_ms);
}

export async function fetchStreak(): Promise<number> {
  return (await call<number | null>("streak")) ?? 0;
}

/** Today, against the goal and the ceiling.
 *
 *  Always one row. The day ends at midnight in Japan and the Worker does that
 *  arithmetic (`day()`, worker/core/record.ts), so the app never has to guess
 *  the date. Home sizes its button from this and shows the "done" screen from
 *  it; practice sizes its set from it — and the queue would cap the set anyway,
 *  so the two cannot disagree. */
export async function fetchDay(): Promise<DayStatus> {
  return call<DayStatus>("day");
}

/**
 * Past answers, newest first — the review screen.
 *
 * No query updates or deletes an answer: an answer already given is history,
 * and this is the screen that treats it as such. The answers, their
 * questions, their options and the type labels come back in one request and
 * are joined here.
 */
export async function fetchHistory(limit = 50, itemId?: string): Promise<HistoryEntry[]> {
  // One question's answers, when the review screen is opened from a word on
  // the vocabulary screen: that question may be older than the latest fifty.
  const found = await call<{
    attempts: AttemptRow[];
    items: HistoryItemRow[];
    options: OptionRow[];
    types: { id: string; label_ja: string }[];
  }>("history", { limit, itemId: itemId ?? null });
  if (!found.attempts.length) return [];
  // An unpublished question's answers are skipped, not shown broken (db/shape.ts).
  return joinHistory(found.attempts, found.items, found.options, found.types);
}

/** A question's lines and every clip they point at — what the review screen
 *  and a word's sentence both read (worker/queries.ts, itemDetail). */
type ItemDetailRows = {
  item: {
    stem: string;
    documents: StimulusDocument[] | null;
    dialogue: { speaker_role: string; text: string; clip_id: string | null }[] | null;
    vocab_notes: VocabNote[] | null;
    narration_clip_id: string | null;
  };
  options: { position: number; text: string; clip_id: string | null }[];
  clips: { id: string; audio_path: string | null }[];
};

/**
 * The rest of one past question — its documents, its conversation and
 * narration with their clips, its spoken options' clips and its notes — for
 * the moment an entry on the review screen is opened.
 *
 * Fetched per entry rather than with the list: fifty conversations and their
 * documents is a lot to carry for a list most people scroll past. Opening one
 * entry is one small request.
 */
export async function fetchReviewDetail(itemId: string): Promise<ReviewDetail> {
  const { item, options, clips } = await call<ItemDetailRows>("itemDetail", { itemId });
  const paths = new Map(clips.map((clip) => [clip.id, clip.audio_path]));
  const pathOf = (id: string | null) => (id ? (paths.get(id) ?? null) : null);

  const turns = item.dialogue ?? [];
  const optionAudio: Record<number, string | null> = {};
  for (const o of options) optionAudio[o.position] = pathOf(o.clip_id);

  return {
    documents: item.documents ?? [],
    dialogue: turns.map((turn) => ({ ...turn, clip_id: turn.clip_id ?? null, audio_path: pathOf(turn.clip_id) })),
    narration_path: pathOf(item.narration_clip_id),
    option_audio: optionAudio,
    vocab_notes: item.vocab_notes ?? [],
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
 * decided by the queue alone.
 */
export async function fetchVocab(limit = 200): Promise<VocabEntry[]> {
  const { attempts, items } = await call<{
    attempts: { item_id: string; answered_at: string }[];
    items: { id: string; vocab_notes: VocabNote[] | null }[];
  }>("vocab", { limit });
  if (!attempts.length) return [];
  const notesOf = new Map(items.map((i) => [i.id, i.vocab_notes ?? []]));
  // Newest first, so each word keeps its latest miss (db/shape.ts).
  return missedWords(attempts, notesOf);
}

/**
 * The line of a question a word was met in — a turn of the conversation, the
 * narration, or an option — with its clip when that has been synthesised.
 *
 * A word learnt from a list is a word that is recognised on a list. The exam
 * says it in a sentence, at speed, so this finds the sentence. Asked for one
 * word at a time, when its entry is opened. Null when the word does not appear
 * as written — a note may give the dictionary form of a verb that the
 * question conjugates.
 */
export async function fetchTermSentence(itemId: string, term: string): Promise<TermSentence | null> {
  const { item, options, clips } = await call<ItemDetailRows>("itemDetail", { itemId });
  const lines: { text: string; clip_id: string | null }[] = [
    ...(item.dialogue ?? []),
    { text: item.stem, clip_id: item.narration_clip_id },
    ...options,
  ];
  const line = lines.find((l) => l.text?.includes(term));
  if (!line) return null;
  const path = line.clip_id ? (clips.find((clip) => clip.id === line.clip_id)?.audio_path ?? null) : null;
  return { text: line.text, url: clipUrl(path) };
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
 * One request: the Worker reads the answered questions, their correct
 * options and the sections in one batch, narrowed to this learner's attempts
 * and to published questions, so a withdrawn one's words go with it.
 */
export async function fetchWordList(): Promise<WordEntry[]> {
  const { items, correct, types } = await call<{
    items: {
      id: string;
      item_type: string;
      level: Level;
      stem: string | null;
      dialogue: { text: string }[] | null;
      documents: StimulusDocument[] | null;
      vocab_notes: VocabNote[] | null;
    }[];
    correct: { item_id: string; text: string }[];
    types: { id: string; section: Section }[];
  }>("wordList");
  if (items.length === 0) return [];
  const sectionOf = new Map(types.map((t) => [t.id, t.section]));
  const answerOf = new Map(correct.map((o) => [o.item_id, o.text]));
  const sources: WordSourceItem[] = items.map((i) => ({
    id: i.id,
    level: i.level,
    section: sectionOf.get(i.item_type) ?? "dokkai",
    stem: i.stem ?? "",
    dialogue: i.dialogue ?? [],
    documents: i.documents ?? [],
    vocab_notes: i.vocab_notes ?? [],
    correct_text: answerOf.get(i.id) ?? null,
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
  const data = await call<{ item_id: string; note: string }[]>("notes", { itemIds });
  return Object.fromEntries((data ?? []).map((row) => [row.item_id, row.note]));
}

/** Keep a note, or remove it when it has been emptied. */
export async function saveNote(itemId: string, note: string): Promise<void> {
  await call("saveNote", { itemId, note: note.trim() });
}
