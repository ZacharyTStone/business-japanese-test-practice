/**
 * What 記録 ranks under the record: the traps that keep catching this learner
 * and the tags they are weakest at.
 *
 * Two windows on one screen, deliberately. The bars and the radar are the
 * record, all-time. These two lists are what the queue is about to do
 * something about, and the queue weighs the last 30 days, so they rank on the
 * same window — otherwise a person could be told they are weak somewhere the
 * queue has stopped aiming at.
 *
 * Plain functions over the views' rows, so `npm test` holds the thresholds and
 * the fallback rather than a reader of the screen.
 */
import type { RoleTrap, TagStat } from "./types";

/** Tags seen fewer times than this are not shown: three answers is a mood, not
 *  a weakness, and presenting it as one sends people off to drill noise.
 *  Counted over the last 30 days, the window the queue weighs. */
export const MIN_ANSWERS_PER_TAG = 4;

/** A trap is ranked by how often it caught them out of how often it was on
 *  offer, and below three offers that share is noise too. */
export const MIN_TIMES_MET = 3;

export type RankedTag = TagStat & { n: number; acc: number };

/**
 * The weakest tags, lowest accuracy first.
 *
 * The queue's window, unless there is nothing in it. Somebody back from a
 * month away has answered nothing in 30 days, and an empty card there says
 * less than the record does, so the whole list falls back to all-time and
 * `recent` is false (the screen drops its "last 30 days" label). It is the
 * whole list or none of it: a per-tag fallback would rank a tag last touched
 * in spring against one answered yesterday on two different scales, which is
 * not a ranking.
 */
export function rankWeakTags(tags: TagStat[], limit = 6): { recent: boolean; rows: RankedTag[] } {
  const recent = tags.some((t) => t.recent_answered > 0);
  const rows = (
    recent
      ? tags
          .filter((t) => t.recent_answered >= MIN_ANSWERS_PER_TAG && t.recent_accuracy !== null)
          .map((t) => ({ ...t, n: t.recent_answered, acc: t.recent_accuracy ?? 0 }))
      : tags.filter((t) => t.answered >= MIN_ANSWERS_PER_TAG).map((t) => ({ ...t, n: t.answered, acc: t.accuracy }))
  )
    .sort((a, b) => a.acc - b.acc)
    .slice(0, limit);
  return { recent, rows };
}

export type RankedTrap = RoleTrap & { n: number; met: number };

/**
 * The traps that caught them most, by share.
 *
 * Same window rule as the tags: the last 30 days, or all-time when nothing is
 * recent. Ranked by the share of the times a trap was on offer that it caught
 * them — a bare count would put the traps that are in every question on top
 * whether or not they are the problem — and, between equal shares, by count.
 * The clock is no option's trap and has no share: it comes back on its own,
 * as `timeouts`, for a line of its own.
 */
export function rankTraps(
  traps: RoleTrap[],
  limit = 5
): { recent: boolean; top: RankedTrap[]; timeouts: RankedTrap | null } {
  const recent = traps.some((t) => t.recent_times > 0);
  const rows = traps.map((tr) => ({
    ...tr,
    n: recent ? tr.recent_times : tr.times_chosen,
    met: (recent ? tr.recent_met : tr.times_met) ?? 0,
  }));
  const timeouts = rows.find((tr) => tr.role === "timed_out" && tr.n > 0) ?? null;
  const top = rows
    .filter((tr) => tr.role !== "timed_out" && tr.n > 0 && tr.met >= MIN_TIMES_MET)
    .sort((a, b) => b.n / b.met - a.n / a.met || b.n - a.n)
    .slice(0, limit);
  return { recent, top, timeouts };
}
