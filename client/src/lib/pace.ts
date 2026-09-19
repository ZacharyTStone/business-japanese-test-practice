/**
 * How long a question gets, and where that number comes from.
 *
 * The exam paces its three parts in two different ways. 第1部 聴解 and 第2部
 * 聴読解 advance with the audio: the candidate makes no pacing decision and
 * cannot go back. 第3部 読解 is the opposite — **30 questions in a 30-minute
 * block, freely navigable** — so pacing is a skill, and it is the one skill this
 * app was not practising. Somebody who reads well and slowly meets the last six
 * questions with two minutes left and loses marks they had the Japanese for.
 *
 * 30 questions in 30 minutes is 60 seconds each, and that is the only clean
 * pacing figure the exam publishes. But a flat 60 would be wrong for all three
 * reading types at once: a 語彙・文法 cloze is a fifteen-second item, and that is
 * exactly what buys the time a 総合読解 passage needs. So the block is divided
 * rather than averaged (see the migration that added `seconds_per_item`), and
 * then divided again **per question** here.
 *
 * **Why per question.** Two 総合読解 items are not the same job: one carries a
 * 400-character notice and one carries a 900-character email thread, and giving
 * them the same 105 seconds teaches the wrong lesson twice — too slack on the
 * first, punitive on the second. So the type's budget is the budget for a
 * *typical* item of that type, and a particular item is scaled by how much there
 * actually is to read in it, against that type's typical load. The scale is
 * clamped, because the point is to pace the learner rather than to let one
 * freakish item hand out four minutes.
 *
 * Everything the number is built from is a property of the question or of the
 * exam. Nothing here reads the learner: a fast reader and a slow one get the
 * same budget, because the exam does.
 */
import type { QueuedItem, StimulusDocument } from "./types";

/**
 * How far the budget may move from its type's anchor. A 900-character passage
 * genuinely deserves more than a 400-character one; nothing deserves four times
 * the block's share, and an item whose document failed to load should not
 * collapse to five seconds.
 */
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.6;

/** Never less than this, whatever the arithmetic says. Below about twenty
 *  seconds a question is a reflex test rather than a reading one. */
const FLOOR_SECONDS = 20;

/** What the exam affords one type of question, and how much reading a typical
 *  item of that type carries. Both come from `public.item_types`; both are null
 *  for the types the audio already paces. */
export type TypePace = { seconds: number; typicalChars: number };

/** Characters in one document, counting only what is read on screen. */
function documentChars(doc: StimulusDocument): number {
  let n = (doc.title ?? "").length;
  for (const m of doc.meta ?? []) n += (m.label ?? "").length + (m.value ?? "").length;
  for (const b of doc.blocks ?? []) {
    n += (b.text ?? "").length + (b.caption ?? "").length;
    for (const line of b.items ?? []) n += line.length;
    for (const col of b.columns ?? []) n += col.length;
    for (const row of b.rows ?? []) for (const cell of row) n += cell.length;
    for (const pair of b.pairs ?? []) n += pair.label.length + pair.value.length;
  }
  return n;
}

/**
 * Everything on screen that has to be read before this question can be answered:
 * the document or documents, the question, and the four options.
 *
 * A heard dialogue is deliberately not counted even when an item has one. This
 * number only ever prices a reading item, and in a reading item there is none.
 */
export function readingLoad(item: QueuedItem): number {
  let n = (item.stem ?? "").length;
  for (const o of item.options ?? []) n += (o.text ?? "").length;
  for (const doc of item.documents ?? []) n += documentChars(doc);
  return n;
}

/**
 * The seconds this question gets, or 0 for "no clock".
 *
 * Zero is the answer for three different reasons and they all mean the same
 * thing on screen: the type is one the exam paces with its audio, the learner
 * has the clock off, or the pace table did not load.
 */
export function budgetSeconds(item: QueuedItem, pace: Record<string, TypePace>): number {
  const anchor = pace[item.item_type];
  if (!anchor || anchor.seconds <= 0) return 0;
  if (anchor.typicalChars <= 0) return anchor.seconds;

  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, readingLoad(item) / anchor.typicalChars)
  );
  return Math.max(FLOOR_SECONDS, Math.round(anchor.seconds * scale));
}
