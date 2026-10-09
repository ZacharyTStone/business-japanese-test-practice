/**
 * Fidelity mechanism #6 — the cheap sanity check, run the moment an item exists.
 *
 * The answerability gate (mechanism #2) is the expensive one: two sides, three
 * trials each, six calls to a strong model per item. It measures the two things
 * only a strong reader can measure — whether the item is answerable from the
 * stimulus, and whether the distractors leak the answer. What it does *not* do is
 * notice that the 解説 explains option 2 while option 1 is marked correct, or that
 * two options are the same sentence, or that a particle is missing. Those are not
 * hard judgements. They are proofreading, and paying Opus six times to trip over
 * one is the wrong shape of spend.
 *
 * So this runs first, once, on a small model, and the expensive gate only ever
 * sees items that got past it. A broken item costs one Haiku call instead of six
 * Opus ones, and is gone before the gate starts.
 *
 * **What it is allowed to fail an item for.** Only faults that are faults at any
 * difficulty. An item is *supposed* to be hard: a cheap model disagreeing about
 * which 敬語 form a senior manager would use is the item working, not the item
 * broken, and a check that discarded on that would quietly delete exactly the
 * items worth keeping. So the flags below are worded for defects a proofreader
 * sees — the marked answer being impossible rather than merely debatable, a second
 * option being just as right, the explanation naming a different option, Japanese
 * no writer would produce, options that do not answer the question asked. Anything
 * that needs expertise to adjudicate is the gate's job, and stays there.
 *
 * **Unnatural is a fault even in a distractor.** A distractor is wrong on
 * purpose, but that does not exempt it from being read: it has to be wrong the
 * way people are wrong, and a stack of keigo nobody says tells the learner which
 * option is the silly one and teaches nothing else. The rules
 * `unnatural_japanese` and `situation_incoherent` check that. Their mechanical
 * half — the patterns no reader is needed for — runs offline and for free in
 * `naturalness.faults`.
 *
 * `runCheck` is async: it calls the model.
 */
import * as config from "../config.ts";
import * as llm from "../llm.ts";
import { errText, get, or, str, truthy } from "../py.ts";
import * as schemas from "../schemas.ts";
import * as document from "../render/document.ts";
import * as roles from "./roles.ts";

/** flag → what a `true` on it means, in the words the model is shown. Keys are
 *  the schema's required properties, so adding a rule here adds it to the call. */
export const RULES: Record<string, string> = {
  answer_impossible: (
    "the option marked correct cannot be the answer — it is ungrammatical, "
    + "contradicts the situation, or answers a different question. NOT merely "
    + "that you would have argued for another option"
  ),
  second_answer_defensible: (
    "another option is just as correct as the one marked correct, so the item "
    + "has two answers — including a distractor that is standard, natural Japanese "
    + "in this exact sentence and situation, which a native editor would not "
    + "correct, marked wrong only on preference (ご確認くださいますよう beside "
    + "ご確認いただきますよう). A register the situation really rules out, such as "
    + "外しています to a client on the phone, is a wrong answer, not a second one"
  ),
  // The whys and roles are what a learner reads after a wrong answer, so a
  // miscounted date or a trap that names the wrong mistake teaches it.
  explanation_mismatch: (
    "the 解説 justifies a different option than the one marked correct, or "
    + "states something the item contradicts; or an option's why gets a fact "
    + "wrong — a date, a weekday, a count or a sum that does not follow from the "
    + "document and the conversation (the day after the 25th is the 26th); or a "
    + "distractor's role names a mistake that would not lead anybody to choose it "
    + "(a date marked as the wrong person's action, a room marked as a shared word "
    + "when the word is in every option)"
  ),
  broken_japanese: (
    "Japanese no writer would produce: a typo, a dropped or wrong particle, a "
    + "mangled 敬語 form, a truncated sentence. NOT unusual-but-correct wording, "
    + "and NOT a distractor that is deliberately impolite or wrongly pitched — "
    + "those are the point of the item"
  ),
  // The two below ask what the four above do not: an item can be answerable
  // and correctly keyed and still unnatural, and the exemption in
  // `broken_japanese` for deliberately wrong distractors would let it through.
  unnatural_japanese: (
    "a line — in the stimulus, the correct option OR a distractor — that no native "
    + "speaker would actually say or write, even though each word is real: an "
    + "invented keigo stack (させていただかせていただく, 申させていただく), an "
    + "honorific given to a thing (宅配便がお見えになる), a parody chain of set phrases, "
    + "a placeholder read as a name (〇〇商事), a sentence whose halves do not connect. "
    + "NOT a distractor wrong the way real people are wrong — one common 二重敬語, "
    + "casual speech to a superior — and NOT a 語彙・文法 option whose role is "
    + "nonexistent_form, which is meant not to be a word"
  ),
  situation_incoherent: (
    "the item does not hang together: the narration states the answer, an option "
    + "is about a different person from the one the question asks about, the 解説 "
    + "or a why describes a different situation from the stem, cause and effect in "
    + "the story run backwards, or the setup is not something that happens in a "
    + "Japanese office (asking a peer for permission to leave, asking another "
    + "department's permission on a posted notice)"
  ),
  options_not_parallel: (
    "the options do not answer the question the stem asks, or two of them say "
    + "the same thing in different words"
  ),
};

