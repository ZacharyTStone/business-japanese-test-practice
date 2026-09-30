/**
 * The outbox (src/lib/outbox.ts), wired to the database: `recordAttempt` posts
 * an answer, and `findAttempt` asks whether an entry already landed before it is
 * sent again. Both queries live in the data layer (src/lib/db/practice.ts).
 */
import { findAttempt, recordAttempt } from "./db";
import { makeOutbox, type AttemptArgs, type FlushResult, type Graded, type Sender, type SendOutcome } from "./outbox";

const sender: Sender = { post: recordAttempt, find: findAttempt };
const outbox = makeOutbox();

/** Post an answer; queue it if it never arrived. */
export function sendAnswer(userId: string, args: AttemptArgs): Promise<SendOutcome> {
  return outbox.send(userId, args, sender, Date.now());
}

/** Post an answer again after an error the database gave: sent only if the
 *  learner's own attempts do not already have it. */
export function sendAnswerAgain(userId: string, args: AttemptArgs): Promise<SendOutcome> {
  return outbox.sendAgain(userId, args, sender, Date.now());
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
