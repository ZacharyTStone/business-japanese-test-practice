/**
 * Passes over the bank that already shipped, for what an item never got.
 *
 * `bjt importbatch` checks the shape of a hand-written item and stops there: no
 * proofreader, no answerability gate, no difficulty probe. That is right for
 * the reference batch it was built for, but it is also how most of the bank
 * arrived, so most of what a learner meets has passed the offline checks and
 * nothing else. This module catches up on the measuring that path skipped, over
 * the committed bundles rather than over a draft; bjt/regate.ts catches up
 * on the checking.
 *
 * `probeBank` is the difficulty prior. `items.model_p_correct` is the only term
 * in `next_items()` that tells two items of one type and level apart, and it is
 * written at generation time or never, so without this pass the difficulty pitch
 * sorts nothing across every imported item. The same probe, the same weaker
 * model and the same trials as a fresh draft gets (bjt/fidelity/difficulty.ts),
 * on every live item without a rate.
 *
 * `compareBank` is the probe's model beside another one, on a sample of the
 * bank, writing nothing: the evidence for changing the instrument (Jev, a
 * prototype, bjt/jev.ts) before any rate it measured reaches a bundle.
 *
 * **Built to be stopped.** A bank is bigger than one run's ceilings
 * (`BJT_RUN_BUDGET_USD`, `_MAX_CALLS`, `_MAX_MINUTES` in bjt/llm.ts), and the
 * answer to that is more runs, never a raised ceiling. So each bundle's JSON and
 * SQL are written the moment that bundle is done — or the moment the run stops
 * inside it, for whatever reason — and the next run skips every item that
 * already has a rate. Nothing here raises, lowers or reads around a ceiling: the
 * check before every call is llm.ts's, and this adds one more before every
 * item, so a run that has spent its allowance stops cleanly between items rather
 * than failing its way through the rest of the bank.
 *
 * Only live items: a withdrawn question is never served, so what it would cost
 * to measure is money for nobody (bjt/withdrawn.ts).
 *
 * `probeBank` and `compareBank` are async: they ask the model.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import * as batchmod from "./batch.ts";
import * as config from "./config.ts";
import * as difficulty from "./fidelity/difficulty.ts";
import * as jev from "./jev.ts";
import * as llmmod from "./llm.ts";
import { errText, fixed, floorDiv, get, print, sorted, str, sum, truthy, ValueError, zip } from "./py.ts";
import * as publish from "./publish.ts";
import * as withdrawn from "./withdrawn.ts";

/** An item or a bundle: plain JSON data. */
type Item = Record<string, any>;

/** What a pass reports its progress through (`print` unless told otherwise). */
export type Log = (...args: unknown[]) => void;

/** Items in a row whose every call failed before the pass gives up. An outage
 *  or an empty account fails every item the same way — the probe records that
 *  as "unmeasured", not as an error — and asking a hundred items says nothing
 *  the third did not. */
export const UNREACHABLE_PATIENCE = 3;

/** `str(Path(p))`: a path as pathlib spells it — repeated and trailing
 *  slashes and `.` components dropped, `..` kept, an empty path `.`. */
function _pathStr(p: string): string {
  const lead = p.startsWith("//") && !p.startsWith("///") ? "//" : p.startsWith("/") ? "/" : "";
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  const out = lead + parts.join("/");
  return out === "" ? "." : out;
}

/**
 * The bundles a pass runs over: every committed one, or the ones named.
 *
 * Raises ValueError for a request that cannot mean anything: neither, both,
 * a file that does not exist, or a `.source.json` (the hand-written input to
 * `importbatch`, not a bundle — its items have no ids to write a rate to).
 */
export function selectBundles(paths: string[], every: boolean): string[] {
  if (every && paths.length) {
    throw new ValueError("name bundles or pass --all, not both");
  }
  if (every) {
    return batchmod.bundles();
  }
  if (!paths.length) {
    throw new ValueError("name a bundle (batches/*.json) or pass --all");
  }
  const out: string[] = [];
  for (const p of paths) {
    const bundlePath = _pathStr(p);
    if (path.basename(bundlePath).endsWith(".source.json")) {
      throw new ValueError(`${bundlePath} is a source file, not a bundle; name the .json beside it`);
    }
    if (!existsSync(bundlePath)) {
      throw new ValueError(`no such bundle: ${bundlePath}`);
    }
    out.push(bundlePath);
  }
  return out;
}

/** The bundle's live items that have no difficulty prior yet. */
export function unprobed(bundle: Item, opts: { gone?: Iterable<string> | null } = {}): Item[] {
  return withdrawn.liveItems(bundle, { withdrawn: opts.gone ?? null })
    .filter((it) => get(it, "model_p_correct") === null);
}

