/**
 * Fidelity mechanism #2 — the two-sided answerability gate.
 *
 * Every item faces two checks before it reaches the study user:
 *
 *   * FULL:  answer with the complete stimulus — every document, every turn of the
 *            conversation, the narration, the options. A strong model should
 *            SUCCEED. Failure means the item is ambiguous rather than hard.
 *   * COLD:  answer from a reduced view that withholds the half of the stimulus
 *            the type is testing. A strong model should FAIL. Success means the
 *            withheld half was decorative.
 *
 * Each side is run up to config.GATE_TRIALS times and the verdict is by count, so
 * a model that gets it right once out of three cold is noise, not leakage.
 *
 * A trial the judge did not answer — an outage, a refusal, a reply cut off at its
 * token ceiling — is not a wrong answer, and the gate does not count it as one.
 * Scored as wrong it would read as a clean cold side (and the next side would be
 * asked on the strength of it) or an ambiguous full side, and a gate that passes
 * an item because its judge could not be reached is no gate. So one unanswered
 * trial makes the verdict "unchecked": the draft is not kept, and nothing is said
 * about it to the next draft, because nothing was found.
 *
 * What is withheld depends on the type, and the choice is the type's own claim:
 *
 *   * 発言聴解 — the stimulus is the narrated situation, which the test-taker hears
 *     and cannot re-read. Withholding it is the brief's literal cold view: four
 *     candidate utterances with no situation should not be separable, because the
 *     whole point of the type is that appropriateness is situational.
 *   * 語彙・文法, 表現読解, 場面把握 — nothing but a stem and four options, so the
 *     stem is withheld and only the option set is shown. A cold success means the
 *     distractors are individually implausible.
 *   * 状況把握, 資料聴読解, 総合聴読解 — the README's one requirement for these is
 *     that the answer needs BOTH the document and the audio. So the cold view is
 *     the document (with the options) and the audio withheld: a reader who can
 *     pick the key from the page alone has an item whose audio is decorative.
 *     That is also what an options-only cold view would catch, and more, so the
 *     two are not both run.
 *   * 総合聴解 — the question and options without the conversation.
 *   * 総合読解 — the question and options without the passage.
 *   * 画像把握 — the picture is the stimulus and a text gate cannot see it, so the
 *     English brief the picture is drawn from stands in for it on the full side.
 *     The picture itself is judged when it is drawn (bjt/scene_art.ts).
 *
 * The full view carries the whole stimulus. Shown the stem alone, the judge of a
 * document or dialogue type would keep items answerable from the narration alone
 * and discard as ambiguous the items that genuinely need the page — the exact
 * opposite of the requirement.
 *
 * `runTrials`, `_runSide` and `runGate` are async: they ask the model.
 */
import * as config from "../config.ts";
import * as llm from "../llm.ts";
import { get, has, or, PyError, slice, str, strip, sum, toInt, truthy, TypeError_, ValueError } from "../py.ts";
import * as schemas from "../schemas.ts";
import * as textutil from "../textutil.ts";
import * as document from "../render/document.ts";
import { correctIndex } from "../schemas.ts";

/** Python's ZeroDivisionError: a fraction over nothing. */
export class ZeroDivisionError extends PyError {}

/** Python's `fractions.Fraction`, as far as the gate uses it: a ratio of two
 *  integers compared exactly, never as a float (two thirds is not 0.666…). */
export class Fraction {
  readonly numerator: number;
  readonly denominator: number;

  constructor(numerator: number, denominator: number) {
    if (denominator === 0) {
      throw new ZeroDivisionError(`Fraction(${numerator}, 0)`);
    }
    // The sign lives on the numerator, as in Python, so that comparing by
    // cross-multiplication never flips.
    const sign = denominator < 0 ? -1 : 1;
    this.numerator = sign * numerator;
    this.denominator = sign * denominator;
  }

  /** <0, 0 or >0 as this is less than, equal to or greater than `other`. */
  compare(other: Fraction): number {
    return this.numerator * other.denominator - other.numerator * this.denominator;
  }
}

// Keep an item only if the full view is answered by a clear majority...
export const FULL_MIN = new Fraction(2, 3);
// ...and the cold view is NOT — anything above this is treated as leakage.
export const COLD_MAX = new Fraction(1, 3);

export class Trial {
  side: string;
  trial: number;
  chosen: number | null;
  correct: boolean;
  /** The judge's one-sentence justification. Kept because on the cold side it
   *  says exactly what gave the answer away, which is what the next draft on
   *  the same shelf needs to hear (bjt/pipeline.ts feeds it back). */
  reason: string;

