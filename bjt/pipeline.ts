/**
 * The generation pipeline: one draft through every check, and a shelf of drafts.
 *
 * `generateAndGate` is one item's whole life before it ships — written, read by
 * the offline vocab check and the proofreader, sat by the answerability gate,
 * measured by the difficulty probe, and stored with every number it earned on the
 * way. `runBatch` is a shelf of them: the patience, the reason one draft's
 * rejection hands the next, the dedupe, and the whole-batch checks the bundle
 * must pass before it is written. `runNight` is a work order of shelves, and
 * where the run's ceiling ends one: after it has bundled what it kept.
 *
 * They live here rather than in `bjt/cli/` so the tests can reach the pipeline
 * without the command-line module, and the commands that drive them (`bjt gen`,
 * `batch`, `nightly`, `smoke`, `practice`) stay thin.
 *
 * `generateAndGate`, `runBatch` and `runNight` are async: they ask the models.
 */
import * as batchmod from "./batch.ts";
import * as config from "./config.ts";
import type { Store } from "./db/index.ts";
import * as answerability from "./fidelity/answerability.ts";
import * as dedupe from "./fidelity/dedupe.ts";
import * as difficulty from "./fidelity/difficulty.ts";
import * as sanity from "./fidelity/sanity.ts";
import * as vocab from "./fidelity/vocab.ts";
import { getGenerator } from "./generators/index.ts";
import * as llmmod from "./llm.ts";
import { LLMBillingError, LLMError } from "./llm.ts";
import type { WorkItem } from "./plan.ts";
import * as publish from "./publish.ts";
import {
  eprint, errText, FileNotFoundError, fixed, get, has, KeyError, percent, print, repr, slice, str,
} from "./py.ts";
import * as seedtable from "./seedtable.ts";
import * as shelf_rest from "./shelf_rest.ts";

/** An item or a bundle: plain JSON data. */
type Item = Record<string, any>;

/**
 * The run's ceiling (or an empty account) ended a shelf part-way.
 *
 * Raised by `runBatch` only after it has done with what the shelf already
 * kept exactly what a finished shelf does — built, checked and, if the
 * checks pass, saved the bundle — so an item paid for is never thrown away
 * because the one after it could not be. A billing error, so every caller
 * that stops for one stops for this; `path` and `kept` say what was saved.
 */
export class ShelfStopped extends LLMBillingError {
  path: string | null;
  kept: number;

  constructor(cause: LLMBillingError, path: string | null, kept: number) {
    super(errText(cause), { cause });
    this.path = path;
    this.kept = kept;
  }
}

// ----- one item ----------------------------------------------------------

/**
 * Generate one item, run every per-item check, persist with metrics.
 * Returns [item, itemId, kept: boolean, detail: string, reason: string | null] —
 * `reason` is what review said, in a sentence the next draft for the same
 * shelf is told (`feedback`), and null for an item that was kept.
 *
 * The order is cheapest-first, and that is the point. The offline vocab check
 * costs nothing. The proofreader is one small call. The answerability gate is
 * six large ones, and it only runs on an item the first two did not already
 * condemn — so a generation that came out broken costs one small call instead
 * of six large ones, and the gate's budget is spent on items that might survive it.
 * The difficulty probe comes last, a few small calls, and only for an item that
 * is going to ship: measuring the difficulty of a discarded item buys nothing.
 */
