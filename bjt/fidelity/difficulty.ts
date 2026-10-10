/**
 * The difficulty probe — a second, cheaper measurement, run on the items the gate kept.
 *
 * `items.model_p_correct` is the practice queue's prior on how hard an item is,
 * used until enough learners have answered it for the bank to count. The
 * answerability gate's own full-view success rate is nearly useless as that
 * prior: the gate asks a strong model, with the whole stimulus in front of it,
 * whether the item can be answered at all, and a strong model says yes to almost
 * everything. With three trials the rate can only be 0.67 or 1.0, and it is 1.0
 * for nearly every item that ships — a prior that does not vary cannot order
 * anything.
 *
 * The gate is right as it is. "Answerable?" and "leaky?" are questions for a
 * strong reader, and they are pass/fail. Difficulty is a different question with
 * a different instrument: a *weaker* model, asked the same full-view question
 * several times, fails on some items and not others, and the items it fails on
 * are, roughly, the ones a learner would find hard. That spread is the whole
 * value. So this runs the gate's full view again on `config.DIFFICULTY_MODEL`
 * (the proofreader's cheap model by default) for `config.DIFFICULTY_TRIALS`
 * trials, and the pass rate is what ships as `model_p_correct`.
 *
 * Two rules the caller relies on:
 *
 *   * It runs after the gate and only on items the gate kept (or when the gate
 *     was skipped). Cheapest-first is the pipeline's shape: nothing is spent
 *     measuring the difficulty of an item that is not going to ship.
 *   * A probe that could not run — switched off, model unreachable, refusals —
 *     reports `measured=false` and no rate. The caller then falls back to the
 *     gate's rate. A fabricated number would be worse than that one, because the
 *     queue would trust it.
 *
 * The rate is a confidence, not a pass count (from 2026-10-10,
 * `config.DIFFICULTY_METHOD = "confidence"`). Five picks from a model that
 * knows the answer are five right answers whether it was sure or torn, so a
 * pass rate was 1.0 for about half the bank and ordered nothing there. Asked
 * instead for a probability on every option, the model says how torn it is,
 * and the mean probability on the key spreads where the count could not. The
 * options are asked once per rotation of their order, so a habit of trusting
 * the first or the last option cancels out. "trials", the pass rate, stays for
 * comparison. Each bundle carries the method its rates came from
 * (`difficulty_method`, bjt/backfill.ts), so the bank never mixes the two.
 *
 * A prototype second instrument: when `config.DIFFICULTY_MODEL` is a Jev model
 * (bjt/jev.ts) the probe is one call, and the rate is the probability Jev puts on
 * the key rather than a count of trials. That is a different number from a pass
 * rate — a confidence, not a frequency — so a bank should carry one or the other,
 * not a mixture; `bjt probe --compare` sets them side by side before either is
 * chosen.
 *
 * `measure` and `_byProbability` are async: they ask the model.
 */
import * as config from "../config.ts";
import * as jev from "../jev.ts";
import * as llm from "../llm.ts";
import { errText, fixed, max, percent, range } from "../py.ts";
import * as textutil from "../textutil.ts";
import { correctIndex } from "../schemas.ts";
import * as answerability from "./answerability.ts";
import { Trial } from "./answerability.ts";

/** The `side` the probe's trials are recorded under in `gate_trials`, next to
 *  the gate's 'cold' and 'full'. */
export const SIDE = "difficulty";

export class DifficultyResult {
  /** Fraction of trials the probe answered correctly. null when not measured. */
  rate: number | null;
  /** Which model produced the rate, so a batch's provenance is readable later. */
  model: string;
  /** False when no rate was produced — switched off, or the model could not
   *  be reached for every trial. Never confuse that with a rate of 0.0. */
  measured: boolean;
  notes: string;
  trials: Trial[];

  constructor(init: { rate?: number | null; model?: string; measured?: boolean; notes?: string; trials?: Trial[] } = {}) {
    this.rate = init.rate ?? null;
    this.model = init.model ?? "";
    this.measured = init.measured ?? false;
    this.notes = init.notes ?? "";
    this.trials = init.trials ?? [];
  }

  detail(): string {
    if (!this.measured) {
      return this.trials.length === 0 ? "difficulty=skipped" : "difficulty=unmeasured";
    }
    return `difficulty=${percent(this.rate as number)} (${this.model})`;
  }
}

/** Ask the difficulty model the gate's full-view question, several times.
 *
 *  Every trial has to come back with an answer for the rate to count. A trial
 *  the model did not answer is not a wrong answer — here it would drag the
 *  rate down and call the item harder than it is, as in the gate it would
 *  call a leaky item clean — so one failed trial leaves the item unmeasured
 *  and the caller on the gate's rate. */
