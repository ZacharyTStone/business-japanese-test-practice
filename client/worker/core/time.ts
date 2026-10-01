/**
 * Time, as the database stores it and as Japan counts it.
 *
 * Every timestamp is UTC ISO-8601 text with milliseconds — what
 * `Date.prototype.toISOString` writes and what SQLite's
 * strftime('%Y-%m-%dT%H:%M:%fZ', 'now') writes — so strings sort as time
 * does and the two writers agree. A day is a Japanese calendar day: it starts
 * at 15:00 UTC the day before, every day of the year, because Japan has no
 * daylight saving time.
 */

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
const JST = 9 * HOUR;

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Milliseconds since the epoch, from a stored timestamp. */
export function ms(stamp: string): number {
  const t = Date.parse(stamp);
  if (Number.isNaN(t)) throw new Error(`not a timestamp: ${stamp}`);
  return t;
}

/** The instant today began in Japan. */
export function jstDayStart(now: number): number {
  return Math.floor((now + JST) / DAY) * DAY - JST;
}

/** The Japanese calendar date of an instant, as YYYY-MM-DD. */
export function jstDate(at: number): string {
  return new Date(at + JST).toISOString().slice(0, 10);
}

/** Midnight in Japan at the start of a YYYY-MM-DD date. */
export function jstMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00+09:00`);
}

/** A YYYY-MM-DD date moved by whole days. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Half-life weighting of an answer: one month old counts half. */
export function recency(answeredAt: string, now: number): number {
  return Math.pow(0.5, (now - ms(answeredAt)) / 1000 / (30 * 86_400));
}
