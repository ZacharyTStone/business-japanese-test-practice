/**
 * How long a set will take, for the line under home's button: 「10問・約12分」.
 *
 * From the learner's own record once there is one: the median time a recent
 * question took them, from the moment it appeared to the answer — the audio
 * included, which is most of a listening question. A median rather than a
 * mean, because one question left open over lunch is not a pace, and each
 * sample is clamped for the same reason.
 *
 * Before there is one, the exam's own pace, as far as the database states it:
 * `item_types.seconds_per_item`, which divides the reading block's thirty
 * minutes between its three types (30 / 45 / 105 s — a minute a question on
 * average). The heard types have no figure there — their audio sets the pace —
 * so until the record says otherwise the reading pace stands in for them too.
 * It replaces a flat 0.6 minutes a question, which undersold a set of ten by
 * about half.
 *
 * Plain arithmetic, so `npm test` holds it.
 */

/** Fewer answers than this are an anecdote, not a pace. */
export const MIN_SAMPLES = 5;

/** A question answered faster than this was a tap, and slower than this was
 *  the kettle; neither is how long a question takes. */
const FLOOR_MS = 5 * 1000;
const CEILING_MS = 5 * 60 * 1000;

/** With no record and no budgets to read: the reading block's own average. */
const FALLBACK_SECONDS = 60;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Seconds a question takes this learner.
 *
 * `recentMs` is the time each of their latest answers took (`attempts.elapsed_ms`,
 * newest first, nulls already dropped); `budgets` the per-type seconds the
 * database gives the self-paced types.
 */
export function secondsPerQuestion(recentMs: number[], budgets: number[]): number {
  const own = recentMs
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .map((ms) => Math.min(CEILING_MS, Math.max(FLOOR_MS, ms)));
  if (own.length >= MIN_SAMPLES) return median(own) / 1000;
  const given = budgets.filter((s) => Number.isFinite(s) && s > 0);
  if (given.length === 0) return FALLBACK_SECONDS;
  return given.reduce((sum, s) => sum + s, 0) / given.length;
}

/** Whole minutes for `n` questions, and never "about 0". */
export function minutesFor(n: number, perQuestionSeconds: number): number {
  return Math.max(1, Math.round((n * perQuestionSeconds) / 60));
}
