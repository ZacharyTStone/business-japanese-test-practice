/**
 * Where today stands, and how big the next set is — from the database's own
 * count (`v_my_day`), never from one the app keeps.
 *
 * Home draws its three states from `dayState` and practice asks for `setSize`
 * questions; next_items() does the same arithmetic and caps the set anyway, so
 * the screens and the queue cannot disagree about the day.
 */
import type { DayStatus } from "./types";

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
