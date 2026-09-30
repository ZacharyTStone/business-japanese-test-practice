/**
 * The reading clock's arithmetic, without React.
 *
 * ui/clock.tsx draws the bar and owns the interval; everything it decides —
 * where the deadline is, what is left, whether the time has just run out — is
 * a function of this value and the time now, so the rules can be checked in
 * Node (clock.test.ts) rather than trusted to the order effects happen to run
 * in.
 *
 * The rule the value exists to keep: **a clock belongs to one question.** It
 * is made for a `runKey` (the item id) and a budget, and a different key or
 * budget is a new clock at the full budget — never the old one's leftovers.
 * The first version kept "what is left" in component state and rebuilt the
 * deadline from it when the next question started running, in the same commit
 * that reset it; the reset had not landed yet, so the new question began with
 * the old one's remainder, and after one time-out every following reading
 * question expired within a tick and was posted as an answer nobody gave.
 */

export type Clock = {
  /** The question this clock times. */
  runKey: string;
  /** Its whole budget. */
  totalMs: number;
  /** What is left, as of the last pause or tick. */
  remainingMs: number;
  /** When it runs out, while it is running; null while it is held. */
  deadline: number | null;
  /** Whether it has already said so. It says so once. */
  fired: boolean;
};

export function newClock(runKey: string, totalMs: number): Clock {
  return { runKey, totalMs, remainingMs: totalMs, deadline: null, fired: false };
}

/** The clock for this question: the same one while the key and the budget
 *  hold, a full new one the moment either changes. */
export function clockFor(clock: Clock, runKey: string, totalMs: number): Clock {
  return clock.runKey === runKey && clock.totalMs === totalMs ? clock : newClock(runKey, totalMs);
}

/** Start or resume counting. The deadline moves with the pause: time spent held
 *  is not spent. Resuming a clock that is already running changes nothing. */
export function resume(clock: Clock, now: number): Clock {
  if (clock.deadline !== null) return clock;
  return { ...clock, deadline: now + clock.remainingMs };
}

/** Hold the clock at what it reads now. */
export function pause(clock: Clock, now: number): Clock {
  if (clock.deadline === null) return clock;
  return { ...clock, remainingMs: Math.max(0, clock.deadline - now), deadline: null };
}

/** Read the clock. `expired` is true on exactly one reading: the first one at
 *  or past the deadline. */
export function tick(clock: Clock, now: number): { clock: Clock; expired: boolean } {
  if (clock.deadline === null) return { clock, expired: false };
  const remainingMs = Math.max(0, clock.deadline - now);
  const expired = remainingMs <= 0 && !clock.fired;
  return { clock: { ...clock, remainingMs, fired: clock.fired || expired }, expired };
}

/** Below this share of the budget the bar goes amber, and below the second it
 *  goes red: roughly "a quarter left" and "nearly gone", which is what a
 *  person glancing at it needs to know. A screen reader hears the same two
 *  moments, once each, since it cannot glance at the colour. */
export const WARN_AT = 0.25;
export const URGENT_AT = 0.1;

/** Which of the two warnings a reading from `beforeMs` to `afterMs` crossed —
 *  so each is said once, on the tick that crosses it, and not on every tick
 *  after. A reading that jumps past both (a phone that slept) says the later. */
export function warningCrossed(beforeMs: number, afterMs: number, totalMs: number): number | null {
  const before = beforeMs / totalMs;
  const after = afterMs / totalMs;
  if (afterMs <= 0) return null;
  if (before > URGENT_AT && after <= URGENT_AT) return URGENT_AT;
  if (before > WARN_AT && after <= WARN_AT) return WARN_AT;
  return null;
}


/** mm:ss, floored at zero. Seconds are rounded UP so the clock reads 1:00 for
 *  the whole first second rather than flicking to 0:59 immediately. */
export function clockFace(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
