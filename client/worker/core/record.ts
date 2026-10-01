/**
 * The record, read back: what the progress, review and word screens show.
 *
 * Ported from the Postgres views v_my_day, v_my_type_stats, v_my_tag_stats,
 * v_my_role_traps and v_my_review_load and the function my_streak(), each
 * scoped to the caller by id. Where the views read questions they read only
 * published ones — under row-level security a withdrawn question was
 * invisible to them, and its answers dropped out of the counts — so the
 * filter is written out here.
 */
import { dailyMax, type Learner } from "./caller";
import { apiError } from "./errors";
import { all, chunks, first, json, marks, stmt, withBools, type Db } from "./sql";
import { addDays, DAY, iso, jstDate, jstDayStart, ms, recency } from "./time";

const THIRTY_DAYS = 30 * DAY;

/** Today, against the goal and the ceiling (v_my_day). */
export async function day(db: Db, learner: Learner, now: number) {
  const uid = learner.userId;
  const [today, profile] = await db.batch([
    stmt(db, "select count(*) as n from attempts where user_id = ? and answered_at >= ?", uid, iso(jstDayStart(now))),
    stmt(db, "select daily_goal from profiles where id = ?", uid),
  ]);
  const answered = (today.results[0] as { n: number }).n;
  const goal = (profile.results[0] as { daily_goal: number } | undefined)?.daily_goal ?? 10;
  const max = dailyMax(learner);
  return {
    goal,
    answered_today: answered,
    unlimited: learner.unlimited,
    max_today: learner.unlimited ? null : max,
    left_today: learner.unlimited ? null : Math.max(max - answered, 0),
    goal_max: learner.maxDailyGoal,
  };
}

type Answered = { answered_at: string; is_correct: number };

/** recent_accuracy: the weighted share right, a month's half-life. */
function recentAccuracy(rows: Answered[], now: number): number | null {
  let right = 0;
  let total = 0;
  for (const r of rows) {
    const w = recency(r.answered_at, now);
    total += w;
    if (r.is_correct === 1) right += w;
  }
  return total === 0 ? null : right / total;
}

/** The radar: every type, answered or not (v_my_type_stats). */
export async function typeStats(db: Db, learner: Learner, now: number) {
  const [types, answers] = await db.batch([
    stmt(db, "select id, label_ja, section, sort_order from item_types order by sort_order"),
    stmt(
      db,
      `select i.item_type, a.answered_at, a.is_correct
         from attempts a join items i on i.id = a.item_id and i.is_published = 1
        where a.user_id = ?`,
      learner.userId
    ),
  ]);
  const byType = new Map<string, Answered[]>();
  for (const r of answers.results as (Answered & { item_type: string })[]) {
    byType.set(r.item_type, [...(byType.get(r.item_type) ?? []), r]);
  }
  const since = iso(now - THIRTY_DAYS);
  return (types.results as { id: string; label_ja: string; section: string; sort_order: number }[]).map((t) => {
    const rows = byType.get(t.id) ?? [];
    const correct = rows.filter((r) => r.is_correct === 1).length;
    return {
      item_type: t.id,
      label_ja: t.label_ja,
      section: t.section,
      sort_order: t.sort_order,
      answered: rows.length,
      correct,
      accuracy: rows.length > 0 ? correct / rows.length : null,
      last_answered_at: rows.reduce<string | null>((m, r) => (m === null || r.answered_at > m ? r.answered_at : m), null),
      recent_answered: rows.filter((r) => r.answered_at >= since).length,
      recent_accuracy: recentAccuracy(rows, now),
    };
  });
}

const AXES = ["function", "relation", "setting", "channel"] as const;

/** Accuracy by the seed cell's tags (v_my_tag_stats), lowest first. */
export async function tagStats(db: Db, learner: Learner, now: number) {
  const rows = await all<Answered & Record<(typeof AXES)[number], string | null>>(
    db,
    `select i.function, i.relation, i.setting, i.channel, a.answered_at, a.is_correct
       from attempts a join items i on i.id = a.item_id and i.is_published = 1
      where a.user_id = ?`,
    learner.userId
  );
  const groups = new Map<string, { axis: string; tag: string; rows: Answered[] }>();
  for (const r of rows) {
    for (const axis of AXES) {
      const tag = r[axis];
      if (tag === null) continue;
      const key = `${axis}\u0000${tag}`;
      const g = groups.get(key) ?? { axis, tag, rows: [] };
      g.rows.push(r);
      groups.set(key, g);
    }
  }
  const since = iso(now - THIRTY_DAYS);
  return [...groups.values()]
    .map((g) => {
      const correct = g.rows.filter((r) => r.is_correct === 1).length;
      return {
        axis: g.axis,
        tag: g.tag,
        answered: g.rows.length,
        correct,
        accuracy: correct / g.rows.length,
        recent_answered: g.rows.filter((r) => r.answered_at >= since).length,
        recent_accuracy: recentAccuracy(g.rows, now),
      };
    })
    .sort((a, b) => a.accuracy - b.accuracy);
}