/** The bundle and its SQL, together: the SQL is what the deploy applies,
 *  and a bundle rewritten without it fails the committed-SQL test. */
export function _publish(bundle: Item, bundlePath: string): string {
  batchmod.save(bundle, { path: bundlePath });
  const [sql] = publish.publishBundle(bundlePath);
  return sql;
}

export class ProbeRun {
  /** Items that needed a rate when the run started, across the bundles asked. */
  todo: number;
  measured: number;
  unmeasured: number;
  /** (bundle path, items measured in it) for every bundle rewritten. */
  written: [string, number][];
  /** Why the run ended before the work did, when it did. */
  stopped: string | null;

  constructor(init: {
    todo?: number;
    measured?: number;
    unmeasured?: number;
    written?: [string, number][];
    stopped?: string | null;
  } = {}) {
    this.todo = init.todo ?? 0;
    this.measured = init.measured ?? 0;
    this.unmeasured = init.unmeasured ?? 0;
    this.written = init.written ?? [];
    this.stopped = init.stopped ?? null;
  }

  get remaining(): number {
    return this.todo - this.measured;
  }

  /** The run, as something that can be pasted into a pull request. */
  summary(opts: { spend?: llmmod.Spend | null } = {}): string {
    const spend = opts.spend ?? null;
    let lines = [`Measured the difficulty of ${this.measured} item(s) in `
                 + `${this.written.length} bundle(s); ${this.remaining} live item(s) `
                 + "still have none.", ""];
    lines = lines.concat(this.written.map(([p, n]) => `- \`${path.basename(p)}\`: ${n} measured`));
    if (this.unmeasured) {
      lines.push("", `${this.unmeasured} probe(s) could not run and wrote nothing: `
                     + "an item with no rate is better than one with an invented rate.");
    }
    if (truthy(this.stopped)) {
      lines.push("", `Stopped before the end: ${this.stopped}. The next run `
                     + "starts where this one stopped.");
    }
    if (spend !== null) {
      lines.push("", "### What it cost", "", spend.report());
    }
    lines.push("", "The SQL sets `model_p_correct` on questions already in the bank. "
                   + "Nothing reaches the database until this is merged.");
    return lines.join("\n");
  }
}

/** One bundle as a pass sees it before spending anything. */
export class Shelf {
  path: string;
  n_items: number;
  n_withdrawn: number;
  todo: Item[];

  constructor(init: { path: string; n_items: number; n_withdrawn: number; todo: Item[] }) {
    this.path = init.path;
    this.n_items = init.n_items;
    this.n_withdrawn = init.n_withdrawn;
    this.todo = init.todo;
  }
}

/** What a probe would do, at no cost: each bundle's live items without a rate. */
export function surveyProbe(paths: string[]): Shelf[] {
  const gone = withdrawn.ids();
  const out: Shelf[] = [];
  for (const p of paths) {
    const bundle = batchmod.load(p);
    const items = get(bundle, "items", []) as Item[];
    out.push(new Shelf({
      path: p, n_items: items.length, n_withdrawn: items.filter((it) => gone.has(get(it, "id"))).length,
      todo: unprobed(bundle, { gone }),
    }));
  }
  return out;
}

/** `f"{x:g}"`: six significant digits, trailing zeros dropped, the exponent
 *  form outside 1e-4 … 1e6. */
