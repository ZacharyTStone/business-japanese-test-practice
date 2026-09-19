/**
 * The shapes the database actually returns.
 *
 * Hand-written rather than generated, because they are the contract this app
 * relies on and a hand-written type is a place to say WHY a field is nullable.
 * When the schema moves, `supabase gen types typescript` is the cross-check:
 * these should agree with it.
 */

export type Level = "J3" | "J2" | "J1";
/** `written` is a tag, never an audio treatment — a 総合読解 item is read, and
 *  nothing about it is ever synthesised. */
export type Channel = "in_person" | "phone" | "video" | "written";

/** The nine BJT problem types, as ids. Kept as a string because the database
 *  owns the list; this alias only documents what the string means. */
export type ItemTypeId = string;

export type Section = "choukai" | "choudokkai" | "dokkai";

/** One turn of a heard conversation.
 *
 *  `speaker_role` rather than a name, because the role is what casts the voice:
 *  a learner who hears a different voice every question is doing speaker
 *  identification instead of listening to Japanese. */
export type DialogueTurn = {
  speaker_role: string;
  text: string;
  clip_id: string | null;
  /** Null while this turn has not been synthesised. The screen shows the text. */
  audio_path: string | null;
};

/** A block of a document stimulus. One shape with optional fields rather than a
 *  union, matching what the database stores — see bjt/render/document.py, which
 *  is where the shape is enforced before an item is ever published. */
export type DocBlock = {
  type:
    | "heading"
    | "paragraph"
    | "bullets"
    | "numbered"
    | "table"
    | "key_values"
    | "quoted_message"
    | "callout";
  text?: string;
  level?: number;
  items?: string[];
  caption?: string;
  columns?: string[];
  rows?: string[][];
  pairs?: { label: string; value: string }[];
  sender?: string;
  sent_at?: string;
  depth?: number;
  tone?: "info" | "warning" | "action";
};

/** A document the learner reads: an email, a schedule, a set of minutes.
 *
 *  Data, never a picture. A screenshot could not be selected, scaled to the
 *  reader's text size, or read aloud — and for a language exam aid, somebody
 *  reading it with their ears is a real case, not a hypothetical. */
export type StimulusDocument = {
  template: string;
  title: string;
  meta: { label: string; value: string }[];
  blocks: DocBlock[];
};

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
  /** Where that picture lives, or null while it does not exist yet. Items are
   *  published long before their artwork, so this is the ordinary case rather
   *  than an error — the screen simply draws the question without it. */
  scene_image_path: string | null;
  speaker_role: string | null;
  listener_role: string | null;
  channel: Channel | null;
  seed_cell_id: string | null;
  correct_index: number;
  explanation_ja: string;
  explanation_en: string;
  vocab_notes: VocabNote[];
  /** The document(s) to read. Always an array, empty for the types that have
   *  none, so a screen branches on length rather than on null. */
  documents: StimulusDocument[];
  /** The conversation to hear, in order. Empty for types with none. */
  dialogue: DialogueTurn[];
  narration_clip_id: string | null;
  narration_path: string | null;
  options: ItemOption[];
  /** How many times this learner has met this item before. 0 means new. */
  times_seen: number;
};

export type VocabNote = { term: string; reading: string; meaning: string };

/** The level being served in one exam section.
 *
 *  Three of these, always — the view fills in J2 for a section nobody has
 *  touched, so a screen never has to branch on a missing row. Moved by
 *  adjust_level() on the evidence of the answers; the client never writes it,
 *  and there is nowhere in the app to choose one. */
export type SectionLevel = {
  section: Section;
  level: Level;
  changed_at: string;
  /** Whether the database has enough of its own evidence to call this a level
   *  rather than a starting point: the section has moved at least once, or has
   *  the answers adjust_level() would judge its first move on. Computed on the
   *  database's terms, so a screen cannot name a level before it could have
   *  been moved. */
  placed: boolean;
};

