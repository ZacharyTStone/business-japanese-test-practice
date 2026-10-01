/**
 * Rows made into what the screens use: the joins and tallies the data layer
 * does once a query has answered.
 *
 * Kept apart from the queries, and from the network, so `npm test`
 * holds them without a network or a client — they are where "an unpublished
 * question's answers are skipped, not broken", "the most recent miss is the
 * one a word points at" and "all four numbers or none" are actually decided.
 */
import type { HistoryEntry, ItemOption, Level, VocabEntry, VocabNote } from "../types";

/** An answer, as `attempts` gives it to the review screen. */
export type AttemptRow = {
  id: string;
  item_id: string;
  answered_at: string;
  is_correct: boolean;
  chosen_index: number;
  chosen_role: string;
};

/** A question, as much of it as the review list shows before it is opened. */
export type HistoryItemRow = {
  id: string;
  item_type: string;
  level: Level;
  topic: string;
  stem: string;
  correct_index: number;
  explanation_ja: string;
  explanation_en: string | null;
};

export type OptionRow = Omit<ItemOption, "clip_id" | "audio_path"> & { item_id: string };

/**
 * Each answer beside its question, newest first as the answers came.
 *
 * An item can be unpublished without deleting the attempts that reference it,
 * so an answer whose question is missing is skipped rather than shown broken.
 * The options come back in their printed order whatever order they were read
 * in, and with no clips: the review list asks for those when an entry opens.
 */
export function joinHistory(
  attempts: AttemptRow[],
  items: HistoryItemRow[],
  options: OptionRow[],
  types: { id: string; label_ja: string }[]
): HistoryEntry[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const labels = new Map(types.map((t) => [t.id, t.label_ja]));
  const optionsById = new Map<string, HistoryEntry["options"]>();
  for (const o of options) {
    const list = optionsById.get(o.item_id) ?? [];
    list.push({ ...o, clip_id: null, audio_path: null });
    optionsById.set(o.item_id, list);
  }

  const out: HistoryEntry[] = [];
  for (const attempt of attempts) {
    const item = byId.get(attempt.item_id);
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
 * The words of the questions that caught this learner, one entry per word.
 *
 * `misses` newest first, so the first time a word is met here is its latest
 * miss: that answer's time and question are the ones the entry keeps, and
 * every other miss on a question carrying the word only adds to the count.
 */
export function missedWords(
  misses: { item_id: string; answered_at: string }[],
  notesOf: Map<string, VocabNote[]>
): VocabEntry[] {
  const byTerm = new Map<string, VocabEntry>();
  for (const miss of misses) {
    for (const note of notesOf.get(miss.item_id) ?? []) {
      const seen = byTerm.get(note.term);
      if (seen) seen.misses += 1;
      else byTerm.set(note.term, { ...note, misses: 1, last_missed_at: miss.answered_at, item_id: miss.item_id });
    }
  }
  return [...byTerm.values()];
}

/**
 * The spoken numbers' clips, in the order of `labels`, or null unless every
 * one of them has one. All four or none: a run that says the number before
 * three of the options and not the fourth is worse than one that says none.
 */
export function allOrNone(
  labels: readonly string[],
  paths: Map<string, string | null>,
  urlOf: (path: string | null) => string | null
): string[] | null {
  const urls = labels.map((label) => urlOf(paths.get(label) ?? null));
  return urls.every((u): u is string => Boolean(u)) ? urls : null;
}
