/**
 * The handoff between the practice screen and the result screen.
 *
 * A module-level variable rather than a context or a query param: it exists for
 * the two seconds between finishing a set and reading the result, and it is
 * genuinely throwaway. Anything that matters is already in the database —
 * `attempts` was written as each question was answered, so a crash here costs
 * the summary screen, not the record.
 */
import type { AnsweredItem, SectionLevel } from "./types";

export type SessionSummary = {
  answers: AnsweredItem[];
  startedAt: number;
  finishedAt: number;
  /** The three levels when the set began, so the result can say which section
   *  moved — which is the useful half of the news. The one-line summary is not
   *  carried: it only moves when the middle of the three does, and by then the
   *  section card has already said something more specific. */
  levelsBefore: SectionLevel[];
};

let lastSummary: SessionSummary | null = null;

export function setSummary(summary: SessionSummary) {
  lastSummary = summary;
}

export function takeSummary(): SessionSummary | null {
  return lastSummary;
}

export function clearSummary() {
  lastSummary = null;
}
