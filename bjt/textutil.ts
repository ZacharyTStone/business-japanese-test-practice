/**
 * Small text helpers shared by the fidelity checks: rendering an item to plain
 * text for a prompt, and pulling the kanji out of a string for the vocab gate.
 */
import { get, str, truthy } from "./py.ts";
import * as schemas from "./schemas.ts";
import * as document from "./render/document.ts";

export function optionTexts(item: Record<string, any>): string[] {
  return item["options"].map((o: Record<string, any>) => o["text"]);
}

/** Item as a real test question would appear, including its explanation, for
 *  the judge to inspect. Roles are omitted (they are our metadata, not a tell).
 *
 *  The 資料 and the 会話 are part of "as it would appear". Without them, for
 *  状況把握, 資料聴読解, 総合聴読解 and 総合読解 — 55 of the exam's 80 questions —
 *  the judge would rate items on the stem, the four options and the 解説 while
 *  most of what the learner meets went unseen. The discrimination rate is the
 *  headline fidelity metric and the tells the judge states are folded back into
 *  the generator prompt, so a document that reads nothing like a real document
 *  could then neither lower the score nor be named as a tell.
 *
 *  `runDiscriminator` is the other half of this. A stimulus the generated side
 *  has and the official side lacks is a tell about our seed files rather than
 *  about our items, so it refuses the comparison instead of scoring it. */
export function renderForDiscriminator(item: Record<string, any>): string {
  const lines = [`[${str(get(item, "item_type", ""))} / ${str(get(item, "level", ""))}]`];

  const docs = schemas.documentsOf(item);
  for (const doc of docs) {
    lines.push("--- 資料 ---");
    lines.push(document.textOf(doc));
  }

  const turns = truthy(get(item, "dialogue")) ? item["dialogue"] : [];
  if (truthy(turns)) {
    lines.push("--- 会話 ---");
    for (const t of turns) {
      lines.push(`${str(get(t, "speaker_role", ""))}：${str(get(t, "text", ""))}`);
    }
  }

  if (truthy(turns) || docs.length > 0) {
    lines.push("--- 問題 ---");
  }
  lines.push(item["stem"]);
  item["options"].forEach((o: Record<string, any>, i: number) => {
    lines.push(`${i}. ${str(o["text"])}`);
  });
  lines.push(`解説: ${str(get(item, "explanation_ja", ""))}`);
  return lines.join("\n");
}

/** Every CJK unified ideograph in the string. */
export function kanjiIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const ch of text) {
    if ("一" <= ch && ch <= "鿿") out.add(ch);
  }
  return out;
}

/** All kanji across the stem, options, and explanation of an item. */
export function itemKanji(item: Record<string, any>): Set<string> {
  const chars = new Set<string>();
  for (const c of kanjiIn(get(item, "stem", ""))) chars.add(c);
  for (const o of get(item, "options", [])) {
    for (const c of kanjiIn(get(o, "text", ""))) chars.add(c);
  }
  for (const c of kanjiIn(get(item, "explanation_ja", ""))) chars.add(c);
  return chars;
}
