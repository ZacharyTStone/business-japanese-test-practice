/**
 * The practice queue: which questions come next, and in what order.
 *
 * A line-for-line port of the Postgres next_items() (its last migration,
 * 20260930000700_the_retest_walk_stops_early.sql, went with the move to D1
 * and is in the git history). It takes a size and reads everything else
 * from the record. In order:
 *
 *   due     lessons that are due, misses first, each re-tested by an unseen
 *           question that sets the same trap (its `stands_for` names the
 *           lesson) — two fifths of the set at most;
 *   fresh   unseen questions at the section's level, weakest ground first,
 *           leaned to the exam's section mix (strictly in the last two weeks
 *           before the exam date);
 *   stretch one unseen question from the level above, in a set of five or more;
 *   rest    every other unseen question, at any level, before any question
 *           already met — and a met one only from inside the level window.
 *
 * The size served is capped by what the day has left. Ranking terms have an
 * order of authority (CLAUDE.md): the 機能 tag's accuracy dominates; traps and
 * the difficulty pitch are second; the type and 場面 variety nudges third; the
 * random tie-break is a fiftieth of a point. `random` is a parameter, handed
 * the question's id, so a test can make the order exact.
 */
import { dailyMax, type Learner } from "./caller";
import { down, up } from "./levels";
import { loadSnapshot, SECTIONS, type BankItem, type Level, type Section, type Snapshot } from "./snapshot";
import { all, chunks, json, marks, stmt, type Db } from "./sql";
import { addDays, HOUR, iso, jstDate, jstDayStart, ms, recency } from "./time";

export type Pick = { id: string; bucket: number; rank: number; stands_for: string | null; lesson_trap: string | null };

type Acc = { right: number; total: number };
const smoothed = (a: Acc | undefined) => (a ? (a.right + 1) / (a.total + 2) : undefined);

type PoolItem = BankItem & {
  at_level: Level;
  above: Level | null;
  below: Level | null;
  in_window: boolean;
  section_accuracy: number;
  is_seen: boolean;
  ever_correct: boolean;
  last_at: string | null;
  lesson_due: boolean;
  lesson_missed: boolean;
  weakness: number;
};

/** How many questions today has left: the size asked for, capped by the day. */
export function setSize(snap: Snapshot, learner: Learner, limit: number, now: number): number {
  const asked = Math.max(limit, 0);
  if (learner.unlimited) return asked;
  const start = jstDayStart(now);
  const today = snap.answers.filter((a) => ms(a.answered_at) >= start).length;
  return Math.min(asked, Math.max(dailyMax(learner) - today, 0));
}

/** Whether the exam is in its last two weeks, counted in Japan. */
export function examIsNear(examDate: string | null | undefined, now: number): boolean {
  if (!examDate) return false;
  const today = jstDate(now);
  return examDate >= today && examDate <= addDays(today, 14);
}

