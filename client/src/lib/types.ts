/**
 * The shapes the database actually returns.
 *
 * Hand-written rather than generated, because they are the contract this app
 * relies on and a hand-written type is a place to say WHY a field is nullable.
 * When the schema moves, `supabase gen types typescript` is the cross-check:
 * these should agree with it.
 */

export type Level = "J3" | "J2" | "J1";
export type Channel = "in_person" | "phone" | "video";
export type PracticeMode = "daily" | "weakness" | "mock" | "free";

/** The nine BJT problem types, as ids. Kept as a string because the database
 *  owns the list; this alias only documents what the string means. */
export type ItemTypeId = string;

export type ItemOption = {
  position: number;
  text: string;
  /** Why this option is wrong, as a category. For our reporting, not for display. */
  role: string;
  /** One sentence on what is wrong with THIS wording here. This is the thing a
   *  learner reads after answering, so it is never empty by the time it ships. */
  why: string;
  /** Null until the utterance has been synthesised. */
  clip_id: string | null;
  /** Storage path for that clip, or null while it does not exist yet. The screen
   *  is built to work either way — audio is added to items after they ship. */
  audio_path: string | null;
};

/** One row from the next_items() RPC — an item plus everything the screen needs. */
export type QueuedItem = {
  id: string;
  item_type: ItemTypeId;
  level: Level;
  topic: string;
  stem: string;
  /** Which reusable picture this is set in. Null for types that have no picture. */
  scene_id: string | null;
  speaker_role: string | null;
  listener_role: string | null;
  channel: Channel | null;
  seed_cell_id: string | null;
  correct_index: number;
  explanation_ja: string;
  explanation_en: string;
  vocab_notes: VocabNote[];
  narration_clip_id: string | null;
  narration_path: string | null;
  options: ItemOption[];
  /** How many times this learner has met this item before. 0 means new. */
  times_seen: number;
};

export type VocabNote = { term: string; reading: string; meaning: string };

export type Profile = {
  id: string;
  display_name: string | null;
  target_level: Level;
  daily_goal: number;
  /** True until a real identity is linked. Drives the "keep your progress" nudge. */
  is_anonymous: boolean;
  linked_at: string | null;
};

export type TypeStat = {
  item_type: ItemTypeId;
  label_ja: string;
  section: "choukai" | "choudokkai" | "dokkai";
  sort_order: number;
  answered: number;
  correct: number;
  /** Null when nothing has been answered — "no data" is not the same as 0%. */
  accuracy: number | null;
  last_answered_at: string | null;
};

export type TagStat = {
  axis: "function" | "relation" | "setting" | "channel";
  tag: string;
  answered: number;
  correct: number;
  accuracy: number;
};

export type RoleTrap = {
  role: string;
  times_chosen: number;
  last_chosen_at: string;
};

/** An answered question, held in memory for the duration of one session. */
export type AnsweredItem = {
  item: QueuedItem;
  chosenIndex: number;
  isCorrect: boolean;
};
