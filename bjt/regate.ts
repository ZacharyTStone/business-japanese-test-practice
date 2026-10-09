/**
 * The review the bank never had: the proofreader and the gate, after the fact.
 *
 * `bjt importbatch` checks the shape of a hand-written item and stops there, and
 * most of the bank arrived that way. `regateBank` is the review: the
 * proofreader (bjt/fidelity/sanity.ts) and then, if it found nothing, the
 * answerability gate (bjt/fidelity/answerability.ts) — the order and the rules a
 * fresh draft meets in `pipeline.generateAndGate`, asked of questions that
 * shipped without meeting them. Every verdict goes into `batches/regated.txt`
 * the moment it is reached, and a question that fails is *proposed* for
 * `batches/withdrawn.txt` — written there only with `--withdraw`, in that
 * ledger's own format and closed set of reasons, and even then only as a diff
 * somebody reads before the merge that ships it.
 *
 * Built to be stopped, like the probe (bjt/backfill.ts): a verdict is written
 * down the moment it is reached, so a run the ceilings end carries on where it
 * stopped and no question is paid for twice. Only live questions: a withdrawn
 * one is never served.
 *
 * `regateItem` and `regateBank` are async: they ask the models.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as batchmod from "./batch.ts";
import * as config from "./config.ts";
import * as answerability from "./fidelity/answerability.ts";
import * as sanity from "./fidelity/sanity.ts";
import * as llmmod from "./llm.ts";
import { errText, get, isodateUtc, min, or, print, repr, slice, splitlines, splitWs, splitWsMax, str, strip, sum, ValueError } from "./py.ts";
import * as publish from "./publish.ts";
import * as withdrawn from "./withdrawn.ts";
import { type Log, Shelf, surveyBundles, UNREACHABLE_PATIENCE } from "./backfill.ts";
import type { Item } from "./types.ts";

export const REGATE_LEDGER_NAME = "regated.txt";

/** The pipeline's own words for what the checks said (`gate_verdict` in the
 *  local store), and one more that only a person writes: `overruled`, for a
 *  failure the owner read and decided to keep. */
export const VERDICTS: readonly string[] = ["kept", "discarded:sanity", "discarded:leaky", "discarded:ambiguous", "overruled"];

/** Which reason a proofreader's flag withdraws a question for, in
 *  `withdrawn.REASONS` — the closed set a tester's report uses. Most serious
 *  first: when several flags are raised, the first of them in this order names
 *  the line, and the sentence lists them all. A flag with no entry here fails a
 *  test, so the proofreader cannot grow a rule the ledger has no word for. */
export const SANITY_REASONS: Readonly<Record<string, string>> = {
  "answer_impossible": "wrong_answer",       // the marked answer cannot be right
  "second_answer_defensible": "ambiguous",   // another option is as right
  // The 解説 or the story does not hang together, or the options do not answer
  // the question: a question that cannot be understood as it stands. A person
  // reviewing the bank files the same faults under `unclear`.
  "explanation_mismatch": "unclear",
  "situation_incoherent": "unclear",
  "options_not_parallel": "unclear",
  "unnatural_japanese": "unnatural",
  "broken_japanese": "unnatural",
};

export const _HEADER = `\
# Committed questions put through the proofreader and the answerability gate
# after they shipped (\`bjt regate\`), and what each said.
#
# One line per item:  <item id>  <verdict>  <date>  <reason>  <what was found>
# The verdict is the pipeline's own: kept, discarded:sanity, discarded:leaky or
# discarded:ambiguous. The reason is what \`bjt regate --withdraw\` writes into
# batches/withdrawn.txt for a question that failed (the closed set a tester's
# report uses), and - for one that did not.
#
# A line here means the question has been checked, and \`bjt regate\` skips it:
# that is what lets a run stopped by its ceiling carry on where it stopped.
# Delete a line to have the question checked again. To keep a question that
# failed, change its verdict to \`overruled\`; --withdraw never proposes one.
`;

export class Regated {
  readonly item_id: string;
  readonly verdict: string;
  readonly date: string;
  /** A `withdrawn.REASONS` member for a failure; "-" when there is nothing
   *  to withdraw. */
  readonly reason: string;
  readonly note: string;

