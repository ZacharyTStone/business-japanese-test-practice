/**
 * A set, from the database's side: the queue that picks it, the pace of its
 * reading questions, each answer as it is given, and the two things a learner
 * can say about a question — a report, or (for one account) a veto.
 *
 * The rule the whole data layer keeps is sharpest here: **the app never
 * decides whether an answer was right.** It posts which option was touched and
 * the database grades it.
 */
import type {
  QueuedItem,
} from "../types";
import type { TypePace } from "../pace";
import { supabase } from "../supabase";

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
