/**
 * Near-duplicate detection across a batch.
 *
 * The seed table stops two items sharing a *cell*, but it cannot stop two different
 * cells producing the same item: 「取引先の課長に資料の確認を頼む」 and 「上司に
 * 報告書に目を通してもらう」 are different cells and very nearly the same question.
 * A learner notices this long before any metric does, so it is checked before a
 * batch ships.
 *
 * The measure is deliberately dumb and offline: character-bigram Jaccard over the
 * normalised stem and the correct utterance. No embeddings, no API call, nothing to
 * pay for — this runs on every batch and in the tests. It is tuned to flag rather
 * than to judge: pairs above the threshold are reported for the five-second human
 * look that the pipeline ends with anyway.
 */
import { get, KeyError, has, max, sorted, str, ValueError, WS } from "../py.ts";
import { correctIndex } from "../schemas.ts";

/** Above this Jaccard similarity, two items are treated as the same question.
 *  Chosen so that paraphrases of one situation collide but two genuinely
 *  different 敬語 problems in the same setting do not. */
export const DEFAULT_THRESHOLD = 0.62;

// `WS` is Python's `\s` (what `str.isspace()` says is whitespace), which is
// wider than JavaScript's, so the two strip the same characters.
export const _STRIP = new RegExp(`[${WS}。、，．,.\\-—―…「」『』（）()！？!?・:：;；　]+`, "gu");

/** Fold width/case and drop punctuation, so wording differences that a
 *  listener would not hear as different do not hide a duplicate. */
export function normalize(text: string): string {
  return text.normalize("NFKC").replace(_STRIP, "");
}

export function bigrams(text: string): Set<string> {
  const t = [...normalize(text)];
  if (t.length < 2) {
    return t.length ? new Set([t.join("")]) : new Set();
  }
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t[i] + t[i + 1]);
  return out;
}

/** Jaccard over character bigrams. 1.0 == identical after normalisation. */
export function similarity(a: string, b: string): number {
  const [ga, gb] = [bigrams(a), bigrams(b)];
  if (ga.size === 0 || gb.size === 0) {
    return 0.0;
  }
  let both = 0;
  for (const g of ga) if (gb.has(g)) both += 1;
  return both / (ga.size + gb.size - both);
}

/** What we compare: the situation plus the answer. Two items with the same
 *  situation but different answers are legitimately different items, and two
 *  items with the same answer in different situations are fine too — it takes
 *  both matching to be a duplicate. */
export function itemSignature(item: Record<string, any>): string {
  let answer: unknown;
  try {
    if (!has(item, "options")) throw new KeyError("options");
    const options = item["options"];
    const correct = options[correctIndex(options)];
    if (!has(correct, "text")) throw new KeyError("text");
    answer = correct["text"];
  } catch (e) {
    // (Python also caught an IndexError here, which `correctIndex` can never
    // lead to: the index it returns is one it found in the list.)
    if (!(e instanceof KeyError || e instanceof ValueError)) throw e;
    answer = "";
  }
  return `${str(get(item, "stem", ""))}\n${str(answer)}`;
}

export class DuplicatePair {
  i: number;
  j: number;
  score: number;
  topic_i: string;
  topic_j: string;

  constructor(init: { i: number; j: number; score: number; topic_i: string; topic_j: string }) {
    this.i = init.i;
    this.j = init.j;
    this.score = init.score;
    this.topic_i = init.topic_i;
    this.topic_j = init.topic_j;
  }
}

/** Every pair at or above the threshold, worst first. */
export function findDuplicates(items: Record<string, any>[], opts: { threshold?: number } = {}): DuplicatePair[] {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const sigs = items.map(itemSignature);
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const score = similarity(sigs[i], sigs[j]);
      if (score >= threshold) {
        pairs.push(
          new DuplicatePair({
            i,
            j,
            score,
            topic_i: get(items[i], "topic", ""),
            topic_j: get(items[j], "topic", ""),
          }),
        );
      }
    }
  }
  return sorted(pairs, { key: (p) => -p.score });
}

/** How close this item comes to anything already in the pool. Used when
 *  adding items one at a time rather than checking a finished batch. */
export function maxSimilarity(item: Record<string, any>, others: Record<string, any>[]): number {
  const sig = itemSignature(item);
  if (others.length === 0) return 0.0;
  return max(others.map((o) => similarity(sig, itemSignature(o))));
}
