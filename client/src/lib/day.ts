/**
 * The day, as Japan counts it, and where today stands.
 *
 * The database closes the day at midnight in Japan (`day()`, the streak, the
 * ceiling), whatever clock the device keeps. The screens that say something
 * about the day have to agree with it: when it turns over, what that is on the
 * clock in the learner's hand, and — from the database's own count, never one
 * the app keeps — how big the next set is. Home draws its three states from
 * `dayState` and practice asks for `setSize` questions; the queue does the
 * same arithmetic and caps the set anyway, so the screens and the queue cannot
 * disagree about the day.
 *
 * Plain arithmetic, so `npm test` can hold it with a fixed clock.
 */
import type { DayStatus } from "./types";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** Japan keeps UTC+9 all year: no summer time to account for. */
const JST = 9 * 60 * MINUTE;

/** The Japanese calendar date of an instant, as YYYY-MM-DD. */
export function jstDate(instant: number): string {
  return new Date(instant + JST).toISOString().slice(0, 10);
}

/** The next midnight in Japan after an instant: when the day's count starts again. */
export function nextJstMidnight(instant: number): number {
  return (Math.floor((instant + JST) / DAY) + 1) * DAY - JST;
}

/** Minutes a device's clock is *behind* UTC, as `Date.getTimezoneOffset` says it:
 *  Japan is -540. */
function deviceOffset(instant: number): number {
  return new Date(instant).getTimezoneOffset();
}

/** Whether this device keeps Japan's clock, so "midnight" needs no gloss. */
export function onJapanTime(offsetMinutes: number = deviceOffset(Date.now())): boolean {
  return offsetMinutes === -JST / MINUTE;
}

/** An instant as HH:MM on this device's clock — or on the clock `offsetMinutes`
 *  describes, which is how the tests pin it. */
export function localClock(instant: number, offsetMinutes: number = deviceOffset(instant)): string {
  const wall = new Date(instant - offsetMinutes * MINUTE);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
}

/** How stale a screen about today may get before coming back to it re-reads it. */
export const REFRESH_AFTER_MS = 10 * MINUTE;

/**
 * Whether a screen loaded at `loadedAt` should read again at `now`, on being
 * returned to: the day has turned over in Japan since — the count it shows is
 * yesterday's — or it is simply old. Switching between two browser tabs a
 * dozen times a minute is neither, and costs nothing.
 */
export function shouldRefresh(loadedAt: number, now: number): boolean {
  return jstDate(loadedAt) !== jstDate(now) || now - loadedAt > REFRESH_AFTER_MS;
}

/**
 * `open` — the day's set is not done yet.
 * `bonus` — it is, and the rest of the allowance is on offer as a bonus set.
 * `done` — the day's ceiling is reached: a full stop until midnight in Japan.
 * An account whose ceiling is lifted is never `done`.
 */
export type DayState = "open" | "bonus" | "done";

export function dayState(day: DayStatus): DayState {
  // `left_today` is null only where the ceiling is lifted; anywhere else a
  // missing number is read as nothing left, which is the door's safe side.
  if (!day.unlimited && (day.left_today ?? 0) <= 0) return "done";
  return day.answered_today < day.goal ? "open" : "bonus";
}

/**
 * How many questions to ask the queue for: what the day has left of its set,
 * or the bonus set once the set is done — the rest of the allowance, or a
 * full set for an account whose ceiling is lifted. Never past the ceiling, and
 * zero when the day is over.
 */
export function setSize(day: DayStatus): number {
  const state = dayState(day);
  if (state === "done") return 0;
  const size =
    state === "open" ? day.goal - day.answered_today : day.unlimited ? day.goal : (day.left_today ?? 0);
  return day.unlimited ? size : Math.min(size, day.left_today ?? 0);
}
