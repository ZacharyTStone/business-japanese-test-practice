/**
 * The exam date, and the one number it produces.
 *
 * Dates are kept as YYYY-MM-DD strings and compared in JST, the same as the
 * streak: the exam is sat in Japan, and "how many days" should agree with the
 * calendar on the wall there rather than with UTC midnight.
 */
import { tr, type Lang } from "./i18n";

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

/** Today in JST, as the profile stores a date. The floor of the date field:
 *  an exam you are revising for is not one that has already happened. */
export function todayIso(): string {
  return todayJst();
}

/** YYYY-MM-DD, and a day that exists. `2026-02-31` parses in JavaScript and
 *  comes back as 3 March, so the round trip is the check. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * What has been typed into the date field, as YYYY-MM-DD so far.
 *
 * A phone's number pad has no hyphen — iOS's has nothing but digits — so the
 * field takes digits and puts the hyphens in itself: 「20261201」 is
 * 2026-12-01, and 「202612」 on its way there is 2026-12. Anything else typed or
 * pasted is dropped, so a pasted 2026/12/01 comes out right too. A hyphen is
 * only written once a digit follows it, so deleting backwards never meets one
 * the field keeps putting back.
 */
export function typedDate(input: string): string {
  const d = input.replace(/\D/g, "").slice(0, 8);
  if (d.length > 6) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
  if (d.length > 4) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return d;
}

/** 「12月1日」 / "1 Dec" — the exam date as a person would say it. */
export function formatExamDate(examDate: string, lang: Lang = "ja"): string {
  const [, m, d] = examDate.split("-").map(Number);
  return lang === "ja" ? `${m}月${d}日` : `${d} ${MONTH[(m ?? 1) - 1] ?? ""}`;
}

/** The line under the day count. Short, because it sits inside the hero. */
export function countdownLine(days: number | null, lang: Lang = "ja"): string | null {
  if (days === null) return null;
  if (days < 0) return tr(lang, "countdown_past");
  if (days === 0) return tr(lang, "countdown_today");
  return tr(lang, "countdown_days", { n: days });
}

/** The last two weeks before the exam date, today included — the window in
 *  which the queue holds a set to the exam's own section mix and the reading
 *  clock runs whatever the setting says. Fourteen in both places: the queue's
 *  `examIsNear` (worker/core/queue.ts) reads the date between today and
 *  today + its own `EXAM_NEAR_DAYS`, which a test holds equal to this. */
export const EXAM_NEAR_DAYS = 14;

export function examIsNear(examDate: string | null | undefined): boolean {
  const days = daysUntil(examDate);
  return days !== null && days >= 0 && days <= EXAM_NEAR_DAYS;
}