function _g(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const [mant, e] = x.toExponential(5).split("e");
  const exp = Number(e);
  const dropZeros = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
  if (exp >= -4 && exp < 6) return dropZeros(fixed(x, 5 - exp));
  return `${dropZeros(mant)}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
}

/** How many runs the ceilings make `calls` — at least, because the dollar
 *  and minute ceilings may bind before the call ceiling does. */
export function runsEstimate(calls: number): string {
  const runs = config.RUN_MAX_CALLS > 0 ? Math.max(1, -floorDiv(-calls, config.RUN_MAX_CALLS)) : 1;
  return (`A run stops at ${str(config.RUN_MAX_CALLS)} calls, $${fixed(config.RUN_BUDGET_USD, 2)} or `
          + `${_g(config.RUN_MAX_MINUTES)} minutes (BJT_RUN_*), whichever comes first, and\n`
          + `the next run resumes where it stopped: at least ${runs} run(s) for all of it.`);
}

/**
 * Measure every live item without a rate, bundle by bundle.
 *
 * Each bundle is written (JSON and SQL) as soon as it is done, and also when
 * the run stops inside it — the spend ceiling, an outage, Ctrl-C — so what
 * was paid for is never lost; the next run skips what already has a rate.
 */
export async function probeBank(paths: string[], opts: { log?: Log } = {}): Promise<ProbeRun> {
  const log = opts.log ?? print;
  const run = new ProbeRun();
  const gone = withdrawn.ids();
  const bundles: [string, Item][] = paths.map((p) => [p, batchmod.load(p)]);
  run.todo = sum(bundles.map(([, b]) => unprobed(b, { gone }).length));
  let strikes = 0;

  for (const [bundlePath, bundle] of bundles) {
    const todo = unprobed(bundle, { gone });
    if (!todo.length) {
      continue;
    }
    log(`${path.basename(bundlePath)}: ${todo.length} item(s) to measure`);
    let here = 0;
    try {
      for (const it of todo) {
        // Before the item, not only before each call: a run with no
        // allowance left stops here, between items, instead of sending
        // every remaining item to a probe that can only refuse it.
        llmmod.state.spend.checkCeilings();
        const result = await difficulty.measure(batchmod.asGeneratorShape(it));
        log(`  ${str(it["id"])}  ${result.detail()}`);
        if (result.measured && result.rate !== null) {
          it["model_p_correct"] = result.rate;
          here += 1;
          strikes = 0;
          continue;
        }
        run.unmeasured += 1;
        // Every trial unanswered is a model that cannot be reached, not
        // an item that is hard to measure; one answer says it can be.
        if (result.trials.length && result.trials.every((t) => t.chosen === null)) {
          strikes += 1;
        } else {
          strikes = 0;
        }
        if (strikes >= UNREACHABLE_PATIENCE) {
          run.stopped = (`the model could not be reached for ${strikes} `
                         + "items in a row");
          break;
        }
      }
    } catch (e) {
      // The run's ceiling, or an account that cannot pay. Everything after
      // this would be refused the same way.
      if (!(e instanceof llmmod.LLMBillingError)) throw e;
      run.stopped = errText(e);
    } finally {
      if (here) {
        const sql = _publish(bundle, bundlePath);
        run.measured += here;
        run.written.push([bundlePath, here]);
        log(`  wrote ${path.basename(bundlePath)} and ${path.basename(sql)} (${here} measured)`);
      }
    }
    if (truthy(run.stopped)) {
      break;
    }
  }
  return run;
}

// ----- the comparison -------------------------------------------------------

/** How many items `bjt probe --compare` measures unless told otherwise: enough
 *  to see whether two instruments order the bank alike, few enough to be cents. */
export const COMPARE_LIMIT = 20;

/** Up to `limit` live items, one type at a time in turn, so that a small
 *  sample still sits every type rather than the first bundle's. */
export function sample(paths: string[], limit: number): Item[] {
  const gone = withdrawn.ids();
  const byType = new Map<string, Item[]>();
  for (const p of paths) {
    for (const it of withdrawn.liveItems(batchmod.load(p), { withdrawn: gone })) {
      const t = it["item_type"];
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(it);
    }
  }
  const out: Item[] = [];
  while (out.length < limit && [...byType.values()].some((xs) => xs.length > 0)) {
    for (const t of sorted(byType.keys())) {
      const shelf = byType.get(t)!;
      if (shelf.length && out.length < limit) {
        out.push(shelf.shift()!);
      }
    }
  }
  return out;
}

/** Ranks from 0, ties sharing the mean of the ranks they span. */
export function _ranks(xs: number[]): number[] {
  const order = sorted(xs.map((_, i) => i), { key: (i) => xs[i] });
  const ranks: number[] = xs.map(() => 0.0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) {
      j += 1;
    }
    for (let k = i; k <= j; k++) {
      ranks[order[k]] = (i + j) / 2;
    }
    i = j + 1;
  }
  return ranks;
}

/** Rank correlation of two measurements of the same items. null when it
 *  means nothing: fewer than three items, or one side giving every item the
 *  same number, which has no order to agree with. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) {
    return null;
  }
  const [ra, rb] = [_ranks(a), _ranks(b)];
  const [ma, mb] = [sum(ra) / ra.length, sum(rb) / rb.length];
  const cov = sum(zip(ra, rb, { strict: true }).map(([x, y]) => (x - ma) * (y - mb)));
  const va = sum(ra.map((x) => (x - ma) ** 2));
  const vb = sum(rb.map((y) => (y - mb) ** 2));
  if (va === 0 || vb === 0) {
    return null;
  }
  return cov / (va * vb) ** 0.5;
}

export function _unreachable(result: difficulty.DifficultyResult): boolean {
  return result.trials.length > 0 && result.trials.every((t) => t.chosen === null);
}

/** (item id, item type, baseline's result, candidate's result), as measured. */
export type ComparisonRow = [string, string, difficulty.DifficultyResult, difficulty.DifficultyResult];

/** `f"{x:+.2f}"`: fixed notation with the sign always written. */
function _signed(x: number): string {
  const s = fixed(x, 2);
  return s.startsWith("-") ? s : "+" + s;
}

export class Comparison {
  baseline: string;
  candidate: string;
  /** (item id, item type, baseline's result, candidate's result), as measured. */
  rows: ComparisonRow[];
  stopped: string | null;

  constructor(init: { baseline: string; candidate: string; rows?: ComparisonRow[]; stopped?: string | null }) {
    this.baseline = init.baseline;
    this.candidate = init.candidate;
    this.rows = init.rows ?? [];
    this.stopped = init.stopped ?? null;
  }

  /** Both instruments on the same items, as something to paste into a PR. */
  summary(opts: { spend?: llmmod.Spend | null } = {}): string {
    const spend = opts.spend ?? null;
    const cell = (r: difficulty.DifficultyResult) =>
      r.measured && r.rate !== null ? fixed(r.rate, 2) : "—";

    const lines = [`\`${this.baseline}\` (the probe today) beside \`${this.candidate}\`, `
                   + `on ${this.rows.length} live item(s).`, "",
                   `| item | type | ${this.baseline} | ${this.candidate} |`,
                   "|---|---|---|---|"];
    lines.push(...this.rows.map(([iid, t, b, c]) => `| \`${iid}\` | ${t} | ${cell(b)} | ${cell(c)} |`));
    lines.push("");
    for (const [name, col] of [[this.baseline, 2], [this.candidate, 3]] as [string, 2 | 3][]) {
      const rates = this.rows.filter((r) => r[col].measured).map((r) => r[col].rate as number);
      if (rates.length) {
        lines.push(`- \`${name}\`: measured ${rates.length} of ${this.rows.length}, mean `
                   + `${fixed(sum(rates) / rates.length, 2)}, ${new Set(rates).size} distinct value(s)`);
      } else {
        lines.push(`- \`${name}\`: measured none of ${this.rows.length}`);
      }
    }
    if (jev.isJev(this.candidate)) {
      const picked = this.rows.filter((r) => r[3].measured).map((r) => r[3]);
      if (picked.length) {
        const hits = picked.filter((r) => r.trials.length && r.trials[0].correct).length;
        lines.push(`- \`${this.candidate}\` put the most weight on the key in ${hits} of `
                   + `${picked.length} (chance is about one in four)`);
      }
    }
    const pairs = this.rows.filter(([, , b, c]) => b.measured && c.measured)
      .map(([, , b, c]) => [b.rate as number, c.rate as number]);
    const rho = spearman(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
    lines.push(`- rank agreement (Spearman) over the ${pairs.length} item(s) both measured: `
               + (rho !== null ? _signed(rho) : "not meaningful"));
    if (truthy(this.stopped)) {
      lines.push("", `Stopped before the end: ${this.stopped}.`);
    }
    if (spend !== null) {
      lines.push("", "### What it cost", "", spend.report());
    }
    lines.push("", "Nothing was written: no bundle, no SQL. Neither column is how learners "
                   + "do — it is two models' view of the same questions — so this says whether "
                   + "the candidate reads the Japanese at all and whether it orders the bank "
                   + "the way the probe does, not which of them is right.");
    return lines.join("\n");
  }
}

