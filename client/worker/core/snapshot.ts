/**
 * Everything the queue, the levels and the grading read, in one consistent
 * read: one D1 batch is one transaction, so the bank and the learner's record
 * are seen as they stood at a single moment.
 *
 * The bank is small (a few hundred questions) and one learner's record is a
 * few thousand answers at most, so reading the lot and ranking in TypeScript
 * costs less than the round trips a cleverer query would need.
 */
import type { Learner } from "./caller";
import { stmt, type Db } from "./sql";

export type Section = "choukai" | "choudokkai" | "dokkai";
export const SECTIONS: Section[] = ["choukai", "choudokkai", "dokkai"];
export type Level = "J3" | "J2" | "J1";

export type BankItem = {
  id: string;
  level: Level;
  item_type: string;
  setting: string | null;
  function: string | null;
  scene_id: string | null;
  model_p_correct: number | null;
  correct_index: number;
  is_published: boolean;
  section: Section;
  /** Published, and its picture exists when its type needs one. */
  servable: boolean;
};

export type ItemType = {
  id: string;
  section: Section;
  exam_questions: number;
  seconds_per_item: number | null;
  sort_order: number;
};

export type Option = { item_id: string; position: number; role: string };

export type Answer = {
  id: number;
  item_id: string;
  is_correct: boolean;
  chosen_role: string;
  answered_at: string;
  replays: number;
  peeked: boolean;
};

export type Lesson = { item_id: string; trap: string | null; missed: boolean; due_at: string; step: number };
export type SectionLevel = { section: Section; level: Level; changed_at: string; moves: number };

export type Snapshot = {
  items: Map<string, BankItem>;
  types: Map<string, ItemType>;
  /** Every option of every question, published or not, by item. */
  options: Map<string, Option[]>;
  /** item_stats rows over at least eight people (v_item_difficulty). */
  difficulty: Map<string, number>;
  /** This learner's answers, oldest first (answered_at, then id). */
  answers: Answer[];
  lessons: Map<string, Lesson>;
  levels: Map<Section, SectionLevel>;
  profile: { exam_date: string | null; target_level: Level; daily_goal: number } | null;
};

export async function loadSnapshot(db: Db, learner: Learner): Promise<Snapshot> {
  const uid = learner.userId;
  const [items, types, options, stats, answers, lessons, levels, profile] = await db.batch([
    stmt(
      db,
      `select i.id, i.level, i.item_type, i.setting, i.function, i.scene_id, i.model_p_correct,
              i.correct_index, i.is_published, t.section,
              (i.is_published = 1
               and (t.needs_picture = 0
                    or exists (select 1 from scenes sc where sc.id = i.scene_id and sc.image_path is not null))) as servable
         from items i join item_types t on t.id = i.item_type`
    ),
    stmt(db, "select id, section, exam_questions, seconds_per_item, sort_order from item_types"),
    stmt(db, "select item_id, position, role from item_options order by item_id, position"),
    stmt(db, "select item_id, p_correct from item_stats where answered >= 8 and p_correct is not null"),
    stmt(
      db,
      `select id, item_id, is_correct, chosen_role, answered_at, replays, peeked
         from attempts where user_id = ? order by answered_at, id`,
      uid
    ),
    stmt(db, "select item_id, trap, missed, due_at, step from review_schedule where user_id = ?", uid),
    stmt(db, "select section, level, changed_at, moves from section_levels where user_id = ?", uid),
    stmt(db, "select exam_date, target_level, daily_goal from profiles where id = ?", uid),
  ]);

  const snap: Snapshot = {
    items: new Map(),
    types: new Map(),
    options: new Map(),
    difficulty: new Map(),
    answers: [],
    lessons: new Map(),
    levels: new Map(),
    profile: null,
  };
  for (const r of items.results as Record<string, unknown>[]) {
    snap.items.set(r.id as string, {
      id: r.id as string,
      level: r.level as Level,
      item_type: r.item_type as string,
      setting: (r.setting as string | null) ?? null,
      function: (r.function as string | null) ?? null,
      scene_id: (r.scene_id as string | null) ?? null,
      model_p_correct: (r.model_p_correct as number | null) ?? null,
      correct_index: r.correct_index as number,
      is_published: r.is_published === 1,
      section: r.section as Section,
      servable: r.servable === 1,
    });
  }
  for (const r of types.results as ItemType[]) snap.types.set(r.id, r);
  for (const r of options.results as Option[]) {
    const list = snap.options.get(r.item_id) ?? [];
    list.push(r);
    snap.options.set(r.item_id, list);
  }
  for (const r of stats.results as { item_id: string; p_correct: number }[]) snap.difficulty.set(r.item_id, r.p_correct);
  snap.answers = (answers.results as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    item_id: r.item_id as string,
    is_correct: r.is_correct === 1,
    chosen_role: r.chosen_role as string,
    answered_at: r.answered_at as string,
    replays: r.replays as number,
    peeked: r.peeked === 1,
  }));
  for (const r of lessons.results as Record<string, unknown>[]) {
    snap.lessons.set(r.item_id as string, {
      item_id: r.item_id as string,
      trap: (r.trap as string | null) ?? null,
      missed: r.missed === 1,
      due_at: r.due_at as string,
      step: r.step as number,
    });
  }
  for (const r of levels.results as SectionLevel[]) snap.levels.set(r.section, r);
  const p = (profile.results as Record<string, unknown>[])[0];
  if (p) {
    snap.profile = {
      exam_date: (p.exam_date as string | null) ?? null,
      target_level: p.target_level as Level,
      daily_goal: p.daily_goal as number,
    };
  }
  return snap;
}

/** The order the queue and the levels compare answers in: when, then id. */
export function before(a: { answered_at: string; id: number }, b: { answered_at: string; id: number }): boolean {
  return a.answered_at < b.answered_at || (a.answered_at === b.answered_at && a.id < b.id);
}