export async function measure(item: Record<string, any>, opts: { model?: string | null } = {}): Promise<DifficultyResult> {
  if (!config.DIFFICULTY_ENABLED) {
    return new DifficultyResult({ measured: false, notes: "difficulty probe disabled" });
  }

  const model = opts.model || config.DIFFICULTY_MODEL;
  const options = textutil.optionTexts(item);
  const answer = correctIndex(item["options"]);
  const [fullQ] = answerability.questions(item);

  if (jev.isJev(model)) {
    return _byProbability(fullQ, options, answer, model);
  }
  if (method(model) === "confidence") {
    return _byConfidence(fullQ, options, answer, model);
  }

  const trials = await answerability.runTrials(fullQ, options, answer, SIDE,
                                               { model: model, trials: config.DIFFICULTY_TRIALS });
  const unanswered = trials.filter((t) => t.chosen === null);
  if (trials.length === 0 || unanswered.length) {
    return new DifficultyResult({
      model: model, measured: false, trials: trials,
      notes: `difficulty probe did not run: ${unanswered.length} of ${trials.length} `
             + "trial(s) got no answer",
    });
  }
  const rate = answerability.correctCount(trials) / trials.length;
  return new DifficultyResult({ rate: rate, model: model, measured: true, trials: trials });
}

/** The kind of number the probe writes with `model`: "jev" (Jev's own
 *  probability), "confidence" or "trials". Rates of different kinds are not
 *  comparable, so a bundle records this beside them. */
export function method(model?: string | null): string {
  return jev.isJev(model || config.DIFFICULTY_MODEL) ? "jev" : config.DIFFICULTY_METHOD;
}

/** What measuring one item costs in calls, for a dry run's arithmetic. A
 *  confidence probe asks once per rotation of the four options. */
export function callsPerItem(opts: { model?: string | null } = {}): number {
  const m = method(opts.model);
  return m === "jev" ? 1 : m === "confidence" ? OPTIONS : config.DIFFICULTY_TRIALS;
}

/** Every item offers four options (the generators trim a fifth). */
export const OPTIONS = 4;

/** The options in the order trial `t` shows them: rotated `t` places, so
 *  across one trial per option every option sits in every position once. */
export function rotation(n: number, t: number): number[] {
  return range(n).map((i) => (i + t) % n);
}

/** One confidence per rotation of the options; the rate is the mean
 *  probability on the key. Each trial is also recorded as a pick (its most
 *  likely option), so the local quality report still reads it. One reply
 *  that is not a distribution leaves the item unmeasured, as a failed trial
 *  does for the pass rate. */
export async function _byConfidence(question: string, options: string[], answer: number,
                                    model: string): Promise<DifficultyResult> {
  const trials: Trial[] = [];
  const onKey: number[] = [];
  for (let t = 0; t < options.length; t++) {
    const order = rotation(options.length, t);
    let shown: number[];
    try {
      shown = await llm.choiceConfidence(question, order.map((i) => options[i]), { model: model });
    } catch (e) {
      if (e instanceof llm.LLMBillingError) {
        throw e;
      }
      if (!(e instanceof llm.LLMError)) throw e;
      trials.push(new Trial({ side: SIDE, trial: t, chosen: null, correct: false }));
      return new DifficultyResult({
        model: model, measured: false, trials: trials,
        notes: `difficulty probe did not run: ${errText(e)}`,
      });
    }
    // Back to the options' own order: shown[k] is the option order[k].
    const probs = new Array<number>(options.length).fill(0);
    order.forEach((i, k) => { probs[i] = shown[k]; });
    const chosen = max(range(probs.length), (i) => probs[i]);
    onKey.push(probs[answer]);
    trials.push(new Trial({ side: SIDE, trial: t, chosen: chosen, correct: chosen === answer,
                            reason: `p = ${probs.map((p) => fixed(p, 2)).join(" ")}` }));
  }
  // Three places: the model's own figures carry no more, and a bundle
  // should not churn on noise in the ninth digit.
  const rate = Math.round((onKey.reduce((a, b) => a + b, 0) / onKey.length) * 1000) / 1000;
  return new DifficultyResult({ rate: rate, model: model, measured: true, trials: trials });
}

/** One call to a model that answers with a distribution; the key's share
 *  of it is the rate. The one trial recorded is its most likely option, so
 *  the local quality report (which counts right answers) still reads it.
 *  A failed call is unmeasured, exactly as a failed trial is above. */
export async function _byProbability(question: string, options: string[], answer: number,
                                     model: string): Promise<DifficultyResult> {
  let probs: number[];
  try {
    probs = await jev.choiceProbabilities(question, options, { model: model });
  } catch (e) {
    if (e instanceof llm.LLMBillingError) {
      throw e;
    }
    if (!(e instanceof llm.LLMError)) throw e;
    return new DifficultyResult({
      model: model, measured: false,
      trials: [new Trial({ side: SIDE, trial: 0, chosen: null, correct: false })],
      notes: `difficulty probe did not run: ${errText(e)}`,
    });
  }
  const chosen = max(range(probs.length), (i) => probs[i]);
  const spread = probs.map((p) => fixed(p, 2)).join(" ");
  return new DifficultyResult({
    rate: probs[answer], model: model, measured: true,
    trials: [new Trial({ side: SIDE, trial: 0, chosen: chosen, correct: chosen === answer,
                         reason: `p = ${spread}` })],
  });
}