export class SanityResult {
  /** Every rule that came back true. Empty means the item reads clean. */
  faults: string[];
  notes: string;
  /** False when no check ran — switched off, or the call failed. An item that
   *  was never checked is not an item that passed, and the caller says which. */
  checked: boolean;

  constructor(init: { faults?: string[]; notes?: string; checked?: boolean } = {}) {
    this.faults = init.faults ?? [];
    this.notes = init.notes ?? "";
    this.checked = init.checked ?? true;
  }

  get ok(): boolean {
    return this.faults.length === 0;
  }

  detail(): string {
    if (!this.checked) {
      return "sanity=skipped";
    }
    if (this.ok) {
      return "sanity=clean";
    }
    return `sanity=${this.faults.join("+")}`;
  }
}

/** Everything the item is made of, answer included.
 *
 *  The discriminator's renderer deliberately hides our metadata and shows the
 *  item as a test-taker meets it. This one is the opposite: the checker is
 *  proofreading, so it is shown the stimulus AND the answer key AND the
 *  explanation, because half of what it is looking for is a disagreement
 *  between them. */
export function renderForSanity(item: Record<string, any>): string {
  const lines = [`[${str(get(item, "item_type", ""))} / ${str(get(item, "level", ""))}]`];

  const who = [get(item, "speaker_role"), get(item, "listener_role")].filter((x) => truthy(x)).join(" → ");
  if (truthy(who) || truthy(get(item, "channel"))) {
    lines.push(`場面: ${who}（${str(get(item, "channel", ""))}）`);
  }

  for (const doc of schemas.documentsOf(item)) {
    lines.push("--- 資料 ---");
    lines.push(document.textOf(doc));
  }

  const turns: Record<string, any>[] = or(get(item, "dialogue"), []);
  if (truthy(turns)) {
    lines.push("--- 会話 ---");
    lines.push(...turns.map((t) => `${str(get(t, "speaker_role", ""))}：${str(get(t, "text", ""))}`));
  }

  lines.push("--- 問題 ---");
  lines.push(get(item, "stem", ""));
  // Each option with its role: `unnatural_japanese` must not fire on a
  // 語彙・文法 distractor built not to be a word, and without the role the
  // checker cannot tell that one from a mistake. Under it, what the role means
  // and the option's why — the feedback a learner who picks it is shown — so
  // `explanation_mismatch` can check both.
  (get(item, "options", []) as Record<string, any>[]).forEach((o, i) => {
    const role = str(get(o, "role", ""));
    lines.push(`${i}. ${str(get(o, "text", ""))}　［${role}］`);
    const meaning = get(roles.ROLE_DESCRIPTIONS, role);
    if (truthy(meaning)) {
      lines.push(`   ［${role}］ = ${str(meaning)}`);
    }
    if (truthy(get(o, "why"))) {
      lines.push(`   why: ${str(o["why"])}`);
    }
  });

  const ci = schemas.correctIndex(item["options"]);
  lines.push(`正解として印がついているのは: ${ci}. ${str(get(item["options"][ci], "text", ""))}`);
  lines.push(`解説: ${str(get(item, "explanation_ja", ""))}`);
  if (truthy(get(item, "explanation_en"))) {
    lines.push(`English gloss: ${str(item["explanation_en"])}`);
  }
  return lines.join("\n");
}

/** One call. A failure to reach the model is not a failure of the item.
 *
 *  An item that could not be checked is reported as unchecked rather than as
 *  clean: the expensive gate still runs on it, and the batch's own offline
 *  checks still see it. Treating an outage as a pass would be the one way this
 *  mechanism could make the library worse than not having it. */
export async function runCheck(item: Record<string, any>, opts: { model?: string | null } = {}): Promise<SanityResult> {
  const model = opts.model ?? null;
  if (!config.SANITY_ENABLED) {
    return new SanityResult({ checked: false, notes: "sanity check disabled" });
  }
  let verdict: Record<string, any>;
  try {
    verdict = await llm.sanityCheck(renderForSanity(item), RULES, { model: model });
  } catch (e) {
    if (e instanceof llm.LLMBillingError) {
      throw e;  // the run's ceiling, or an empty account: the run stops, not the item
    }
    if (e instanceof llm.LLMError) {
      return new SanityResult({ checked: false, notes: `sanity check did not run: ${errText(e)}` });
    }
    throw e;
  }

  const faults = Object.keys(RULES).filter((rule) => get(verdict, rule) === true);
  return new SanityResult({ faults: faults, notes: str(get(verdict, "notes", "")) });
}