export async function generateAndGate(
  store: Store,
  itemType: string,
  level: string,
  opts: {
    gate: boolean;
    sanityCheck?: boolean;
    cell?: seedtable.Cell | null;
    feedback?: string | null;
  },
): Promise<[Item, number, boolean, string, string | null]> {
  const gate = opts.gate;
  const sanityCheck = opts.sanityCheck ?? true;
  let cell = opts.cell ?? null;
  const feedback = opts.feedback ?? null;

  const gen = getGenerator(itemType, { store });
  if (cell === null && gen.requires_cell) {
    cell = _nextCell(store, itemType, level);
  }
  const item = await gen.generate({ level, cell, feedback });

  const vres = vocab.checkItem(item, level);
  const sres = sanityCheck ? await sanity.runCheck(item) : new sanity.SanityResult({ checked: false });
  let gateVerdict = "skipped";
  let cold: number | null = null;
  let full: number | null = null;
  let gres: answerability.GateResult | null = null;
  if (!sres.ok) {
    // No gate for an item with a fault a proofreader can see. Six calls to a
    // strong model cannot repair an explanation that names the wrong option,
    // and this is the whole saving.
    gateVerdict = "discarded:sanity";
  } else if (gate) {
    gres = await answerability.runGate(item);
    [cold, full, gateVerdict] = [gres.cold_success_rate, gres.full_success_rate, gres.verdict];
    if (gres.trials.some((t) => t.chosen === null)) {
      // Whatever the verdict says: a gate with a trial its judge did not
      // answer has not checked the item, and an unchecked item never ships.
      cold = full = null;
      gateVerdict = answerability.UNCHECKED;
    }
  }
  // A vocab violation (when enforced) is an independent discard reason — it can
  // fail an item the answerability gate passed or skipped.
  if (vres.enforced && !vres.ok && !gateVerdict.startsWith("discarded")) {
    gateVerdict = "discarded:vocab";
  }
  // Only these two ship. An unchecked gate (its judge did not answer every
  // trial) is neither: nothing was found wrong, and nothing was shown right.
  const kept = gateVerdict === "kept" || gateVerdict === "skipped";

  // The difficulty probe: a weaker model sits the full view a few times, and
  // its pass rate is the difficulty prior. Only for an item that is going to
  // ship — a discarded item's difficulty is nobody's business — and skipped
  // entirely when switched off, which the result says rather than hides.
  let dres: difficulty.DifficultyResult;
  if (kept) {
    try {
      dres = await difficulty.measure(item);
    } catch (e) {
      if (!(e instanceof LLMBillingError)) throw e;
      // The gate has already passed this item and been paid for; the
      // ceiling reached while measuring it leaves it unmeasured (the
      // gate's rate stands in) rather than thrown away. The stop is not
      // lost: the ceiling is still reached, so the next call raises it.
      dres = new difficulty.DifficultyResult({ measured: false,
                                               notes: `not probed: ${errText(e)}` });
    }
  } else {
    dres = new difficulty.DifficultyResult({ measured: false, notes: "not probed: item discarded" });
  }

  const itemId = store.insertItem(
    itemType, level, item, config.GEN_MODEL,
    { coldSuccessRate: cold, fullSuccessRate: full,
      gateVerdict: gateVerdict, vocabViolations: vres.violations },
  );
  if (gate && gateVerdict !== "discarded:sanity") {
    for (const t of gres!.trials) {
      store.recordGateTrial(itemId, t.side, t.trial, t.chosen, t.correct);
    }
  }
  if (dres.measured) {
    // Only a measurement is worth keeping: the trials of a probe that could
    // not reach its model would read, later, as an item nobody could answer.
    for (const t of dres.trials) {
      store.recordGateTrial(itemId, t.side, t.trial, t.chosen, t.correct);
    }
  }

  // The difficulty prior travels with the item from here: the bundle carries
  // it, `bjt publish` writes it, and the practice queue uses it as the prior
  // for an item nobody has answered yet. It is the probe's rate when the probe
  // ran, and the gate's full-view rate otherwise — a coarser number, but still
  // an honest one. It is a property of the question and is never shown to
  // anybody (items.model_p_correct in d1/migrations/0001_initial.sql).
  if (dres.measured) {
    item["model_p_correct"] = dres.rate;
  } else if (full !== null) {
    item["model_p_correct"] = full;
  }

  const detail = _gateDetail(cold, full, gateVerdict, vres, { sres, dres });
  const gresForReason = gate && gateVerdict !== "discarded:sanity" ? gres : null;
  return [item, itemId, kept, detail, rejectionReason(
    itemType, gateVerdict, sres, vres, { gres: gresForReason })];
}

/**
 * Why review rejected this draft, as one sentence for the next one.
 *
 * null for a draft that was kept, and for one the gate could not check: an
 * outage says nothing about the writing, and telling the next draft it
 * failed would send it off to fix a fault nobody found.
 */
export function rejectionReason(
  itemType: string,
  verdict: string,
  sres: sanity.SanityResult | null,
  vres: vocab.VocabResult,
  opts: { gres?: answerability.GateResult | null } = {},
): string | null {
  const gres = opts.gres ?? null;
  if (verdict === "discarded:leaky") {
    return answerability.leakDescription(itemType, { result: gres });
  }
  if (verdict === "discarded:ambiguous") {
    return ("a reviewer with the whole stimulus could not pick the marked answer "
            + "consistently — another option was just as defensible, or the stimulus "
            + "did not settle it");
  }
  if (verdict === "discarded:sanity") {
    const faults = sres !== null ? sres.faults.join("+") : "a proofreading fault";
    const note = (sres !== null && sres.notes ? slice(sres.notes, 0, 200) : "");
    return `the proofreader flagged ${faults}` + (note ? `: ${note}` : "");
  }
  if (verdict === "discarded:vocab") {
    return ("it used kanji above the level's band: "
            + vres.violations.slice(0, 8).join(" "));
  }
  return null;
}

