/**
 * What a learner can say about a question: a report, a note, and — for the
 * one account whose tester row carries may_veto — a veto.
 *
 * A report is a report: one per person per question, a second press
 * replacing the first, and nothing in the queue reads it. A veto is the
 * decision: the question is unpublished for everybody at once (never
 * deleted, so every answer pointing at it keeps resolving), and who did it is
 * kept in item_vetoes. It is re-checked here rather than trusted from the
 * button the app drew.
 */
import type { Learner } from "./caller";
import { apiError } from "./errors";
import { all, chunks, first, marks, run, stmt, type Db } from "./sql";
import { iso } from "./time";

export async function reportItem(db: Db, learner: Learner, itemId: string, reason: string, note: string, now: number) {
  const nowIso = iso(now);
  await run(
    db,
    `insert into item_feedback (user_id, item_id, reason, note, created_at, updated_at)
     values (?1, ?2, ?3, ?4, ?5, ?5)
     on conflict (user_id, item_id) do update set reason = excluded.reason, note = excluded.note, updated_at = excluded.updated_at`,
    learner.userId,
    itemId,
    reason,
    note,
    nowIso
  );
  return null;
}

export function mayVeto(learner: Learner): boolean {
  return learner.isTester && learner.mayVeto;
}

export async function vetoItem(db: Db, learner: Learner, itemId: string, note: string, now: number) {
  if (!mayVeto(learner)) throw apiError("P0001", "this account may not veto a question");
  if (!(await first(db, "select 1 as x from items where id = ?", itemId))) {
    throw apiError("P0001", `no such item: ${itemId}`);
  }
  await db.batch([
    stmt(db, "update items set is_published = 0 where id = ?", itemId),
    stmt(
      db,
      "insert into item_vetoes (item_id, user_id, note, created_at) values (?, ?, ?, ?) on conflict (item_id) do nothing",
      itemId,
      learner.userId,
      note.slice(0, 500),
      iso(now)
    ),
  ]);
  return null;
}

export async function notes(db: Db, learner: Learner, itemIds: string[]) {
  const out: unknown[] = [];
  for (const part of chunks(itemIds)) {
    out.push(
      ...(await all(
        db,
        `select item_id, note from review_notes where user_id = ? and item_id in (${marks(part.length)})`,
        learner.userId,
        ...part
      ))
    );
  }
  return out;
}

/** Keep a note, or remove it when it has been emptied. */
export async function saveNote(db: Db, learner: Learner, itemId: string, note: string) {
  if (!note) {
    await run(db, "delete from review_notes where user_id = ? and item_id = ?", learner.userId, itemId);
    return null;
  }
  await run(
    db,
    `insert into review_notes (user_id, item_id, note) values (?, ?, ?)
     on conflict (user_id, item_id) do update set note = excluded.note`,
    learner.userId,
    itemId,
    note
  );
  return null;
}