/** Which traps keep catching this learner, and how often each was met
 *  (v_my_role_traps), most often caught first. */
export async function roleTraps(db: Db, learner: Learner, now: number) {
  const since = iso(now - THIRTY_DAYS);
  const [caught, met] = await db.batch([
    stmt(
      db,
      `select a.chosen_role as role, count(*) as times_chosen, max(a.answered_at) as last_chosen_at,
              sum(a.answered_at >= ?) as recent_times
         from attempts a join items i on i.id = a.item_id and i.is_published = 1
        where a.user_id = ? and a.is_correct = 0
        group by a.chosen_role`,
      since,
      learner.userId
    ),
    stmt(
      db,
      `select o.role, count(*) as times_met, sum(a.answered_at >= ?) as recent_met
         from attempts a
         join items i on i.id = a.item_id and i.is_published = 1
         join item_options o on o.item_id = a.item_id and o.position <> i.correct_index
        where a.user_id = ?
        group by o.role`,
      since,
      learner.userId
    ),
  ]);
  const metBy = new Map((met.results as { role: string; times_met: number; recent_met: number }[]).map((m) => [m.role, m]));
  return (caught.results as { role: string; times_chosen: number; last_chosen_at: string; recent_times: number }[])
    .map((c) => ({
      role: c.role,
      times_chosen: c.times_chosen,
      last_chosen_at: c.last_chosen_at,
      recent_times: c.recent_times,
      times_met: metBy.get(c.role)?.times_met ?? null,
      recent_met: metBy.get(c.role)?.recent_met ?? null,
    }))
    .sort((a, b) => b.times_chosen - a.times_chosen);
}

/** How many lessons are due, and when the next one is (v_my_review_load). */
export async function reviewLoad(db: Db, learner: Learner, now: number) {
  const nowIso = iso(now);
  const r = await first<{ due_now: number; tracked: number; next_due_at: string | null }>(
    db,
    `select sum(due_at <= ?1) as due_now, count(*) as tracked,
            min(case when due_at > ?1 then due_at end) as next_due_at
       from review_schedule where user_id = ?2`,
    nowIso,
    learner.userId
  );
  return { due_now: r?.due_now ?? 0, tracked: r?.tracked ?? 0, next_due_at: r?.next_due_at ?? null };
}

/** Days in a row with an answer, counted in Japan, ending today or
 *  yesterday (my_streak()). */
export async function streak(db: Db, learner: Learner, now: number): Promise<number> {
  const rows = await all<{ answered_at: string }>(db, "select answered_at from attempts where user_id = ?", learner.userId);
  const days = new Set(rows.map((r) => jstDate(ms(r.answered_at))));
  const today = jstDate(now);
  let end: string | null = days.has(today) ? today : days.has(addDays(today, -1)) ? addDays(today, -1) : null;
  let n = 0;
  while (end !== null && days.has(end)) {
    n++;
    end = addDays(end, -1);
  }
  return n;
}

/** The latest answers' times, for how long home says a set will take. */
export async function recentPace(db: Db, learner: Learner, limit: number) {
  return all<{ elapsed_ms: number }>(
    db,
    "select elapsed_ms from attempts where user_id = ? and elapsed_ms is not null order by answered_at desc, id desc limit ?",
    learner.userId,
    limit
  );
}

/** The answer an outbox entry describes, if the database already has it. */
export async function findAttempt(db: Db, learner: Learner, itemId: string, chosenIndex: number, replays: number) {
  const rows = await all<{ is_correct: number; chosen_role: string; elapsed_ms: number | null; think_ms: number | null }>(
    db,
    `select is_correct, chosen_role, elapsed_ms, think_ms from attempts
      where user_id = ? and item_id = ? and chosen_index = ? and replays = ?
      order by answered_at desc, id desc limit 20`,
    learner.userId,
    itemId,
    chosenIndex,
    replays
  );
  return withBools(rows, "is_correct");
}

/** The review list: the latest answers (or one question's), with their
 *  published questions, options and the type labels, for `joinHistory`. */