/** One row from v_my_day: where today stands against the goal and the ceiling.
 *
 *  `max_today` and `left_today` are null for an account whose ceiling is lifted
 *  (a tester exercising the app); `unlimited` says so explicitly. The database
 *  runs the same arithmetic inside next_items(), so what this row says is left
 *  is what the queue will serve. */
export type DayStatus = {
  goal: number;
  answered_today: number;
  unlimited: boolean;
  max_today: number | null;
  left_today: number | null;
};

export type Profile = {
  id: string;
  display_name: string | null;
  /** The one-line summary: the middle of the three section levels. What decides
   *  which questions you get is `SectionLevel`, not this. Moved by the database
   *  as answers come in; the client never writes it. */
  target_level: Level;
  daily_goal: number;
  /** YYYY-MM-DD, or null while they have not said. Drives the countdown. */
  exam_date: string | null;
  /** True until a real identity is linked. Drives the "keep your progress" nudge. */
  is_anonymous: boolean;
  linked_at: string | null;
  /** Whether the reading questions are timed at exam pace. The one thing in the
   *  app a learner chooses, and it is about how they practise rather than about
   *  which questions they are served — `next_items()` has never heard of it. */
  timed_reading: boolean;
};

export type TypeStat = {
  item_type: ItemTypeId;
  label_ja: string;
  section: Section;
  sort_order: number;
  answered: number;
  correct: number;
  /** Null when nothing has been answered — "no data" is not the same as 0%. */
  accuracy: number | null;
  last_answered_at: string | null;
  /** Answers in the last 30 days. */
  recent_answered: number;
  /** Accuracy over every answer, weighted by the queue's own 30-day half-life —
   *  the number the queue actually ranks on. Null when nothing has been answered. */
  recent_accuracy: number | null;
};

export type TagStat = {
  axis: "function" | "relation" | "setting" | "channel";
  tag: string;
  answered: number;
  correct: number;
  accuracy: number;
  /** Answers in the last 30 days. */
  recent_answered: number;
  /** Accuracy over every answer, weighted by the queue's own 30-day half-life —
   *  the number the queue actually ranks on. Null when nothing has been answered. */
  recent_accuracy: number | null;
};

export type RoleTrap = {
  role: string;
  times_chosen: number;
  last_chosen_at: string;
  /** Times this trap caught them in the last 30 days — the window the queue weighs. */
  recent_times: number;
};

/** What the spacing ladder has waiting. One row, always — a learner who has
 *  answered nothing gets zeroes rather than no row, which is why home can print
 *  it without a null check. */
export type ReviewLoad = {
  /** Items the ladder says are due now. The queue serves these first. */
  due_now: number;
  /** Items with a schedule at all — everything ever answered. */
  tracked: number;
  /** When the next one comes due, or null when everything is already due or
   *  nothing is tracked yet. */
  next_due_at: string | null;
};

/** An answered question, held in memory for the duration of one session. */
export type AnsweredItem = {
  item: QueuedItem;
  /** Which option was touched, or `NO_ANSWER` when the clock ran out first. */
  chosenIndex: number;
  isCorrect: boolean;
  /** The role the database graded this answer with — `timed_out` for a question
   *  the clock took. Carried rather than looked up from `chosenIndex`, because
   *  a timeout has no option to look up. */
  role: string;
};

/** What `chosen_index` is for a question nobody answered: the clock ran out.
 *  The column allows it (see the migration that added the reading clock) and the
 *  grading trigger reads it as wrong with the role `timed_out`. Every screen
 *  that indexes `options` by it gets `undefined`, which is the truth. */
export const NO_ANSWER = -1;

/** A past answer, for the review screen. */
export type HistoryEntry = {
  attempt_id: string;
  item_id: string;
  answered_at: string;
  is_correct: boolean;
  chosen_index: number;
  chosen_role: string;
  item_type: ItemTypeId;
  label_ja: string;
  level: Level;
  topic: string;
  stem: string;
  correct_index: number;
  explanation_ja: string;
  explanation_en: string;
  options: ItemOption[];
};
