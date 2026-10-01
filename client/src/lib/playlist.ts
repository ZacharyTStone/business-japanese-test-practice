/**
 * What an item plays, in the order it is heard.
 *
 * Pure: the storage URL of a clip is passed in (`clipUrl` in db.ts, in the
 * app), so the order and the all-or-none rule can be tested without a database
 * client — playlist.test.ts.
 */
import type { QueuedItem } from "./types";

/** A clip's playable URL from its storage path, or null while it has none. */
export type ClipUrl = (audioPath: string | null) => string | null;

/** The types whose four options are heard rather than read — which on the exam
 *  is **all of 第1部 聴解**: the screen shows the picture and the bare numerals,
 *  the four candidates are read aloud, and in 総合聴解 there is nothing on the
 *  screen at all. Must agree with TYPE_AUDIO in bjt/tts/plan.py, which is where
 *  the clips come from (tests/test_media.py reads this set to check); an item
 *  whose clips do not exist yet falls back to printed options on its own (see
 *  spokenOptionUrls). */
export const SPOKEN_OPTION_TYPES = new Set([
  "bamen_haaku",
  "gazou_haaku",
  "hatsugen_choukai",
  "sougou_choukai",
]);

/**
 * The four spoken options of an item, when every one of them has a clip.
 *
 * In the exam these are heard, never read: the answer sheet has four numbers
 * and nothing else. So when the audio exists the options are played after the
 * narration and shown as numbers with a replay button, and the text stays
 * hidden until the answer is in. All four or none — a set where three are
 * spoken and one is printed would mark the odd one out, and the type table in
 * bjt/tts/plan.py is the only reason any other type would have option clips.
 */
export function spokenOptionUrls(item: QueuedItem, clipUrl: ClipUrl): string[] | null {
  if (!SPOKEN_OPTION_TYPES.has(item.item_type)) return null;
  const urls = [...item.options]
    .sort((a, b) => a.position - b.position)
    .map((o) => clipUrl(o.audio_path));
  return urls.every((u): u is string => Boolean(u)) ? (urls as string[]) : null;
}

/** Every clip of an item, in the order it is heard: the conversation, then the
 *  question, then — where the options are spoken — the four options, each
 *  behind the number that names it. Turns without a clip yet are skipped, not
 *  waited for, and so are the numbers, which are four clips for the whole
 *  library (fetchOptionLabels) and come all four or not at all. */
export function playlistFor(item: QueuedItem, labels: string[] | null, clipUrl: ClipUrl): string[] {
  const turns = (item.dialogue ?? [])
    .map((t) => clipUrl(t.audio_path))
    .filter((u): u is string => Boolean(u));
  const narration = clipUrl(item.narration_path);
  const spoken = spokenOptionUrls(item, clipUrl) ?? [];
  const options = spoken.flatMap((url, i) => (labels?.[i] ? [labels[i], url] : [url]));
  return [...turns, ...(narration ? [narration] : []), ...options];
}