  constructor(init: { item_id: string; verdict: string; date: string; reason: string; note: string }) {
    this.item_id = init.item_id;
    this.verdict = init.verdict;
    this.date = init.date;
    this.reason = init.reason;
    this.note = init.note;
  }

  get failed(): boolean {
    return this.verdict.startsWith("discarded");
  }
}

/** Read at call time, so a test that points BATCH_DIR elsewhere is obeyed. */
export function regateLedgerPath(): string {
  return path.join(config.BATCH_DIR, REGATE_LEDGER_NAME);
}

/** The regate ledger, by item id. A missing file is an empty ledger; a
 *  malformed line is an error, as it is in withdrawn.txt, because a line read
 *  wrongly is a question checked again or a failure never proposed.
 *
 *  A `Map`, in the file's order (Python's dict): an item id is ten hex
 *  digits, and one made of digits alone would jump the queue as a key of a
 *  plain object. */
export function loadRegated(opts: { path?: string | null } = {}): Map<string, Regated> {
  const p = opts.path ?? regateLedgerPath();
  if (!existsSync(p)) {
    return new Map();
  }
  const name = path.basename(p);
  const out = new Map<string, Regated>();
  const lines = splitlines(readFileSync(p, "utf8"));
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const text = strip(lines[i]);
    if (!text || text.startsWith("#")) {
      continue;
    }
    const parts = splitWsMax(text, 4);
    if (parts.length < 5) {
      throw new ValueError(`${name}:${n}: expected `
                           + "'<item id> <verdict> <date> <reason> <what was found>'");
    }
    const [itemId, verdict, date, reason, note] = parts;
    if (!VERDICTS.includes(verdict)) {
      throw new ValueError(`${name}:${n}: verdict ${repr(verdict)} is not one of `
                           + `${VERDICTS.join(", ")}`);
    }
    if (reason !== "-" && !withdrawn.REASONS.includes(reason)) {
      throw new ValueError(`${name}:${n}: reason ${repr(reason)} is not one of `
                           + `${withdrawn.REASONS.join(", ")} or -`);
    }
    if (verdict.startsWith("discarded") && reason === "-") {
      throw new ValueError(`${name}:${n}: a ${verdict} question needs a reason`);
    }
    if (out.has(itemId)) {
      throw new ValueError(`${name}:${n}: ${itemId} is recorded twice`);
    }
    out.set(itemId, new Regated({ item_id: itemId, verdict, date, reason, note: strip(note) }));
  }
  return out;
}

/** Append one verdict, at once: the ledger is the run's progress, and a
 *  run can be stopped by its ceiling between any two items. */
export function recordRegated(entry: Regated, opts: { path?: string | null } = {}): void {
  const p = opts.path ?? regateLedgerPath();
  // Read as Python's read_text reads, line endings made "\n".
  const before = existsSync(p) ? readFileSync(p, "utf8").replace(/\r\n?/g, "\n") : null;
  let text = "";
  if (before === null) {
    text += _HEADER + "\n";
  } else if (before && !before.endsWith("\n")) {
    text += "\n";  // a hand edit that left no newline must not swallow this line
  }
  text += `${entry.item_id}  ${entry.verdict.padEnd(19)}  ${entry.date}  ${entry.reason.padEnd(12)}  `
          + `${splitWs(entry.note).join(" ")}\n`;
  appendFileSync(p, text, { encoding: "utf8" });
}

/** The judge's own words from the first trial that went this way. */
export function _said(trials: answerability.Trial[], opts: { correct: boolean }): string {
  const hit = trials.find((t) => t.correct === opts.correct && strip(t.reason));
  const said = hit !== undefined ? strip(hit.reason) : "";
  return said ? `; the reviewer: “${slice(splitWs(said).join(" "), 0, 200)}”` : "";
}

/** What the proofreader and the gate said about one committed question. */
export class Review {
  /** One of VERDICTS but `overruled`, or null when a check could not run —
   *  an outage decides nothing, and is not written down as though it had. */
  verdict: string | null;
  reason: string;
  note: string;

