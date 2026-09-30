/**
 * Names the screens share, so that no two screens spell them differently.
 */
import type { Key } from "./i18n";

/** The four options, as the exam's answer sheet names them: digits, 1 to 4,
 *  everywhere a learner sees an option — the badge, the explanation, the review
 *  screen, the number read aloud before each spoken option. Numbers rather than
 *  letters, for the reasons OPTION_LABELS in bjt/tts/plan.py gives. */
export const NUMBERS = ["1", "2", "3", "4"];

/** How the words travel (`items.channel`), as the string table names it. */
export const CHANNEL_KEY: Record<string, Key> = {
  in_person: "ch_in_person",
  phone: "ch_phone",
  video: "ch_video",
  written: "ch_written",
};
