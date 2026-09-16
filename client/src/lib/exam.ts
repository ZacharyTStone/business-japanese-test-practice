/**
 * The exam date, and the one number it produces.
 *
 * Dates are kept as YYYY-MM-DD strings and compared in JST, the same as the
 * streak: the exam is sat in Japan, and "how many days" should agree with the
 * calendar on the wall there rather than with UTC midnight.
 */

const DAY = 24 * 3600 * 1000;
const JST = 9 * 3600 * 1000;

function todayJst(): string {
  return new Date(Date.now() + JST).toISOString().slice(0, 10);
}

/** Whole days from today to the exam. Negative once it has passed. */
export function daysUntil(examDate: string | null | undefined): number | null {
  if (!examDate) return null;
  const then = Date.parse(`${examDate}T00:00:00Z`);
  const now = Date.parse(`${todayJst()}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  return Math.round((then - now) / DAY);
}

/** A date n months from today, as the profile stores it. */
export function monthsFromNow(n: number): string {
  const d = new Date(Date.now() + JST);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** 「12月1日」 — the exam date as a person would say it. */
export function formatExamDate(examDate: string): string {
  const [, m, d] = examDate.split("-").map(Number);
  return `${m}月${d}日`;
}

/** The line under the day count. Short, because it sits inside the hero. */
export function countdownLine(days: number | null): string | null {
  if (days === null) return null;
  if (days < 0) return "試験はもう終わりました";
  if (days === 0) return "試験は今日です";
  return `試験まであと${days}日`;
}
