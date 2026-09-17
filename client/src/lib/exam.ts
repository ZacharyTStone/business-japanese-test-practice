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
