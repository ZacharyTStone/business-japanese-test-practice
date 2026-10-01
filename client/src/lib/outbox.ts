/**
 * Answers the database has not got yet.
 *
 * An answer is written the moment it is given (see `recordAttempt`), and the
 * database grades it. When that insert cannot reach the database — a tunnel on
 * the Yamanote line, a phone between two networks — the answer used to be
 * graded on the phone for the verdict card and then forgotten: gone from the
 * day's count, from the level's window and from the spacing ladder, while the
 * result screen went on showing it. This is where it waits instead.
 *
 * Four decisions worth stating:
 *
 * **It holds the insert, never a grade.** An entry is exactly what the client
 * is allowed to post — item, option, session, timings, help taken — and the
 * database grades it when it arrives, as it grades every answer. The phone's
 * own reading of the answer key is only ever for the card on the screen.
 *
 * **Only an answer that never arrived is retried by itself.** A request that
 * failed to reach the server (`errorKind` says offline) is queued and sent again
 * when there is a reason to think the connection is back: the next answer, the
 * app coming to the front, the end of the set. A request the server answered
 * with an error is shown as one, with a button, because sending the same thing
 * again by itself would only get the same answer.
 *
 * **Sent twice is recorded once.** "Failed to fetch" can mean the insert landed
 * and the reply was lost. So before an entry is sent again the learner's own
 * attempts are asked for one with the same item, option, timings and replays —
 * row-level security scopes the question to them — and a match counts as sent.
 *
 * **The day's door and the bank still decide.** An entry the database refuses
 * because the day is over (`daily_limit_reached`) or the question is gone
 * (`item_unavailable`) is dropped rather than kept: the door is the database's,
 * and holding the answer for tomorrow would count it against a day it was not
 * given in.
 *
 * Kept free of the network so it runs in Node; `src/lib/answers.ts`
 * wires it to the database. The queue is per account, because the database
 * files an insert under whoever is signed in when it arrives.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { errorKind } from "./errors";

/** The insert, as `recordAttempt` takes it: everything a client may send. */
export type AttemptArgs = {
  itemId: string;
  chosenIndex: number;
  sessionId: string | null;
  elapsedMs: number | null;
  thinkMs: number | null;
  replays: number;
  peeked: boolean;
  standsFor: string | null;
};

/** The database's verdict on an answer. */
export type Graded = { isCorrect: boolean; chosenRole: string };

export type OutboxEntry = {
  /** Unique within the queue. */
  key: string;
  args: AttemptArgs;
  queuedAt: number;
  /** Times the database answered this entry with an error that was not a
   *  refusal. Such an entry is given up on at MAX_FAILURES, so one malformed
   *  answer cannot sit at the front of the queue for ever. */
  failures: number;
};

/** What the two sides of the network are, for the queue. */
export type Sender = {
  post: (args: AttemptArgs) => Promise<Graded>;
  /** This learner's own attempt that matches the entry, if one exists. */
  find: (args: AttemptArgs) => Promise<Graded | null>;
};

/** Enough of AsyncStorage for the queue; a Map-backed one stands in for tests. */
export type KeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

/** Why the database will not take an answer, when it says why. */
export type Refusal = "day_over" | "unavailable";

/** The database's two refusals on an attempts insert, read from the hint it
 *  raises them with — the message is for people and may be reworded. */
export function refusalOf(e: unknown): Refusal | null {
  const hint = e && typeof e === "object" ? (e as { hint?: unknown }).hint : undefined;
  if (hint === "daily_limit_reached") return "day_over";
  if (hint === "item_unavailable") return "unavailable";
  return null;
}

/** What became of one answer sent now. */
export type SendOutcome =
  | { kind: "saved"; graded: Graded }
  /** Never arrived; in the queue, and will be sent again. */
  | { kind: "queued" }
  | { kind: "day_over" }
  | { kind: "unavailable" }
  /** The database answered with an error that is neither refusal. */
  | { kind: "failed"; error: unknown };

/** What a flush did. Saved and dropped entries are named by item: a set holds
 *  a question once, so that is how the screen finds the answer to update. */
export type FlushResult = {
  saved: { itemId: string; graded: Graded }[];
  dropped: { itemId: string; reason: Refusal | "failed" }[];
  /** Entries still waiting. */
  left: number;
};

export const MAX_FAILURES = 3;

const storageKey = (userId: string) => `attempt_outbox:${userId}`;

