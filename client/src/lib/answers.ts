/**
 * The outbox (src/lib/outbox.ts), wired to the database.
 *
 * One query of its own beside `recordAttempt`: whether this learner already has
 * the attempt an entry describes, asked before the entry is sent again. Row-level
 * security scopes `attempts` to the signed-in learner, so nothing here names
 * anybody.
 */
import { recordAttempt } from "./db";
import { makeOutbox, type AttemptArgs, type FlushResult, type Graded, type Sender, type SendOutcome } from "./outbox";
import { supabase } from "./supabase";

/**
 * The attempt this entry describes, if the database already has it: same item,
 * option, timings and replays. Two answers to one question agreeing to the
 * millisecond on how long each took is not a thing that happens, so a match is
 * this answer, landed after all.
 *
 * The timings are compared here rather than in the filter because `think_ms`
 * may be null, which an equality filter never matches.
 */
async function findAttempt(args: AttemptArgs): Promise<Graded | null> {
  const { data, error } = await supabase
    .from("attempts")
    .select("is_correct, chosen_role, elapsed_ms, think_ms")
    .eq("item_id", args.itemId)
    .eq("chosen_index", args.chosenIndex)
    .eq("replays", args.replays)
    .order("answered_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const row = (data ?? []).find(
    (r) => (r.elapsed_ms ?? null) === args.elapsedMs && (r.think_ms ?? null) === args.thinkMs
  );
  return row ? { isCorrect: row.is_correct as boolean, chosenRole: row.chosen_role as string } : null;
}

const sender: Sender = { post: recordAttempt, find: findAttempt };
const outbox = makeOutbox();

/** Post an answer; queue it if it never arrived. */
export function sendAnswer(userId: string, args: AttemptArgs): Promise<SendOutcome> {
  return outbox.send(userId, args, sender, Date.now());
}

/** Send whatever is waiting for this learner. Never rejects: a flush that could
 *  not run is a flush that left everything where it was. */
export async function flushAnswers(userId: string): Promise<FlushResult> {
  try {
    return await outbox.flush(userId, sender);
  } catch {
    return { saved: [], dropped: [], left: -1 };
  }
}

/** The same, but given up on after `ms` — for the moment before a screen
 *  changes, which should not wait on a connection that is not coming back. The
 *  flush itself carries on; only the waiting stops. */
export function flushAnswersWithin(userId: string, ms: number): Promise<FlushResult> {
  return Promise.race([
    flushAnswers(userId),
    new Promise<FlushResult>((resolve) => setTimeout(() => resolve({ saved: [], dropped: [], left: -1 }), ms)),
  ]);
}

export type { AttemptArgs, FlushResult, Graded, SendOutcome };
