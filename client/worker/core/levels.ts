/**
 * The three levels — one per exam section — and the evidence they move on.
 *
 * Ported from level_evidence(), adjust_level(), questions_left() and the
 * v_my_levels view. The window is ten first attempts at the level (twenty
 * once the section has a record), never more than the questions the level has
 * left for this learner, never judged on fewer than five; nobody moves into a
 * level with fewer than five questions left to meet. An answer after a replay
 * or with the spoken options read counts for neither direction.
 */
import { before, SECTIONS, type Answer, type BankItem, type Level, type Section, type Snapshot } from "./snapshot";

export type Evidence = { level: Level; since: string | null; window: number; answered: number; correct: number };

const UP: Record<Level, Level | null> = { J3: "J2", J2: "J1", J1: null };
const DOWN: Record<Level, Level | null> = { J1: "J2", J2: "J3", J3: null };
export const up = (l: Level) => UP[l];
export const down = (l: Level) => DOWN[l];

type First = Answer & { item: BankItem; helped: boolean };

/** Each question's first answer by this learner, in a section, among
 *  published questions — the only answers a level is judged on. */
function firstsIn(snap: Snapshot, section: Section): First[] {
  const seen = new Set<string>();
  const out: First[] = [];
  // Answers are oldest first, so the first one met for an item is its first.
  for (const a of snap.answers) {
    if (seen.has(a.item_id)) continue;
    seen.add(a.item_id);
    const item = snap.items.get(a.item_id);
    if (!item || !item.is_published || item.section !== section) continue;
    out.push({ ...a, item, helped: a.replays > 0 || a.peeked });
  }
  return out;
}

export function levelEvidence(snap: Snapshot, section: Section): Evidence {
  const row = snap.levels.get(section);
  const level: Level = row?.level ?? "J2";
  const since = row?.changed_at ?? null; // null: -infinity
  const firsts = firstsIn(snap, section);

  // The questions at this level the learner can still meet: servable ones in
  // the section, less those first answered before the level was reached.
  const answeredBefore = new Set(firsts.filter((f) => since !== null && f.answered_at < since).map((f) => f.item_id));
  let shelf = 0;
  for (const item of snap.items.values()) {
    if (item.section === section && item.level === level && item.servable && !answeredBefore.has(item.id)) shelf++;
  }

  const window = Math.min(firsts.length < 20 ? 10 : 20, shelf);
  const recent = firsts
    .filter((f) => f.item.level === level && (since === null || f.answered_at >= since) && !f.helped)
    .sort((a, b) => (before(a, b) ? 1 : before(b, a) ? -1 : 0))
    .slice(0, Math.max(window, 0));
  return {
    level,
    since,
    window,
    answered: recent.length,
    correct: recent.filter((f) => f.is_correct).length,
  };
}

/** Servable questions at a level in a section this learner has never answered. */
export function questionsLeft(snap: Snapshot, section: Section, level: Level): number {
  const met = new Set(snap.answers.map((a) => a.item_id));
  let n = 0;
  for (const item of snap.items.values()) {
    if (item.section === section && item.level === level && item.servable && !met.has(item.id)) n++;
  }
  return n;
}

/** Where a section's level goes on this evidence, or null to stay. */
export function nextLevel(snap: Snapshot, section: Section): Level | null {
  const ev = levelEvidence(snap, section);
  let next: Level | null = null;
  if (ev.window >= 5 && ev.answered >= ev.window) {
    if (ev.correct * 10 >= ev.window * 8) next = up(ev.level);
    else if (ev.correct * 10 <= ev.window * 4) next = down(ev.level);
  }
  if (next !== null && questionsLeft(snap, section, next) < 5) next = null;
  return next;
}

/** The one-line summary: the middle of the three. */
export function overallLevel(levels: Level[]): Level | null {
  if (levels.length < 2) return null;
  const order: Record<Level, number> = { J3: 0, J2: 1, J1: 2 };
  return [...levels].sort((a, b) => order[a] - order[b])[1];
}

export type ShownLevel = { section: Section; level: Level; changed_at: string; placed: boolean };

/** v_my_levels: the three levels as shown, and whether each is worth printing. */
export function myLevels(snap: Snapshot, nowIso: string): ShownLevel[] {
  return SECTIONS.map((section) => {
    const row = snap.levels.get(section);
    const ev = levelEvidence(snap, section);
    const placed =
      (row?.moves ?? 0) > 0 ||
      (row !== undefined && ev.window >= 5 && ev.answered >= Math.min(10, ev.window));
    return { section, level: row?.level ?? "J2", changed_at: row?.changed_at ?? nowIso, placed };
  });
}
