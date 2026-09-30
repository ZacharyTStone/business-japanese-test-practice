/**
 * The day, as Japan counts it.
 *
 * The database closes the day at midnight in Japan (`v_my_day`, the streak, the
 * ceiling), whatever clock the device keeps. The screens that say something
 * about the day have to agree with it: when it turns over, and what that is
 * on the clock in the learner's hand.
 *
 * Plain arithmetic on instants, so `npm test` can hold it with a fixed clock.
 */
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