export function makeOutbox(store: KeyValueStore = AsyncStorage) {
  // Two locks. `edit` makes every read-modify-write of the stored list atomic,
  // so an answer queued in the middle of a flush is not written over by it.
  // `flushing` keeps to one flush at a time, so two triggers arriving together
  // (the app coming back to the front as an answer is given) cannot both send
  // the same entry.
  let edits: Promise<unknown> = Promise.resolve();
  let flushing: Promise<FlushResult> | null = null;

  async function read(userId: string): Promise<OutboxEntry[]> {
    try {
      const raw = await store.getItem(storageKey(userId));
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
    } catch {
      return [];
    }
  }

  function edit(userId: string, change: (entries: OutboxEntry[]) => OutboxEntry[]): Promise<OutboxEntry[]> {
    const next = edits.then(async () => {
      const entries = change(await read(userId));
      if (entries.length) await store.setItem(storageKey(userId), JSON.stringify(entries));
      else await store.removeItem(storageKey(userId));
      return entries;
    });
    // A failed write must not jam every later one behind it.
    edits = next.catch(() => undefined);
    return next;
  }

  async function enqueue(userId: string, args: AttemptArgs, now: number): Promise<OutboxEntry> {
    const entry: OutboxEntry = {
      key: `${args.itemId}:${args.chosenIndex}:${now}:${Math.random().toString(36).slice(2, 8)}`,
      args,
      queuedAt: now,
      failures: 0,
    };
    await edit(userId, (entries) => [...entries, entry]);
    return entry;
  }

  async function runFlush(userId: string, sender: Sender): Promise<FlushResult> {
    const entries = await read(userId);
    const result: FlushResult = { saved: [], dropped: [], left: 0 };
    const done = new Set<string>();
    const failed = new Map<string, number>();
    for (const entry of entries) {
      try {
        const graded = (await sender.find(entry.args)) ?? (await sender.post(entry.args));
        result.saved.push({ itemId: entry.args.itemId, graded });
        done.add(entry.key);
      } catch (e) {
        // Still offline: the rest would fail the same way. Keep them, in order.
        if (errorKind(e) === "offline") break;
        const refusal = refusalOf(e);
        if (refusal) {
          result.dropped.push({ itemId: entry.args.itemId, reason: refusal });
          done.add(entry.key);
        } else if (entry.failures + 1 >= MAX_FAILURES) {
          result.dropped.push({ itemId: entry.args.itemId, reason: "failed" });
          done.add(entry.key);
        } else {
          failed.set(entry.key, entry.failures + 1);
        }
      }
    }
    const kept = await edit(userId, (current) =>
      current
        .filter((e) => !done.has(e.key))
        .map((e) => (failed.has(e.key) ? { ...e, failures: failed.get(e.key)! } : e))
    );
    result.left = kept.length;
    return result;
  }

  /** Send whatever is waiting, oldest first. Resolves once the queue has been
   *  tried; a flush already running is joined rather than doubled. */
  function flush(userId: string, sender: Sender): Promise<FlushResult> {
    if (!flushing) {
      flushing = runFlush(userId, sender).finally(() => {
        flushing = null;
      });
    }
    return flushing;
  }

  /** Post one answer now; queue it if it never arrived. */
  async function send(userId: string, args: AttemptArgs, sender: Sender, now: number): Promise<SendOutcome> {
    try {
      return { kind: "saved", graded: await sender.post(args) };
    } catch (e) {
      if (errorKind(e) === "offline") {
        // Queued only once it is written down: an answer the phone could not
        // store either is a failure to say so, not a promise to send it later.
        try {
          await enqueue(userId, args, now);
          return { kind: "queued" };
        } catch {
          return { kind: "failed", error: e };
        }
      }
      const refusal = refusalOf(e);
      if (refusal) return { kind: refusal };
      return { kind: "failed", error: e };
    }
  }

  /** Post an answer again, by hand, after the database answered it with an
   *  error. Asked first whether it landed after all — an error can come back
   *  from a proxy after the insert committed — and posted only if not. */
  async function sendAgain(userId: string, args: AttemptArgs, sender: Sender, now: number): Promise<SendOutcome> {
    try {
      const found = await sender.find(args);
      if (found) return { kind: "saved", graded: found };
    } catch {
      // Not known: send it, and let what the send meets decide.
    }
    return send(userId, args, sender, now);
  }

  return { read, enqueue, flush, send, sendAgain };
}

export type Outbox = ReturnType<typeof makeOutbox>;