export function rankQueue(
  snap: Snapshot,
  learner: Learner,
  limit: number,
  now: number,
  random: (id: string) => number = Math.random
): Pick[] {
  const n = setSize(snap, learner, limit, now);
  const nowIso = iso(now);

  // ---- the ladder: each section's level and the two beside it
  const ladder = new Map<Section, { level: Level; up: Level | null; down: Level | null }>();
  for (const s of SECTIONS) {
    const level = snap.levels.get(s)?.level ?? "J2";
    ladder.set(s, { level, up: up(level), down: down(level) });
  }

  // ---- what this learner has met
  const seen = new Map<string, { times: number; ever_correct: boolean; last_at: string }>();
  for (const a of snap.answers) {
    const s = seen.get(a.item_id);
    if (s) {
      s.times++;
      s.ever_correct ||= a.is_correct;
      if (a.answered_at > s.last_at) s.last_at = a.answered_at;
    } else {
      seen.set(a.item_id, { times: 1, ever_correct: a.is_correct, last_at: a.answered_at });
    }
  }

  // ---- accuracy, recency-weighted, smoothed. Only answers to published
  // questions count: under row-level security the old queries could not see
  // a withdrawn question, so its answers dropped out of these sums.
  const byFunction = new Map<string, Acc>();
  const byType = new Map<string, Acc>();
  const bySection = new Map<Section, Acc>();
  const traps = new Map<string, number>();
  for (const a of snap.answers) {
    const w = recency(a.answered_at, now);
    // The traps that caught this learner: every wrong answer, published or not.
    if (!a.is_correct && a.chosen_role !== "") traps.set(a.chosen_role, (traps.get(a.chosen_role) ?? 0) + w);
    const item = snap.items.get(a.item_id);
    if (!item || !item.is_published) continue;
    const add = <K>(m: Map<K, Acc>, k: K) => {
      const acc = m.get(k) ?? { right: 0, total: 0 };
      acc.total += w;
      if (a.is_correct) acc.right += w;
      m.set(k, acc);
    };
    if (item.function !== null) add(byFunction, item.function);
    add(byType, item.item_type);
    add(bySection, item.section);
  }
  const targetP = new Map<string, number>();
  for (const t of snap.types.values()) {
    const acc = smoothed(byType.get(t.id)) ?? 0.5;
    targetP.set(t.id, Math.min(Math.max(0.85 - acc * 0.35, 0.5), 0.8));
  }

  // ---- how rare each trap is in the bank, and how well a question fits the
  // traps that caught this learner
  const published = [...snap.items.values()].filter((i) => i.is_published);
  const wrongRoles = new Map<string, Set<string>>(); // item → roles offered as wrong answers
  const roleItems = new Map<string, Set<string>>(); // role → items offering it as wrong
  for (const item of published) {
    const roles = new Set<string>();
    for (const o of snap.options.get(item.id) ?? []) {
      if (o.position === item.correct_index) continue;
      roles.add(o.role);
      const set = roleItems.get(o.role) ?? new Set<string>();
      set.add(item.id);
      roleItems.set(o.role, set);
    }
    wrongRoles.set(item.id, roles);
  }
  const rarity = new Map<string, number>();
  for (const [role, set] of roleItems) rarity.set(role, Math.log(published.length / set.size));
  const trapFit = new Map<string, number>();
  for (const item of published) {
    let weight: number | undefined;
    for (const o of snap.options.get(item.id) ?? []) {
      if (o.position === item.correct_index) continue;
      const times = traps.get(o.role);
      const r = rarity.get(o.role);
      if (times === undefined || r === undefined) continue;
      weight = (weight ?? 0) + times * r;
    }
    if (weight !== undefined) trapFit.set(item.id, weight);
  }

  // ---- the pool: every servable published question, at every level
  const pool: PoolItem[] = [];
  for (const item of snap.items.values()) {
    if (!item.servable) continue;
    const la = ladder.get(item.section)!;
    const s = seen.get(item.id);
    const lesson = snap.lessons.get(item.id);
    const difficulty = snap.difficulty.get(item.id) ?? item.model_p_correct;
    const pitch = difficulty === null || difficulty === undefined ? 0.1 : Math.abs(difficulty - targetP.get(item.item_type)!);
    const sectionAcc = smoothed(bySection.get(item.section)) ?? 0.5;
    const tagAcc = (item.function !== null ? smoothed(byFunction.get(item.function)) : undefined) ?? 0.5;
    pool.push({
      ...item,
      at_level: la.level,
      above: la.up,
      below: la.down,
      in_window: item.level === la.level || item.level === la.up || item.level === la.down,
      section_accuracy: sectionAcc,
      is_seen: s !== undefined,
      ever_correct: s?.ever_correct ?? false,
      last_at: s?.last_at ?? null,
      lesson_due: lesson !== undefined && lesson.due_at <= nowIso,
      lesson_missed: lesson?.missed ?? false,
      weakness:
        tagAcc + (sectionAcc - 0.5) * 0.2 - Math.min(trapFit.get(item.id) ?? 0, 5) * 0.06 + pitch * 0.5,
    });
  }
  const byWeakness = (a: PoolItem, b: PoolItem) => a.weakness - b.weakness || cmp(a.id, b.id);

  // ---- A: due lessons, misses first then most overdue; the first 200
  const dueLessons = [...snap.lessons.values()]
    .filter((l) => l.due_at <= nowIso && snap.items.get(l.item_id)?.is_published)
    .sort((a, b) => Number(b.missed) - Number(a.missed) || cmp(a.due_at, b.due_at) || cmp(a.item_id, b.item_id))
    .slice(0, 200)
    .map((l, i) => {
      const item = snap.items.get(l.item_id)!;
      return { ...l, item_type: item.item_type, function: item.function, priority: i + 1 };
    });
  const dueCap = Math.max(1, Math.floor((n * 2) / 5));

  // For each lesson, its unseen re-tests, best first, the first `dueCap` only.
  const unseen = pool.filter((p) => !p.is_seen);
  const siblingOptions = new Map<string, string[]>();
  for (const dl of dueLessons) {
    const candidates = unseen.filter((p) =>
      p.item_type === dl.item_type &&
      (dl.trap !== null ? wrongRoles.get(p.id)?.has(dl.trap) === true : dl.function === null || p.function === dl.function)
    );
    candidates.sort(
      (a, b) =>
        Number(b.level === b.at_level) - Number(a.level === a.at_level) ||
        Number(b.in_window) - Number(a.in_window) ||
        a.weakness - b.weakness ||
        cmp(a.id, b.id)
    );
    siblingOptions.set(dl.item_id, candidates.slice(0, dueCap).map((c) => c.id));
  }

  // One question per lesson, in lesson order, each taking its best question
  // no earlier lesson took; the walk stops once the set's share is handed out.
  const due: Pick[] = [];
  const taken = new Set<string>();
  for (const dl of dueLessons) {
    if (due.length >= dueCap) break;
    const next = (siblingOptions.get(dl.item_id) ?? []).find((id) => !taken.has(id));
    if (next === undefined) continue;
    taken.add(next);
    due.push({ id: next, bucket: 0, rank: dl.priority, stands_for: dl.item_id, lesson_trap: dl.trap });
  }

  // ---- one stretch question from the level above, in a set of five or more
  const stretch: Pick[] = [];
  if (n >= 5) {
    const above = pool
      .filter((p) => p.level === p.above && !p.is_seen)
      .map((p) => ({ p, r: random(p.id) }))
      .sort((a, b) => b.p.section_accuracy - a.p.section_accuracy || a.r - b.r);
    if (above.length) stretch.push({ id: above[0].p.id, bucket: 2, rank: random(above[0].p.id), stands_for: null, lesson_trap: null });
  }

  // ---- fresh questions at the section's level, leaned to the exam's mix
  const freshSize = Math.max(n - due.length - stretch.length, 1);
  const examTotal = [...snap.types.values()].reduce((s, t) => s + t.exam_questions, 0);
  const quota = new Map<Section, number>();
  for (const s of SECTIONS) {
    const inSection = [...snap.types.values()].filter((t) => t.section === s).reduce((sum, t) => sum + t.exam_questions, 0);
    quota.set(s, Math.round((inSection / examTotal) * freshSize));
  }
  const near = examIsNear(snap.profile?.exam_date, now);
  const candidates = pool.filter((p) => p.level === p.at_level && !p.is_seen);
  const rowNumber = (key: (p: PoolItem) => string) => {
    const groups = new Map<string, PoolItem[]>();
    for (const p of candidates) {
      const k = key(p);
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    const out = new Map<string, number>();
    for (const list of groups.values()) list.sort(byWeakness).forEach((p, i) => out.set(p.id, i + 1));
    return out;
  };
  const inSectionRank = rowNumber((p) => p.section);
  const inTypeRank = rowNumber((p) => p.item_type);
  const inSettingRank = rowNumber((p) => p.setting ?? p.id);
  const fresh: Pick[] = candidates
    .map((p) => ({
      id: p.id,
      bucket: 1,
      rank:
        p.weakness +
        Math.max(0, inSectionRank.get(p.id)! - (quota.get(p.section) ?? 99)) * (near ? 1.0 : 0.25) +
        (inTypeRank.get(p.id)! - 1) * 0.15 +
        (inSettingRank.get(p.id)! - 1) * 0.05 +
        random(p.id) / 50,
      stands_for: null,
      lesson_trap: null,
    }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, freshSize);

  // ---- every other question: unseen ones at any level, then met ones from
  // inside the window
  const twentyHoursAgo = iso(now - 20 * HOUR);
  const rest: Pick[] = pool
    .filter((p) => !p.is_seen || p.in_window)
    .map((p) => {
      const bucket = !p.is_seen && p.in_window ? 3 : !p.is_seen ? 4 : p.last_at! <= twentyHoursAgo ? 5 : 6;
      let rank: number;
      if (!p.is_seen) {
        const band = p.level === p.at_level ? 0 : p.level === p.above ? 1 : p.level === p.below ? 2 : 3;
        rank = band + Math.min(Math.max(p.weakness, 0), 1.8) / 2 + random(p.id) / 1e6;
      } else {
        const lesson = p.lesson_due && p.lesson_missed ? 0 : p.lesson_due ? 1 : !p.ever_correct ? 2 : 3;
        rank = lesson + (p.level === p.below ? 0.5 : 0) + ms(p.last_at!) / 1000 / 1e12 + random(p.id) / 1e15;
      }
      return { id: p.id, bucket, rank, stands_for: null, lesson_trap: null };
    });

  // ---- each question once, in its best place; then the set
  const best = new Map<string, Pick>();
  for (const pick of [...due, ...fresh, ...stretch, ...rest]) {
    const held = best.get(pick.id);
    if (!held || pick.bucket < held.bucket || (pick.bucket === held.bucket && pick.rank < held.rank)) best.set(pick.id, pick);
  }
  return [...best.values()].sort((a, b) => a.bucket - b.bucket || a.rank - b.rank).slice(0, n);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ------------------------------------------------------------------ serving

type ItemRow = {
  id: string;
  item_type: string;
  level: Level;
  topic: string;
  stem: string;
  scene_id: string | null;
  scene_image_path: string | null;
  speaker_role: string | null;
  listener_role: string | null;
  channel: string | null;
  seed_cell_id: string | null;
  correct_index: number;
  explanation_ja: string;
  explanation_en: string;
  vocab_notes: string;
  documents: string;
  dialogue: string;
  narration_clip_id: string | null;
};

type Turn = { speaker_role: string; text: string; clip_id?: string | null } & Record<string, unknown>;

/** The set, as the practice screen draws it: each question whole, with its
 *  options, the path of every clip it plays, and how often it has been met. */
export async function nextItems(db: Db, learner: Learner, limit: number, now: number, random: (id: string) => number = Math.random) {
  const snap = await loadSnapshot(db, learner);
  const picks = rankQueue(snap, learner, limit, now, random);
  if (picks.length === 0) return [];
  const ids = picks.map((p) => p.id);

  type OptionRow = { item_id: string; position: number; text: string; role: string; why: string; clip_id: string | null };
  const itemRows = new Map<string, ItemRow>();
  const optionRows: OptionRow[] = [];
  for (const part of chunks(ids)) {
    const [items, options] = await db.batch([
      stmt(
        db,
        `select i.id, i.item_type, i.level, i.topic, i.stem, i.scene_id,
                (select s.image_path from scenes s where s.id = i.scene_id) as scene_image_path,
                i.speaker_role, i.listener_role, i.channel, i.seed_cell_id, i.correct_index,
                i.explanation_ja, i.explanation_en, i.vocab_notes, i.documents, i.dialogue,
                i.narration_clip_id
           from items i where i.is_published = 1 and i.id in (${marks(part.length)})`,
        ...part
      ),
      stmt(
        db,
        `select o.item_id, o.position, o.text, o.role, o.why, o.clip_id
           from item_options o where o.item_id in (${marks(part.length)}) order by o.item_id, o.position`,
        ...part
      ),
    ]);
    for (const r of items.results as ItemRow[]) itemRows.set(r.id, r);
    optionRows.push(...(options.results as OptionRow[]));
  }

  // Every clip the set plays, looked up once.
  const clipIds = new Set<string>();
  for (const r of itemRows.values()) {
    if (r.narration_clip_id) clipIds.add(r.narration_clip_id);
    for (const t of json<Turn[]>(r.dialogue, [])) if (typeof t.clip_id === "string") clipIds.add(t.clip_id);
  }
  for (const o of optionRows) if (o.clip_id) clipIds.add(o.clip_id);
  const paths = new Map<string, string | null>();
  for (const part of chunks([...clipIds])) {
    const rows = await all<{ id: string; audio_path: string | null }>(
      db,
      `select id, audio_path from audio_clips where id in (${marks(part.length)})`,
      ...part
    );
    for (const r of rows) paths.set(r.id, r.audio_path);
  }
  const pathOf = (id: string | null | undefined) => (id ? (paths.get(id) ?? null) : null);

  const optionsOf = new Map<string, unknown[]>();
  for (const o of optionRows) {
    const list = optionsOf.get(o.item_id) ?? [];
    list.push({ position: o.position, text: o.text, role: o.role, why: o.why, clip_id: o.clip_id, audio_path: pathOf(o.clip_id) });
    optionsOf.set(o.item_id, list);
  }
  const timesSeen = new Map<string, number>();
  for (const a of snap.answers) timesSeen.set(a.item_id, (timesSeen.get(a.item_id) ?? 0) + 1);

  return picks
    .filter((p) => itemRows.has(p.id))
    .map((p) => {
      const r = itemRows.get(p.id)!;
      return {
        id: r.id,
        item_type: r.item_type,
        level: r.level,
        topic: r.topic,
        stem: r.stem,
        scene_id: r.scene_id,
        scene_image_path: r.scene_image_path,
        speaker_role: r.speaker_role,
        listener_role: r.listener_role,
        channel: r.channel,
        seed_cell_id: r.seed_cell_id,
        correct_index: r.correct_index,
        explanation_ja: r.explanation_ja,
        explanation_en: r.explanation_en,
        vocab_notes: json(r.vocab_notes, []),
        documents: json(r.documents, []),
        dialogue: json<Turn[]>(r.dialogue, []).map((t) => ({ ...t, audio_path: pathOf(t.clip_id) })),
        narration_clip_id: r.narration_clip_id,
        narration_path: pathOf(r.narration_clip_id),
        options: optionsOf.get(r.id) ?? null,
        times_seen: timesSeen.get(r.id) ?? 0,
        stands_for: p.stands_for,
        lesson_trap: p.lesson_trap,
      };
    });
}