export function _gateDetail(
  cold: number | null,
  full: number | null,
  verdict: string,
  vres: vocab.VocabResult,
  opts: { sres?: sanity.SanityResult | null; dres?: difficulty.DifficultyResult | null } = {},
): string {
  const sres = opts.sres ?? null;
  const dres = opts.dres ?? null;
  const bits: string[] = [];
  if (sres !== null && (!sres.ok || !sres.checked)) {
    bits.push(sres.detail());
  }
  if (cold !== null) {
    // No full rate for a leaky item: the gate stops at the cold side.
    bits.push(`cold=${percent(cold)} full=` + (full === null ? "n/a" : percent(full)));
  }
  if (dres !== null && (dres.measured || dres.trials.length > 0)) {
    // Say which model measured it: a rate from the gate's strong model and a
    // rate from the probe's weak one are not comparable numbers.
    bits.push(dres.detail());
  }
  bits.push(`verdict=${verdict}`);
  if (vres.enforced && vres.violations.length > 0) {
    bits.push(`above-band kanji: ${vres.violations.join(" ")}`);
  }
  // A fault's note, or the reason no check ran. A night of "sanity=skipped"
  // with the reason kept to itself cannot be diagnosed from the log.
  if (sres !== null && (!sres.ok || !sres.checked) && sres.notes) {
    bits.push(`(${slice(sres.notes, 0, 200)})`);
  }
  return bits.join("  ");
}

// ----- seed cells ----------------------------------------------------------

/**
 * Every seed cell this item type has already used.
 *
 * Two ledgers, unioned. The committed bundles in `batches/` are the
 * authoritative one — they are what ships, and they survive a fresh clone. The
 * local SQLite database is consulted as well because it holds cells spent on
 * items generated but not yet bundled, which exist only on this machine.
 *
 * The database alone is not enough: it is gitignored, so on a new checkout
 * every cell would look free and the next batch would re-spend cells the
 * library has already used.
 */
function _spentCellsImpl(store: Store, itemType: string): Set<string> {
  return new Set([...store.usedCellIds(itemType), ...batchmod.spentCellIds(itemType)]);
}

/** `_spentCells` itself; every caller here goes through `seams.spentCells`. */
export function _spentCells(store: Store, itemType: string): Set<string> {
  return seams.spentCells(store, itemType);
}

/** One unused seed-table cell. Raises if the table for this type is exhausted
 *  — better a clear stop than silently writing the same cell twice. */
export function _nextCell(store: Store, itemType: string, level: string): seedtable.Cell {
  const table = seedtable.load(itemType);
  const picked = table.sample(1, { level, excludeIds: seams.spentCells(store, itemType) });
  if (picked.length === 0) {
    throw new LLMError(
      `every ${itemType} seed cell at ${level} has been used; extend `
      + `seedtable/${itemType}.json before generating more`,
    );
  }
  return picked[0];
}

/** Cells a shelf draws beyond the items it is asked for. A near-duplicate
 *  spends its cell without keeping an item, and the shelf then needs another;
 *  drawn up front they are spread across the axes with the rest. */
export const CELL_SURPLUS = 2;

/** N unused cells for a run, spread across the axes, and up to `surplus`
 *  more when the table has them. Empty list for types that do not use a seed
 *  table. */
export function sampleCells(
  store: Store,
  itemType: string,
  level: string,
  n: number,
  opts: { surplus?: number } = {},
): seedtable.Cell[] {
  const surplus = opts.surplus ?? 0;
  if (!getGenerator(itemType).requires_cell) {
    return [];
  }
  const table = seedtable.load(itemType);
  const cells = table.sample(n + Math.max(surplus, 0), {
    level, excludeIds: seams.spentCells(store, itemType),
  });
  if (cells.length < n) {
    throw new LLMError(
      `only ${cells.length} unused ${itemType} cell(s) left at ${level}; extend `
      + `seedtable/${itemType}.json`,
    );
  }
  return cells;
}

// ----- a shelf -------------------------------------------------------------

type RunBatchOpts = { gate?: boolean; sanityCheck?: boolean; force?: boolean; out?: string | null };