  constructor(init: { verdict: string | null; reason?: string; note?: string }) {
    this.verdict = init.verdict;
    this.reason = init.reason ?? "-";
    this.note = init.note ?? "";
  }
}

/** The proofreader, then the gate if it found nothing. `item` is in
 *  generator shape (`batch.asGeneratorShape`). */
export async function regateItem(item: Item): Promise<Review> {
  const sres = await sanity.runCheck(item);
  if (!sres.checked) {
    return new Review({ verdict: null, note: `the proofreader did not run: ${slice(sres.notes, 0, 200)}` });
  }
  if (!sres.ok) {
    const flag = Object.keys(SANITY_REASONS).find((f) => sres.faults.includes(f));
    const reason = flag !== undefined ? SANITY_REASONS[flag] : "other";
    return new Review({
      verdict: "discarded:sanity", reason,
      note: `The proofreader flagged ${sres.faults.join("+")}`
            + (sres.notes ? `: ${slice(splitWs(sres.notes).join(" "), 0, 240)}` : ""),
    });
  }

  const gres = await answerability.runGate(item);
  if (gres.verdict === answerability.UNCHECKED || answerability.unanswered(gres.trials)) {
    // A trial that got no answer would look like a pass on the cold side
    // and like a failure on the full side. It is neither.
    return new Review({ verdict: null, note: "the gate could not reach its model for every trial" });
  }
  const cold = gres.trials.filter((t) => t.side === "cold");
  const full = gres.trials.filter((t) => t.side === "full");
  if (gres.verdict === "kept") {
    return new Review({
      verdict: "kept", reason: "-",
      note: `sanity=clean cold=${answerability.correctCount(cold)}/${cold.length} `
            + `full=${answerability.correctCount(full)}/${full.length}`,
    });
  }
  if (gres.verdict === "discarded:leaky") {
    // The options give the answer away. No reason in the closed set says
    // that, so it is `other`, and the sentence is the part worth reading.
    const what = answerability.leakDescription(get(item, "item_type", ""));
    return new Review({
      verdict: "discarded:leaky", reason: "other",
      note: `The gate's cold view: ${what} (${answerability.correctCount(cold)} of `
            + `${cold.length} trials)${_said(cold, { correct: true })}`,
    });
  }
  const right = answerability.correctCount(full);
  const chosen = new Set(full.filter((t) => !t.correct && t.chosen !== null).map((t) => t.chosen as number));
  const options = or(get(item, "options"), []) as Item[];
  if (!right && chosen.size === 1 && 0 <= min(chosen) && min(chosen) < options.length) {
    // Every reading with the whole stimulus settled on the same other
    // option: that is a key the judge disagrees with, not a coin toss.
    const k = [...chosen][0];
    const text = get(options[k], "text", "");
    const times = ({ 1: "in its one trial", 2: "in both trials" } as Record<number, string>)[full.length]
      ?? `in all ${full.length} trials`;
    return new Review({
      verdict: "discarded:ambiguous", reason: "wrong_answer",
      note: `The gate's full view: a reviewer with the whole stimulus chose option `
            + `${k + 1} 「${slice(str(text), 0, 60)}」 over the key ${times}`
            + `${_said(full, { correct: false })}`,
    });
  }
  return new Review({
    verdict: "discarded:ambiguous", reason: "ambiguous",
    note: `The gate's full view: a reviewer with the whole stimulus picked the key in `
          + `only ${right} of ${full.length} trials${_said(full, { correct: false })}`,
  });
}

/** The bundle's live items with no verdict yet. */
export function unregated(bundle: Item, done: Map<string, Regated>,
                          opts: { gone?: Iterable<string> | null } = {}): Item[] {
  return withdrawn.liveItems(bundle, { withdrawn: opts.gone ?? null })
    .filter((it) => !done.has(get(it, "id")));
}

/** What a regate would check, at no cost. */
export function surveyRegate(paths: string[]): Shelf[] {
  const [gone, done] = [withdrawn.ids(), loadRegated()];
  return surveyBundles(paths, gone, (bundle) => unregated(bundle, done, { gone }));
}

export class RegateRun {
  todo: number;
  /** (item id, verdict) for every question given a verdict this run. */
  checked: [string, string][];
  unchecked: number;
  stopped: string | null;