export async function history(db: Db, learner: Learner, limit: number, itemId: string | null) {
  const attempts = withBools(
    await all<{ id: number; item_id: string; answered_at: string; is_correct: number; chosen_index: number; chosen_role: string }>(
      db,
      `select id, item_id, answered_at, is_correct, chosen_index, chosen_role from attempts
        where user_id = ? ${itemId ? "and item_id = ?" : ""}
        order by answered_at desc, id desc limit ?`,
      ...(itemId ? [learner.userId, itemId, limit] : [learner.userId, limit])
    ),
    "is_correct"
  );
  if (attempts.length === 0) return { attempts, items: [], options: [], types: [] };
  const ids = [...new Set(attempts.map((a) => a.item_id))];
  const items: unknown[] = [];
  const options: unknown[] = [];
  for (const part of chunks(ids)) {
    const [i, o] = await db.batch([
      stmt(
        db,
        `select id, item_type, level, topic, stem, correct_index, explanation_ja, explanation_en
           from items where is_published = 1 and id in (${marks(part.length)})`,
        ...part
      ),
      stmt(
        db,
        `select o.item_id, o.position, o.text, o.role, o.why
           from item_options o join items i on i.id = o.item_id and i.is_published = 1
          where o.item_id in (${marks(part.length)})`,
        ...part
      ),
    ]);
    items.push(...i.results);
    options.push(...o.results);
  }
  const types = await all(db, "select id, label_ja from item_types");
  return { attempts, items, options, types };
}

/** One published question's lines and every clip they point at: what the
 *  review screen opens and where a word's sentence is found. */
export async function itemDetail(db: Db, itemId: string) {
  const [itemRes, optionRes] = await db.batch([
    stmt(db, "select stem, documents, dialogue, vocab_notes, narration_clip_id from items where id = ? and is_published = 1", itemId),
    stmt(db, "select position, text, clip_id from item_options where item_id = ? order by position", itemId),
  ]);
  const raw = (itemRes.results as Record<string, unknown>[])[0];
  if (!raw) throw apiError("PGRST116", "JSON object requested, no rows returned");
  const item = {
    stem: raw.stem as string,
    documents: json(raw.documents, []),
    dialogue: json<{ clip_id?: string | null }[]>(raw.dialogue, []),
    vocab_notes: json(raw.vocab_notes, []),
    narration_clip_id: (raw.narration_clip_id as string | null) ?? null,
  };
  const options = optionRes.results as { position: number; text: string; clip_id: string | null }[];
  const clipIds = [
    ...new Set(
      [...item.dialogue.map((t) => t.clip_id), item.narration_clip_id, ...options.map((o) => o.clip_id)].filter(
        (id): id is string => typeof id === "string" && id.length > 0
      )
    ),
  ];
  const clips = clipIds.length
    ? await all(db, `select id, audio_path from audio_clips where id in (${marks(clipIds.length)})`, ...clipIds)
    : [];
  return { item, options, clips };
}

/** The questions that caught this learner, newest first, with their notes. */
export async function vocab(db: Db, learner: Learner, limit: number) {
  const attempts = await all<{ item_id: string; answered_at: string }>(
    db,
    "select item_id, answered_at from attempts where user_id = ? and is_correct = 0 order by answered_at desc, id desc limit ?",
    learner.userId,
    limit
  );
  if (attempts.length === 0) return { attempts, items: [] };
  const ids = [...new Set(attempts.map((a) => a.item_id))];
  const items: { id: string; vocab_notes: unknown }[] = [];
  for (const part of chunks(ids)) {
    const rows = await all<{ id: string; vocab_notes: string }>(
      db,
      `select id, vocab_notes from items where is_published = 1 and id in (${marks(part.length)})`,
      ...part
    );
    items.push(...rows.map((r) => ({ id: r.id, vocab_notes: json(r.vocab_notes, []) })));
  }
  return { attempts, items };
}

/** Every published question this learner has answered — timeouts included,
 *  the question was on screen — with its correct option and its section. */
export async function wordList(db: Db, learner: Learner) {
  const [items, correct, types] = await db.batch([
    stmt(
      db,
      `select id, item_type, level, stem, dialogue, documents, vocab_notes from items
        where is_published = 1 and id in (select item_id from attempts where user_id = ?)`,
      learner.userId
    ),
    stmt(
      db,
      `select o.item_id, o.text from item_options o join items i on i.id = o.item_id and i.is_published = 1
        where o.role = 'correct' and o.item_id in (select item_id from attempts where user_id = ?)`,
      learner.userId
    ),
    stmt(db, "select id, section from item_types"),
  ]);
  return {
    items: (items.results as Record<string, unknown>[]).map((r) => ({
      ...r,
      dialogue: json(r.dialogue, []),
      documents: json(r.documents, []),
      vocab_notes: json(r.vocab_notes, []),
    })),
    correct: correct.results,
    types: types.results,
  };
}

/** The reading clock's pace, per self-paced type. */
export async function pace(db: Db) {
  return all(db, "select id, seconds_per_item, typical_chars from item_types where seconds_per_item is not null");
}

/** The four spoken option numbers, by what they say. */
export async function optionLabels(db: Db, voice: string, texts: string[]) {
  if (texts.length === 0) return [];
  return all(db, `select text, audio_path from audio_clips where voice = ? and text in (${marks(texts.length)})`, voice, ...texts);
}