/** [bundle path, items kept, why the shelf's last draft was turned down].
 *  The third is null when the last draft was kept, or nothing said why. */
export type ShelfResult = [string | null, number, (string | null)?];

/**
 * Generate, gate and bundle one batch. Returns a `ShelfResult`.
 *
 * A function of its own so the nightly run can write several batches in one
 * process against one open store — reopening it per shelf would re-read the
 * spent-cell ledger each time and, worse, would let two shelves in the same run
 * spend the same cell.
 *
 * A billing error (the run's ceiling, an empty account) ends the shelf, not
 * the items it kept: those are bundled as usual, and then `ShelfStopped` is
 * thrown so the caller ends the run too.
 */
async function _runBatchImpl(
  store: Store,
  itemType: string,
  level: string,
  n: number,
  opts: RunBatchOpts = {},
): Promise<ShelfResult> {
  const gate = opts.gate ?? true;
  const sanityCheck = opts.sanityCheck ?? true;
  const force = opts.force ?? false;
  const out = opts.out ?? null;
  const keptItems: Item[] = [];
  const cells = sampleCells(store, itemType, level, n, { surplus: CELL_SURPLUS });
  // Cells this shelf has finished with: kept, or spent on a near-duplicate.
  // A cell is never handed out again once it is in here — a second item on
  // one cell fails "seed cells distinct" and takes the whole shelf with it.
  const doneCells = new Set<string>();
  let attempts = 0;
  const budget = n * 3;
  // Discards in a row. A shelf whose first three drafts all fail the gate is
  // a shelf the generator cannot write tonight, and every further draft is
  // the same money for the same answer. Reset by a keep.
  let strikes = 0;
  let idx = 0;
  // What review said about the last draft for this shelf, told to the next
  // one: a draft written blind fails the same way as the one before it.
  //
  // And told about the SAME cell: a draft the gate refused is usually a fine
  // situation with options that gave it away, so the next draft is that
  // situation again with the reviewer's reason in hand. Moving to a new cell
  // on every discard would throw the reason at a different situation. Only a
  // keep or a near-duplicate (the situation itself collides) moves the shelf
  // on to its next cell.
  let feedback: string | null = null;
  let stop: LLMBillingError | null = null;
  while (keptItems.length < n && attempts < budget) {
    if (strikes >= config.SLOT_PATIENCE) {
      print(`  [${keptItems.length}/${n}] giving up on this shelf: `
            + `${strikes} discards in a row`);
      break;
    }
    let cell: seedtable.Cell | null = null;
    if (cells.length > 0) {
      cell = _cellAt(store, itemType, level, cells, idx, doneCells);
      if (cell === null) {
        print(`  [${keptItems.length}/${n}] no unused ${itemType} cell left at `
              + `${level}; the shelf ends here`);
        break;
      }
    }
    attempts += 1;
    let item: Item;
    let kept: boolean;
    let detail: string;
    let reason: string | null;
    try {
      [item, , kept, detail, reason] = await generateAndGate(
        store, itemType, level, { gate, sanityCheck, cell, feedback },
      );
    } catch (e) {
      if (e instanceof LLMBillingError) {
        // Nothing after this can succeed. What was kept is still bundled
        // below, and then the caller is told to end the run.
        print(`  [${keptItems.length}/${n}] stopping: ${errText(e)}`);
        stop = e;
        break;
      }
      if (e instanceof LLMError) {
        print(`  [${keptItems.length}/${n}] generation failed: ${errText(e)}`);
        strikes += 1;
        feedback = `it did not validate (${slice(errText(e), 0, 200)})`;
        continue;
      }
      throw e;
    }
    if (!kept) {
      print(`  [${keptItems.length}/${n}] dropped — ${detail}`);
      if (reason !== null) {
        // What the next draft is told. "verdict=discarded:leaky" alone
        // says that the options gave the answer away, not how.
        print(`        why: ${reason}`);
      }
      strikes += 1;
      feedback = reason;
      continue;
    }
    const close = dedupe.maxSimilarity(item, keptItems);
    if (close >= dedupe.DEFAULT_THRESHOLD) {
      print(`  [${keptItems.length}/${n}] dropped — near-duplicate `
            + `of an item already in this batch (${fixed(close, 2)})`);
      strikes += 1;
      if (cell !== null) {
        doneCells.add(cell.id);
      }
      idx += 1;
      feedback = ("it was a near-duplicate of another item in this batch "
                  + `(${repr(get(item, "topic", ""))}); write a clearly different situation`);
      continue;
    }
    strikes = 0;
    if (cell !== null) {
      doneCells.add(cell.id);
    }
    idx += 1;
    feedback = null;
    keptItems.push(item);
    print(`  [${keptItems.length}/${n}] kept  ${repr(get(item, "topic", ""))}  ${detail}`);
  }

  const [path, keptN] = _bundleShelf(itemType, level, keptItems, { force, out });
  if (stop !== null) {
    throw new ShelfStopped(stop, path, keptN);
  }
  return [path, keptN, feedback];
}

