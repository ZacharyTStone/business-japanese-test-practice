/** Printing an item to a terminal: the question, then the answer and its traps. */
import * as schemas from "../schemas.ts";
import * as roles from "../fidelity/roles.ts";
import { get, IndexError, or, print, str, truthy, wrap } from "../py.ts";

export const LETTERS = ["A", "B", "C", "D"];

/** `LETTERS[i]`, which raises past the end rather than printing `undefined`. */
function _letter(i: number): string {
  if (i < 0 || i >= LETTERS.length) {
    throw new IndexError("list index out of range");
  }
  return LETTERS[i];
}

/** `{...}.get(key, default)` for a key that may not be a string. */
function _lookup(d: Record<string, string>, key: unknown, dflt: unknown): unknown {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(d, key) ? d[key] : dflt;
}

export function printQuestion(item: Record<string, any>): void {
  print();
  print(`  [${str(get(item, "item_type", ""))} · ${str(get(item, "level", ""))}]  ${str(get(item, "topic", ""))}`);
  if (truthy(get(item, "speaker_role"))) {
    const chan = _lookup({ "phone": "電話", "video": "オンライン", "in_person": "対面" },
      get(item, "channel", ""), get(item, "channel", ""));
    print(`  ${str(item["speaker_role"])} → ${str(get(item, "listener_role", ""))}`
          + `（${str(chan)} / ${str(get(item, "scene_id", ""))}）`);
  }
  print();
  for (const line of wrap(item["stem"], 64)) {
    print(`  ${line}`);
  }
  print();
  (item["options"] as Record<string, any>[]).forEach((o, i) => {
    print(`    ${_letter(i)}. ${str(o["text"])}`);
  });
  print();
}

export function printAnswer(item: Record<string, any>): void {
  const ci = schemas.correctIndex(item["options"]);
  print(`  正解: ${_letter(ci)}. ${str(item["options"][ci]["text"])}`);
  print();
  for (const line of wrap(item["explanation_ja"], 60)) {
    print(`  解説  ${line}`);
  }
  print(`  EN    ${str(item["explanation_en"])}`);
  print();
  print("  なぜ各選択肢が罠なのか (distractor roles):");
  (item["options"] as Record<string, any>[]).forEach((o, i) => {
    if (o["role"] === roles.CORRECT) {
      return;
    }
    print(`    ${_letter(i)}. ${str(o["role"])} — ${str(_lookup(roles.ROLE_DESCRIPTIONS, o["role"], ""))}`);
    for (const line of wrap(get(o, "why", ""), 56)) {
      print(`        ${line}`);
    }
  });
  const notes: Record<string, any>[] = or(get(item, "vocab_notes"), []);
  if (truthy(notes)) {
    print("\n  語彙:");
    for (const n of notes) {
      print(`    ${str(n["term"])}（${str(n["reading"])}） — ${str(n["meaning"])}`);
    }
  }
  print();
}