/**
 * Measure a sample of live items with the probe's model and with
 * `candidate`, keeping both numbers and writing nothing anywhere.
 *
 * The candidate goes first on each item, so a candidate that cannot be
 * reached (no key, say) costs no baseline calls for that item. The ceilings
 * are the ones every run has, checked before each item as in `probeBank`.
 */
export async function compareBank(paths: string[], candidate: string,
                                  opts: { limit?: number; log?: Log } = {}): Promise<Comparison> {
  const limit = opts.limit ?? COMPARE_LIMIT;
  const log = opts.log ?? print;
  const cmp = new Comparison({ baseline: config.DIFFICULTY_MODEL, candidate: candidate });
  let strikes = 0;
  try {
    for (const it of sample(paths, limit)) {
      llmmod.state.spend.checkCeilings();
      const item = batchmod.asGeneratorShape(it);
      const cand = await difficulty.measure(item, { model: candidate });
      let base: difficulty.DifficultyResult;
      if (_unreachable(cand)) {
        base = new difficulty.DifficultyResult({
          model: cmp.baseline, notes: "not run: the candidate could not be reached" });
      } else {
        base = await difficulty.measure(item, { model: cmp.baseline });
      }
      cmp.rows.push([it["id"], it["item_type"], base, cand]);
      log(`  ${str(it["id"])}  ${base.detail()}  ${cand.detail()}`);
      strikes = (_unreachable(cand) || _unreachable(base)) ? strikes + 1 : 0;
      if (strikes >= UNREACHABLE_PATIENCE) {
        cmp.stopped = `a model could not be reached for ${strikes} items in a row`;
        break;
      }
    }
  } catch (e) {
    if (!(e instanceof llmmod.LLMBillingError)) throw e;
    cmp.stopped = errText(e);
  }
  return cmp;
}