/** `runBatch` itself; `runNight` calls it through `seams.runBatch`, which is
 *  what a test replaces (`patch(pipeline.seams, "runBatch", ...)`). */
export async function runBatch(
  store: Store,
  itemType: string,
  level: string,
  n: number,
  opts: RunBatchOpts = {},
): Promise<ShelfResult> {
  return seams.runBatch(store, itemType, level, n, opts);
}

/** The shelf's `idx`-th cell: from the cells it drew, and past their end a
 *  fresh one from the table. Never a cell in `done`. null when the table has
 *  nothing left at this level. */
export function _cellAt(
  store: Store,
  itemType: string,
  level: string,
  cells: seedtable.Cell[],
  idx: number,
  done: Set<string>,
): seedtable.Cell | null {
  while (idx >= cells.length) {
    const picked = seedtable.load(itemType).sample(1, {
      level,
      excludeIds: new Set([...seams.spentCells(store, itemType), ...done,
                           ...cells.map((c) => c.id)]),
    });
    if (picked.length === 0) {
      return null;
    }
    cells.push(picked[0]);
  }
  const cell = cells[idx];
  return done.has(cell.id) ? null : cell;
}

/** The whole-batch checks over what a shelf kept, and the bundle if they pass. */
export function _bundleShelf(
  itemType: string,
  level: string,
  keptItems: Item[],
  opts: { force: boolean; out: string | null },
): [string | null, number] {
  if (keptItems.length === 0) {
    eprint("\nNothing passed the gates; no bundle written.");
    return [null, 0];
  }

  const bundle = batchmod.buildBundle(itemType, level, keptItems, config.GEN_MODEL);
  const report = batchmod.checkBundle(bundle);
  printBundleReport(bundle, report);
  if (!report.ok && !opts.force) {
    eprint("\nBundle NOT written — fix the failures above or pass --force.");
    return [null, 0];
  }
  const path = batchmod.save(bundle, { path: opts.out });
  print(`\nWrote ${keptItems.length} item(s) to ${path}`);
  return [path, keptItems.length];
}

/** What the tests replace: `runBatch` and `_spentCells`, and every call this
 *  module makes to them (`runNight`, `_nextCell`, `sampleCells`, `_cellAt`),
 *  go through these (`patch(pipeline.seams, "runBatch", ...)`). */
export const seams = {
  runBatch: _runBatchImpl,
  spentCells: _spentCellsImpl,
};

// ----- a night ---------------------------------------------------------------

export class NightResult {
  /** (item type, level, items kept, bundle path) for every shelf written. */
  written: [string, string, number, string][];
  /** One line per shelf that wrote nothing, or that the run ended inside. */
  failures: string[];
  /** Why the run ended before its work order did, when it did. */
  stopped: string | null;
  /** (item type, level, outcome) for every shelf the night finished with:
   *  `written` if it kept anything, `missed` if it tried and kept nothing.
   *  A shelf a ceiling or the account stopped is not here — that was not
   *  the shelf (bjt/shelf_rest.ts). */
  outcomes: [string, string, string][];

  constructor(init: {
    written?: [string, string, number, string][];
    failures?: string[];
    stopped?: string | null;
    outcomes?: [string, string, string][];
  } = {}) {
    this.written = init.written ?? [];
    this.failures = init.failures ?? [];
    this.stopped = init.stopped ?? null;
    this.outcomes = init.outcomes ?? [];
  }
}

/** Python's FileNotFoundError: ours (`seedtable.load`), or the operating
 *  system's (a file that is not there carries ENOENT). */