  constructor(init: { side: string; trial: number; chosen: number | null; correct: boolean; reason?: string }) {
    this.side = init.side;
    this.trial = init.trial;
    this.chosen = init.chosen;
    this.correct = init.correct;
    this.reason = init.reason ?? "";
  }
}

/** The verdict for a gate that could not get an answer out of its judge for
 *  every trial it asked. Not a "discarded:" verdict: nothing was found wrong
 *  with the item, and no reason goes to the next draft. */
export const UNCHECKED = "unchecked";

export class GateResult {
  /** null when the gate is unchecked: a rate over trials that were not all
   *  answered would be a number about the outage, not about the item. */
  cold_success_rate: number | null;
  /** null for a leaky item: the full side is not run on what is already out. */
  full_success_rate: number | null;
  verdict: string;  // "kept" | "discarded:ambiguous" | "discarded:leaky" | "unchecked"
  trials: Trial[];

  constructor(init: {
    cold_success_rate: number | null;
    full_success_rate: number | null;
    verdict: string;
    trials?: Trial[];
  }) {
    this.cold_success_rate = init.cold_success_rate;
    this.full_success_rate = init.full_success_rate;
    this.verdict = init.verdict;
    this.trials = init.trials ?? [];
  }

  get kept(): boolean {
    return this.verdict === "kept";
  }
}

/** (correct so far, trials run, trials planned) → true once no remaining trial
 *  could change the verdict. The gate's early stop. */
export type Decided = (correct: number, done: number, planned: number) => boolean;

/** Python's OverflowError: `int()` of an infinite float. Not one of the
 *  errors a trial is scored unanswered on, exactly as in Python. */
class OverflowError extends PyError {}

/** Python's `int(x)` of what a judge returned as its choice: a whole number
 *  as itself, a float cut toward zero, a numeral string read, a boolean as 0
 *  or 1; anything else the ValueError or TypeError `int()` raises. */
function _int(x: unknown): number {
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "number") {
    if (Number.isNaN(x)) throw new ValueError("cannot convert float NaN to integer");
    if (!Number.isFinite(x)) throw new OverflowError("cannot convert float infinity to integer");
    return Math.trunc(x);
  }
  if (typeof x === "string") return toInt(x);
  throw new TypeError_(`int() argument must be a string, a bytes-like object or a real number, not '${x === null || x === undefined ? "NoneType" : Array.isArray(x) ? "list" : "dict"}'`);
}

/** Ask `model` the same question up to `trials` times and score each answer.
 *
 *  Shared with the difficulty probe (bjt/fidelity/difficulty.ts), which asks
 *  the gate's full-view question of a weaker model. A call that fails — outage,
 *  refusal, a reply cut off or not an index — is a trial with `chosen=null`,
 *  and the trials stop there: both callers read one unanswered trial as no
 *  result at all (the gate: unchecked; the probe: unmeasured), so every call
 *  after it would be paid for and thrown away. What stops the run — its own
 *  ceiling, an account that cannot pay — is not a failed trial and is raised.
 *
 *  `decided` is the early stop. The gate's verdicts are by count over the
 *  planned trials, so once the count already settles the verdict — two right
 *  of three on the cold side, say — the third call cannot change it and is
 *  not made. The verdict is identical to running every trial; only the bill
 *  is smaller. The probe passes nothing here: it wants the rate itself. */
export async function runTrials(
  question: string,
  options: string[],
  answer: number,
  side: string,
  opts: { model: string; trials: number; decided?: Decided | null },
): Promise<Trial[]> {
  const { model, trials } = opts;
  const decided = opts.decided ?? null;
  const out: Trial[] = [];
  for (let t = 0; t < trials; t++) {
    let reason = "";
    let chosen: number | null;
    try {
      const res = await llm.answerChoice(question, options, { model: model });
      chosen = _int(get(res, "choice", -1));
      reason = str(or(get(res, "reason", ""), ""));
    } catch (e) {
      if (e instanceof llm.LLMBillingError) {
        throw e;  // not an unanswered trial: the run itself has to stop
      }
      if (!(e instanceof llm.LLMError || e instanceof ValueError || e instanceof TypeError_)) {
        throw e;
      }
      chosen = null;
    }
    out.push(new Trial({ side: side, trial: t, chosen: chosen, correct: chosen === answer, reason: reason }));
    if (chosen === null) {
      break;
    }
    if (decided && decided(sum(out.map((x) => (x.correct ? 1 : 0))), out.length, trials)) {
      break;
    }
  }
  return out;
}

/** True when any trial got no answer — or none was asked at all. */
export function unanswered(trials: Trial[]): boolean {
  return trials.length === 0 || trials.some((t) => t.chosen === null);
}