  constructor(init: { todo?: number; checked?: [string, string][]; unchecked?: number; stopped?: string | null } = {}) {
    this.todo = init.todo ?? 0;
    this.checked = init.checked ?? [];
    this.unchecked = init.unchecked ?? 0;
    this.stopped = init.stopped ?? null;
  }
}

/** Put every live question with no verdict through the proofreader and
 *  the gate, writing each verdict down the moment it is reached. */
export async function regateBank(paths: string[], opts: { log?: Log } = {}): Promise<RegateRun> {
  const log = opts.log ?? print;
  const run = new RegateRun();
  const [gone, done] = [withdrawn.ids(), loadRegated()];
  const bundles: [string, Item][] = paths.map((p) => [p, batchmod.load(p)]);
  run.todo = sum(bundles.map(([, b]) => unregated(b, done, { gone }).length));
  const today = isodateUtc(new Date());
  let strikes = 0;
  try {
    for (const [bundlePath, bundle] of bundles) {
      const todo = unregated(bundle, done, { gone });
      if (todo.length) {
        log(`${path.basename(bundlePath)}: ${todo.length} question(s) to check`);
      }
      for (const it of todo) {
        llmmod.state.spend.checkCeilings();  // before the item, as in probeBank
        const review = await regateItem(batchmod.asGeneratorShape(it));
        if (review.verdict === null) {
          run.unchecked += 1;
          strikes += 1;
          log(`  ${str(it["id"])}  unchecked: ${review.note}`);
          if (strikes >= UNREACHABLE_PATIENCE) {
            run.stopped = (`the checks could not reach their model for ${strikes} `
                           + "questions in a row");
            return run;
          }
          continue;
        }
        strikes = 0;
        recordRegated(new Regated({
          item_id: it["id"], verdict: review.verdict, date: today, reason: review.reason, note: review.note }));
        run.checked.push([it["id"], review.verdict]);
        log(`  ${str(it["id"])}  ${review.verdict}`
            + (review.reason !== "-" ? ` → ${review.reason}: ${review.note}` :
               `  ${review.note}`));
      }
    }
  } catch (e) {
    if (!(e instanceof llmmod.LLMBillingError)) throw e;
    run.stopped = errText(e);
  }
  return run;
}

/** Every live question in these bundles whose recorded verdict is a
 *  failure nobody has overruled: what `--withdraw` would add to the ledger. */
export function proposals(paths: string[]): [string, Regated][] {
  const [gone, done] = [withdrawn.ids(), loadRegated()];
  const out: [string, Regated][] = [];
  for (const p of paths) {
    for (const it of withdrawn.liveItems(batchmod.load(p), { withdrawn: gone })) {
      const entry = done.get(str(get(it, "id")));
      if (entry !== undefined && entry.failed) {
        out.push([p, entry]);
      }
    }
  }
  return out;
}

export function asWithdrawal(entry: Regated): withdrawn.Withdrawal {
  return new withdrawn.Withdrawal({ item_id: entry.item_id, reason: entry.reason, note: splitWs(entry.note).join(" ") });
}

/** Append the proposals to batches/withdrawn.txt and write the SQL of every
 *  bundle they touch, through the same path `bjt publish` takes, so the
 *  committed SQL is what the ledger says. The bundles themselves are not
 *  touched, and nothing is ever taken out of the ledger. Returns the SQL
 *  files written. */
export function withdraw(found: [string, Regated][]): string[] {
  if (!found.length) {
    return [];
  }
  const today = isodateUtc(new Date());
  withdrawn.append(
    found.map(([, entry]) => asWithdrawal(entry)),
    { heading: (`${today}: proposed by \`bjt regate\` — the proofreader and the answerability\n`
                + "gate, run over questions that had skipped both (batches/regated.txt).\n"
                + "Read each before merging: delete a line to keep its question, and mark\n"
                + "it `overruled` in regated.txt so it is not proposed again.") });
  const out: string[] = [];
  for (const p of new Set(found.map(([bundlePath]) => bundlePath))) {
    const [sql] = publish.publishBundle(p);
    out.push(sql);
  }
  return out;
}
