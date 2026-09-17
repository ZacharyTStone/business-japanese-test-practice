/**
 * The three levels, and the handful of things every screen asks about them.
 *
 * The app serves a level per exam section — 聴解, 聴読解, 読解 — because almost
 * nobody is the same at all three, and one number for the whole learner was
 * wrong twice for most people: too easy where they were strong, too hard where
 * they were not. Four screens now want to say something about that, and they
 * should all say it the same way, so the ordering and the comparison live here
 * rather than being reinvented per screen.
 *
 * Nothing here decides anything. The levels are moved by `adjust_level()` in the
 * database, on the evidence of the answers, and whether a level has enough
 * behind it to be printed at all (`placed`) is read from the same view rather
 * than counted here; this is presentation.
 */
import type { Key } from "./i18n";
import type { Level, Section, SectionLevel } from "./types";

/** Exam order, which is the order the score report uses. */
export const SECTION_ORDER: Section[] = ["choukai", "choudokkai", "dokkai"];

/** Short names, for the one line on home where all three appear at once. */
export const SECTION_SHORT: Record<Section, Key> = {
  choukai: "sec_choukai_short",
  choudokkai: "sec_choudokkai_short",
  dokkai: "sec_dokkai_short",
};

/** Full names, for anywhere with room. */
export const SECTION_NAME: Record<Section, Key> = {
  choukai: "sec_choukai",
  choudokkai: "sec_choudokkai",
  dokkai: "sec_dokkai",
};

/** The ladder, for telling up from down. */
export const RANK: Record<Level, number> = { J3: 0, J2: 1, J1: 2 };

export function sortLevels(levels: SectionLevel[]): SectionLevel[] {
  return [...levels].sort(
    (a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section)
  );
}

export function levelOf(levels: SectionLevel[], section: Section): Level | null {
  return levels.find((l) => l.section === section)?.level ?? null;
}

/**
 * Whether a section's level is worth naming yet.
 *
 * The database has to serve *something* from the first question, so a new
 * learner is served the middle of the three levels — but that is a starting
 * point, not a finding about them, and printing "J2" at somebody who has
 * answered nothing is the app stating a conclusion it has no evidence for.
 *
 * The database decides. `v_my_levels.placed` is true once `adjust_level()` has
 * moved the section, or once it has the answers it would judge a first move on
 * — first attempts, at the section's current level, since the last change.
 * This used to be a count of ten answers kept here, but that counted every
 * answer in the section, stretch and below-level items included, and so could
 * name a level before the database had seen enough to move it.
 */
export function isPlaced(levels: SectionLevel[], section: Section): boolean {
  return levels.find((l) => l.section === section)?.placed ?? false;
}

/** The level being served in a section, or null while it is still a guess.
 *  Every screen that prints a level goes through here, so none of them can
 *  show one the answers have not earned. */
export function placedLevel(levels: SectionLevel[], section: Section): Level | null {
  return isPlaced(levels, section) ? levelOf(levels, section) : null;
}

/** The sections with enough answers behind them to be worth printing. */
export function placedLevels(levels: SectionLevel[]): SectionLevel[] {
  return sortLevels(levels).filter((l) => l.placed);
}

/** True while the app is serving the same level everywhere — which is how
 *  everybody starts, and why home does not print three identical numbers at
 *  somebody who has answered nothing yet. */
export function levelsAgree(levels: SectionLevel[]): boolean {
  return levels.length > 0 && levels.every((l) => l.level === levels[0].level);
}

/** Which section moved between two readings, and which way. Null when nothing
 *  did, which is the overwhelmingly common case — a level moves about once a
 *  week, and the result screen asks after every set. */
export function levelMove(
  before: SectionLevel[],
  after: SectionLevel[]
): { section: Section; from: Level; to: Level; direction: 1 | -1 } | null {
  for (const section of SECTION_ORDER) {
    const from = levelOf(before, section);
    const to = levelOf(after, section);
    if (!from || !to || from === to) continue;
    return { section, from, to, direction: RANK[to] > RANK[from] ? 1 : -1 };
  }
  return null;
}