export function isLeaky(correct: number, planned: number): boolean {
  return new Fraction(correct, planned).compare(COLD_MAX) > 0;
}

export function isAmbiguous(correct: number, planned: number): boolean {
  return new Fraction(correct, planned).compare(FULL_MIN) < 0;
}

/** Leaky already, or clean even if every remaining trial were right. */
export function coldDecided(correct: number, done: number, planned: number): boolean {
  return isLeaky(correct, planned) || !isLeaky(correct + (planned - done), planned);
}

/** Answerable already, or ambiguous even if every remaining trial were right. */
export function fullDecided(correct: number, done: number, planned: number): boolean {
  return !isAmbiguous(correct, planned) || isAmbiguous(correct + (planned - done), planned);
}

export async function _runSide(question: string, options: string[], answer: number, side: string,
                               decided: Decided): Promise<Trial[]> {
  return runTrials(question, options, answer, side,
                   { model: config.JUDGE_MODEL, trials: config.GATE_TRIALS, decided: decided });
}

// ----- the two views ------------------------------------------------------

export function _documentsText(item: Record<string, any>): string {
  const docs = schemas.documentsOf(item);
  if (docs.length === 0) {
    return "";
  }
  return docs.map((d, i) => `=== 資料 ${i + 1} ===\n${document.textOf(d)}`).join("\n\n");
}

export function _dialogueText(item: Record<string, any>): string {
  const turns: Record<string, any>[] = or(get(item, "dialogue"), []);
  if (!truthy(turns)) {
    return "";
  }
  return "=== 会話 ===\n" + turns.map(
    (t) => `${str(get(t, "speaker_role", ""))}：${str(get(t, "text", ""))}`).join("\n");
}

export function _join(...parts: string[]): string {
  return parts.filter((p) => truthy(p)).join("\n\n");
}

/** Which half is withheld on the cold side, in the words the judge is shown. */
export const _WITHHELD: Record<string, string> = {
  joukyou_haaku: "the spoken request",
  shiryou_choudokkai: "the spoken prompt",
  sougou_choudokkai: "the conversation and the spoken question",
  sougou_choukai: "the conversation",
  sougou_dokkai: "the passage",
};

/** What the cold view hides for a type, in words a generator or a judge can
 *  be told: the half the answer must depend on. */
export function withheldHalf(itemType: string): string {
  if (has(_WITHHELD, itemType)) {
    return _WITHHELD[itemType];
  }
  if (itemType === "hatsugen_choukai") {
    return "the situation";
  }
  if (itemType === "gazou_haaku") {
    return "the picture";
  }
  return "the stem";
}

/** The full-view and cold-view prompts, worded for the item type. */
export function questions(item: Record<string, any>): [string, string] {
  const itemType = get(item, "item_type", "");
  const stem = get(item, "stem", "");
  const docs = _documentsText(item);
  const dialogue = _dialogueText(item);

  if (itemType === "hatsugen_choukai") {
    const full = _join(stem, "Which of these utterances is the appropriate thing to say "
                           + "in that situation?");
    const cold = (
      "A BJT 発言聴解 item asks which utterance fits a described situation. The "
      + "situation has been withheld. Based ONLY on the four candidate utterances "
      + "below, which one is the intended correct answer?"
    );
    return [full, cold];
  }

  if (itemType === "gazou_haaku") {
    const brief = get(item, "image_brief", "");
    const full = _join(
      "The test-taker is shown a picture. This is what the picture shows:\n" + brief,
      stem, "Which option correctly describes the picture?");
    const cold = (
      "A BJT 画像把握 item shows a picture and asks which spoken description fits "
      + "it. The picture and the question have been withheld. Based ONLY on the "
      + "four candidate descriptions below, which one is the intended correct answer?"
    );
    return [full, cold];
  }

  if (["joukyou_haaku", "shiryou_choudokkai", "sougou_choudokkai"].includes(itemType)) {
    const full = _join(docs, dialogue, stem,
                       "Using the document(s) and what was said, which option is correct?");
    const cold = _join(
      docs,
      `A BJT ${str(itemType)} item pairs the document(s) above with audio: `
      + `${_WITHHELD[itemType]}. The audio has been withheld. Based ONLY on the `
      + "document(s) and the four options below, which one is the intended "
      + "correct answer?");
    return [full, cold];
  }

  if (itemType === "sougou_choukai") {
    const full = _join(dialogue, stem, "Which option correctly answers the question?");
    const cold = _join(
      stem,
      "This question is about a conversation that has been withheld. Based ONLY "
      + "on the question and the four options below, which one is the intended "
      + "correct answer?");
    return [full, cold];
  }

  if (itemType === "sougou_dokkai") {
    const full = _join(docs, stem, "Which option correctly answers the question?");
    const cold = _join(
      stem,
      "This question is about a passage that has been withheld. Based ONLY on "
      + "the question and the four options below, which one is the intended "
      + "correct answer?");
    return [full, cold];
  }

  const full = _join(docs, dialogue, stem, "Which option correctly completes/answers this item?");
  const cold = (
    "The stem of a BJT item has been withheld. Based ONLY on the four candidate "
    + "options below, which one is the intended correct answer for the hidden stem?"
  );
  return [full, cold];
}

