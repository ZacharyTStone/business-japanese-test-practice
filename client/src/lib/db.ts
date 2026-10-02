/**
 * Every query the app makes, through one module.
 *
 * Two rules hold throughout:
 *
 * 1. **The app never decides whether an answer was right.** It posts which
 *    option was touched and the database grades it. That keeps the answer key
 *    and the statistics from ever disagreeing, and it means a bug in this file
 *    cannot corrupt someone's weakness profile.
 *
 * 2. **No `select *` over items.** A practice set arrives from one RPC with its
 *    options already attached, because five questions should be one round trip,
 *    not eleven — and on a phone on a train that difference is the difference
 *    between usable and not.
 */
import { clipUrl } from "./db/media";
import { allOrNone } from "./db/shape";
import { call } from "./api";

// The data layer lives in ./db/, a file per concern; this is the one module
// the screens import it through, so a query can move between those files
// without a screen noticing. The option numbers stay here — see below.
export * from "./db/media";
export * from "./db/practice";
export * from "./db/profile";
export * from "./db/record";

/**
 * The four option numbers, spoken.
 *
 * A listening item shows nothing but 1 / 2 / 3 / 4 while its options play, so
 * the clip that says the number is what ties what is being heard to the button
 * that answers it; without it the learner is holding four unlabelled sentences
 * in their head. The exam reads its numbers aloud for the same reason.
 *
 * These are one clip each for the whole library rather than one per item — a
 * clip id is a hash of (voice, channel, text), so 「いち」 is synthesised once
 * and shared — which is why they are looked up by what is said rather than
 * arriving with the item. The four strings and the narrator's name are
 * `OPTION_LABELS` and `NARRATOR_VOICE` in bjt/tts/plan.ts, which is where the
 * clips come from; a test holds the two files equal.
 */
// Numbers rather than letters: 「ビー」/「ディー」 are easily misheard for each
// other, and 「デー」 sounds like "day". See OPTION_LABELS in bjt/tts/plan.ts.
const OPTION_LABELS = ["いち", "に", "さん", "よん"];

const NARRATOR_VOICE = "narrator_f";

/** The four number clips in 1–4 order, or null until every one of them has been
 *  synthesised. All four or none: a run that says the number before three of
 *  the options and not the fourth is worse than one that says none. */
export async function fetchOptionLabels(): Promise<string[] | null> {
  const data = await call<{ text: string; audio_path: string | null }[]>("optionLabels", {
    voice: NARRATOR_VOICE,
    texts: OPTION_LABELS,
  });
  const paths = new Map((data ?? []).map((row) => [row.text as string, row.audio_path as string | null]));
  return allOrNone(OPTION_LABELS, paths, clipUrl);
}