function _fileNotFound(e: unknown): boolean {
  return e instanceof FileNotFoundError
    || (e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT");
}

/**
 * Every line of a work order (`plan.workOrder`), one shelf after another,
 * in one process against one store, each written bundle published to SQL.
 *
 * One shelf failing is not the night failing: a shelf the generator cannot
 * write, or whose cells ran out, is noted and the next one runs. A billing
 * error — the run's ceiling, an account that cannot pay — ends the night,
 * because every shelf after it would fail the same way; the shelf it
 * happened in keeps what it had already kept (`ShelfStopped`).
 */
export async function runNight(
  store: Store,
  order: Iterable<WorkItem>,
  opts: { gate?: boolean; sanityCheck?: boolean } = {},
): Promise<NightResult> {
  const gate = opts.gate ?? true;
  const sanityCheck = opts.sanityCheck ?? true;
  const night = new NightResult();
  for (const w of order) {
    print(`\n--- ${w.n} × ${w.item_type} ${w.level} ` + "-".repeat(32));
    const before = llmmod.state.spend.usd;
    let path: string | null;
    let kept: number;
    let why: string | null = null;
    try {
      [path, kept, why = null] = await seams.runBatch(
        store, w.item_type, w.level, w.n, { gate, sanityCheck, force: false },
      );
    } catch (e) {
      if (e instanceof ShelfStopped) {
        eprint(`  stopping the run: ${errText(e)}`);
        [path, kept] = [e.path, e.kept];
        night.stopped = errText(e);
        if (path !== null) {
          night.outcomes.push([w.item_type, w.level, shelf_rest.WRITTEN]);
        }
        night.failures.push(
          `${w.item_type} ${w.level} (stopped at ${kept} of ${w.n}) and everything after it: ${errText(e)}`);
      } else if (e instanceof LLMBillingError) {
        eprint(`  stopping the run: ${errText(e)}`);
        night.stopped = errText(e);
        night.failures.push(`${w.item_type} ${w.level} and everything after it: ${errText(e)}`);
        break;
      } else if (e instanceof LLMError || _fileNotFound(e)) {
        // One shelf failing is not the run failing. A key that ran out of
        // quota halfway through should still leave the batches it already
        // wrote, checked and reviewable.
        eprint(`  skipped: ${errText(e)}`);
        night.failures.push(`${w.item_type} ${w.level}: ${errText(e)}`);
        // A generator the API refuses is the shelf's fault; missing seed
        // files are the runner's, and say nothing about the shelf.
        if (e instanceof LLMError) {
          night.outcomes.push([w.item_type, w.level, shelf_rest.MISSED]);
        }
        continue;
      } else {
        throw e;
      }
    } finally {
      // The bill so far, after every shelf, so the log says where the
      // money went while it is going.
      print(`  this shelf $${fixed(llmmod.state.spend.usd - before, 2)}; `
            + `run so far $${fixed(llmmod.state.spend.usd, 2)} of `
            + `$${fixed(config.RUN_BUDGET_USD, 2)} in ${llmmod.state.spend.calls} call(s)`);
    }
    if (path === null) {
      if (night.stopped === null) {
        // With the last draft's reason, so the night's pull request says
        // how a shelf failed and not only that it did.
        night.failures.push(`${w.item_type} ${w.level}: nothing passed the gates`
                            + (why ? ` — the last draft: ${slice(why, 0, 600)}` : ""));
        night.outcomes.push([w.item_type, w.level, shelf_rest.MISSED]);
      }
    } else {
      const [sql] = publish.publishBundle(path);
      print(`  SQL → ${sql}`);
      night.written.push([w.item_type, w.level, kept, path]);
      if (night.stopped === null) {
        night.outcomes.push([w.item_type, w.level, shelf_rest.WRITTEN]);
      }
    }
    if (night.stopped !== null) {
      break;
    }
  }
  return night;
}

/** The whole-batch checks, one line each, and whether the bundle may ship. */
export function printBundleReport(bundle: Item, report: batchmod.BundleReport): void {
  const marks: Record<string, string> = { "pass": "OK  ", "note": "NOTE", "warn": "WARN", "fail": "FAIL" };
  print("\n" + "=".repeat(62));
  print(`BUNDLE CHECK — ${str(bundle["item_type"])} / ${str(bundle["level"])} / `
        + `${bundle["items"].length} item(s)`);
  print("=".repeat(62));
  for (const c of report.checks) {
    if (!has(marks, c.status)) {
      throw new KeyError(repr(c.status));
    }
    print(`  [${marks[c.status]}] ${c.name}: ${c.detail}`);
  }
  print("-".repeat(62));
  print(`  ${report.failed.length} failure(s), ${report.warned.length} warning(s), `
        + `${report.noted.length} note(s) — `
        + `${report.ok ? "SHIPPABLE" : "NOT SHIPPABLE"}`);
  print("  (offline checks only: the answerability gate and the discriminator "
        + "need an API key)");
}