/** What a leaky verdict means for this type, in one sentence for the
 *  generator's next attempt (bjt/pipeline.ts feeds it back) — with the judge's own
 *  words for how it found the answer, when the result is given. "The
 *  distractors gave it away" leaves the next draft failing the same way;
 *  "Option 2 was the only one in humble form" is something a writer can act on. */
export function leakDescription(itemType: string, opts: { result?: GateResult | null } = {}): string {
  const result = opts.result ?? null;
  let what: string;
  if (has(_WITHHELD, itemType)) {
    what = (`a reviewer picked the correct option without ${_WITHHELD[itemType]}, `
            + "so the withheld half was decorative — the answer must depend on it");
  } else if (itemType === "hatsugen_choukai") {
    what = ("a reviewer picked the correct utterance without hearing the situation, "
            + "so the distractors gave the answer away on their own");
  } else {
    what = ("a reviewer picked the correct option from the four options alone, with "
            + "the stem hidden, so the distractors gave the answer away on their own");
  }
  if (result !== null) {
    const tells = result.trials
      .filter((t) => t.side === "cold" && t.correct && strip(t.reason))
      .map((t) => strip(t.reason));
    if (tells.length) {
      what += ". The reviewer's own words for how: " + [...new Set(tells)].map(
        (r) => `“${slice(r, 0, 240)}”`).join(" / ");
      // The next draft is a new item, not a repair of this one, so it is
      // told how to defeat the guess, not to rewrite these options.
      what += (". In the next draft, make that way of guessing land on a "
               + "distractor: give a distractor the answer that looks likeliest "
               + `without ${withheldHalf(itemType)}, and let ${withheldHalf(itemType)} `
               + "be what rules it out");
    }
  }
  return what;
}

/** Run the cold side, then the full side only if the cold side passed.
 *
 *  Cold first because it is the side that discards. A leaky item is out
 *  whatever the full view says, so asking the full question of it is three
 *  strong-model calls that cannot change the verdict. Cold-first halves the
 *  cost of a discard and leaves a kept item exactly as it was: both sides run,
 *  both rates recorded. A leaky item carries no full rate, not a fake one.
 *
 *  A side with an unanswered trial ends the gate there, unchecked: an
 *  unanswered cold trial scored as a miss is how an item whose judge was
 *  down would otherwise walk through. */
export async function runGate(item: Record<string, any>): Promise<GateResult> {
  const options = textutil.optionTexts(item);
  const answer = correctIndex(item["options"]);
  const planned = config.GATE_TRIALS;

  const [fullQ, coldQ] = questions(item);

  const coldTrials = await _runSide(coldQ, options, answer, "cold", coldDecided);
  if (unanswered(coldTrials)) {
    return new GateResult({ cold_success_rate: null, full_success_rate: null,
                            verdict: UNCHECKED, trials: coldTrials });
  }
  const coldCorrect = sum(coldTrials.map((t) => (t.correct ? 1 : 0)));
  const coldRate = coldCorrect / coldTrials.length;
  if (isLeaky(coldCorrect, planned)) {
    return new GateResult({
      cold_success_rate: coldRate,
      full_success_rate: null,
      verdict: "discarded:leaky",
      trials: coldTrials,
    });
  }

  const fullTrials = await _runSide(fullQ, options, answer, "full", fullDecided);
  if (unanswered(fullTrials)) {
    return new GateResult({ cold_success_rate: null, full_success_rate: null,
                            verdict: UNCHECKED, trials: [...fullTrials, ...coldTrials] });
  }
  const fullCorrect = sum(fullTrials.map((t) => (t.correct ? 1 : 0)));
  const fullRate = fullCorrect / fullTrials.length;
  const verdict = isAmbiguous(fullCorrect, planned) ? "discarded:ambiguous" : "kept";

  return new GateResult({
    cold_success_rate: coldRate,
    full_success_rate: fullRate,
    verdict: verdict,
    trials: [...fullTrials, ...coldTrials],
  });
}
