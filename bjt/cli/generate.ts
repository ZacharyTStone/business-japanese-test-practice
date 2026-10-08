/**
 * Writing items: one (`gen`), a smoke run (`smoke`), a shelf (`batch`), and a
 * night's work order (`plan`, `nightly`).
 *
 * What they drive lives in bjt/pipeline.ts and bjt/plan.ts; these parse, call
 * and print.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import * as batchmod from "../batch.ts";
import * as config from "../config.ts";
import * as levels from "../levels.ts";
import * as pipeline from "../pipeline.ts";
import * as plan from "../plan.ts";
import * as schemas from "../schemas.ts";
import * as shelf_rest from "../shelf_rest.ts";
import * as llmmod from "../llm.ts";
import { Store } from "../db/index.ts";
import { LLMBillingError } from "../llm.ts";
import {
  eprint, errText, fixed, g, get, IndexError, isException, pathStr, print, repr, str, sum, splitWs, truthy,
} from "../py.ts";
import { BUNDLE_FLOAT_KEYS, dumps } from "../pyjson.ts";
import type { Namespace, SubParsers } from "./argparse.ts";
import { printAnswer, printQuestion } from "./_print.ts";


export async function cmdGen(args: Namespace): Promise<number> {
  const store = new Store();
  try {
    const [item, iid, kept, detail] = await pipeline.generateAndGate(
      store, args.type, args.level, { gate: !args.no_gate,
                                      sanityCheck: !args.no_sanity },
    );
    if (args.json) {
      print(dumps(item, { ensureAscii: false, indent: 2, floatKeys: BUNDLE_FLOAT_KEYS }));
    } else {
      printQuestion(item);
      printAnswer(item);
    }
    eprint(`  #${iid}  ${detail}  ${kept ? "KEPT" : "DISCARDED"}`);
  } finally {
    store.close();
  }
  return 0;
}


/** Headless acceptance harness — the automated 'answer N in a row without a
 *  crash or a repeated scenario' check. No interaction; asserts every item is
 *  valid, records the gate verdict spread, and reports scenario repeats. */
export async function cmdSmoke(args: Namespace): Promise<number> {
  const store = new Store();
  let failures = 0;
  const topics: unknown[] = [];
  let keptN = 0;
  const verdicts = new Map<string, number>();
  try {
    const cells = pipeline.sampleCells(store, args.type, args.level, args.n);
    for (let i = 0; i < args.n; i++) {
      try {
        const [item, , kept, detail] = await pipeline.generateAndGate(
          store, args.type, args.level, { gate: !args.no_gate,
                                          cell: cells.length ? cells[i] : null },
        );
        const errs = schemas.validateItem(args.type, item);
        if (errs.length) {
          failures += 1;
          print(`  [${i + 1}/${args.n}] INVALID: ${repr(errs)}`);
          continue;
        }
        topics.push(get(item, "topic", ""));
        keptN += Number(kept);
        let verdict = "?";
        if (detail.includes("verdict=")) {
          const parts = detail.split("verdict=");
          const words = splitWs(parts[parts.length - 1]);
          if (!words.length) {
            throw new IndexError("list index out of range");
          }
          verdict = words[0];
        }
        verdicts.set(verdict, (verdicts.get(verdict) ?? 0) + 1);
        print(`  [${i + 1}/${args.n}] ok  topic=${repr(get(item, "topic", ""))}  ${detail}`);
      } catch (e) {
        if (e instanceof LLMBillingError) {
          throw e; // the ceiling or an empty account: every later item would fail too
        }
        if (!isException(e)) throw e;
        // a crash is a hard failure of the DoD check
        failures += 1;
        print(`  [${i + 1}/${args.n}] CRASH: ${errText(e)}`);
      }
    }

    const distinct = new Set(topics.filter((t) => truthy(t))).size;
    print("\n  " + "=".repeat(40));
    print(`  generated: ${topics.length + failures}   invalid/crashes: ${failures}`);
    print(`  distinct scenarios: ${distinct}/${topics.length}`);
    print(`  kept (served-able): ${keptN}`);
    print(`  gate verdicts: ${verdicts.size ? repr(verdicts) : "n/a (gate skipped)"}`);
    const ok = failures === 0;
    print(`  SMOKE ${ok ? "PASSED" : "FAILED"}`);
  } finally {
    store.close();
  }
  return failures === 0 ? 0 : 1;
}


/**
 * Generate a batch offline and write a shippable bundle.
 *
 * Nothing is generated at practice time, so this is where the money and the
 * waiting happen: gate each item, drop the ones that fail, then run the
 * whole-batch checks that a per-item gate cannot see.
 */
export async function cmdBatch(args: Namespace): Promise<number> {
  const store = new Store();
  try {
    let p: string | null;
    try {
      [p] = await pipeline.runBatch(
        store, args.type, args.level, args.n,
        { gate: !args.no_gate, sanityCheck: !args.no_sanity,
          force: args.force, out: args.out },
      );
    } catch (e) {
      if (!(e instanceof pipeline.ShelfStopped)) throw e;
      // The ceiling, or an empty account: what was kept before it is
      // bundled all the same, and the stop is said, not hidden.
      eprint(`\nStopped at ${e.kept} of ${args.n}: ${errText(e)}`);
      print(llmmod.state.spend.report());
      p = e.path;
    }
    if (p === null) {
      return 1;
    }
    const bundle = batchmod.load(p);
    print(`Next: synthesise the ${bundle["audio_manifest"].length} clip(s) in `
          + "audio_manifest, then eyeball the items once.");
    print(llmmod.state.spend.report());
  } finally {
    store.close();
  }
  return 0;
}


/**
 * What the bank needs next, counted rather than guessed.
 *
 * Needs no API key and no network: it reads the committed bundles and the seed
 * tables, and prints the work order the nightly run would execute. Run it
 * before approving a night's spend, or just to see whether the library is the
 * shape the practice queue needs it to be.
 */
export async function cmdPlan(args: Namespace): Promise<number> {
  const state = plan.survey();
  const [resting, warning] = await shelf_rest.load(seams.now());
  if (warning) {
    eprint(warning);
  }
  const order = plan.workOrder(state, { budget: args.budget, perSlot: args.per_slot,
                                        readingMin: args.reading_min, resting });
  if (args.json) {
    print(dumps(plan.toJson(state, order, { resting }), { ensureAscii: false, indent: 2 }));
  } else {
    print(plan.render(state, order, { resting }));
  }
  return 0;
}


/**
 * The nightly run: fill the emptiest shelves, check everything, stop.
 *
 * This is `bjt plan` followed by one `bjt batch` per line of the work order,
 * inside one process so that the cells spent by the first shelf are already
 * spent by the time the second one samples. Every item still goes through the
 * same per-item gate and the same whole-batch checks as a hand-run batch —
 * there is no fast path for being a robot.
 *
 * Nothing here publishes to a database. It writes bundles and their SQL into
 * the tree; the nightly workflow merges them only when the whole `checks`
 * workflow is green on their branch (2026-10-02: the gate, the proofreader,
 * the batch checks and `checks` are the review), and a red check leaves the
 * pull request for a person.
 */
export async function cmdNightly(args: Namespace): Promise<number> {
  const [budget, perSlot] = clampNight(args.budget, args.per_slot);
  const state = plan.survey();
  const now = seams.now();
  const [resting, loadWarning] = await shelf_rest.load(now);
  if (loadWarning) {
    eprint(loadWarning);
  }
  const order = plan.workOrder(state, { budget, perSlot,
                                        readingMin: args.reading_min, resting });
  print(plan.render(state, order, { resting }));
  print(`\nCeilings this run: $${fixed(config.RUN_BUDGET_USD, 2)}, `
        + `${str(config.RUN_MAX_CALLS)} calls, ${g(config.RUN_MAX_MINUTES)} minutes, `
        + `${str(config.MAX_TOKENS_CEILING)} output tokens per call, effort at most `
        + `${repr(config.EFFORT_CEILING)}; writer ${str(config.GEN_MODEL)}, judge ${str(config.JUDGE_MODEL)}.`);
  if (args.dry_run || order.length === 0) {
    return 0;
  }

  const store = new Store();
  let night: pipeline.NightResult;
  try {
    night = await pipeline.runNight(store, order, { gate: !args.no_gate,
                                                    sanityCheck: !args.no_sanity });
  } finally {
    store.close();
  }
  const [written, failures] = [night.written, night.failures];
  // What each shelf did tonight, for the next night's work order: a shelf
  // that keeps writing nothing rests rather than taking every budget.
  const warning = await shelf_rest.record(night.outcomes, now);
  if (warning) {
    eprint(warning);
  }

  const summary = _nightlySummary(written, failures, { spend: llmmod.state.spend });
  print();
  print(summary);
  if (args.summary) {
    writeFileSync(args.summary, summary + "\n", "utf8");
  }
  // Nothing written at all is worth a red run; a partial night is not.
  return written.length ? 0 : 1;
}


/** The clock the shelf ledger is read and written by; the tests' seam. */
function _now(): Date {
  return new Date();
}

/** What the tests replace: `cmdPlan` and `cmdNightly` read the clock through
 *  `seams.now` (Python's `gen._now`; `patch(gen.seams, "now", ...)`). */
export const seams = { now: _now };


/**
 * The night's size, no larger than config allows, whatever was asked.
 *
 * The workflow's inputs are typed into a box, and what is typed there must
 * not decide what a night costs. A request above the ceiling is honoured up
 * to the ceiling and said so, not refused: the run still happens, at a size
 * somebody decided in code.
 */
export function clampNight(budget: number, perSlot: number): [number, number] {
  const b = Math.max(0, Math.min(budget, config.NIGHT_MAX_BUDGET));
  const p = Math.max(0, Math.min(perSlot, config.NIGHT_MAX_PER_SLOT));
  if (b !== budget || p !== perSlot) {
    eprint(`night clamped to ${b} item(s), ${p} per shelf (asked: ${budget}, `
           + `${perSlot}; ceilings BJT_NIGHT_MAX_BUDGET=${config.NIGHT_MAX_BUDGET}, `
           + `BJT_NIGHT_MAX_PER_SLOT=${config.NIGHT_MAX_PER_SLOT})`);
  }
  return [b, p];
}


/** The run, as something that can be pasted into a pull request. */
export function _nightlySummary(
  written: readonly (readonly [string, string, number, string])[], failures: readonly string[],
  opts: { spend?: llmmod.Spend | null } = {},
): string {
  const spend = opts.spend ?? null;
  const total = sum(written.map(([, , kept]) => kept));
  const lines = [`Wrote ${total} item(s) across ${written.length} shelf/shelves.`, ""];
  for (const [itemType, level, kept, p] of written) {
    lines.push(`- **${kept} × ${itemType} ${level}** — \`${path.basename(p)}\``);
  }
  if (failures.length) {
    lines.push("", "Not written:");
    lines.push(...failures.map((f) => `- ${f}`));
  }
  if (spend !== null) {
    // The bill is part of the record: a reader of the pull request sees
    // what the night cost next to what it wrote, every night, so a bad
    // one is noticed the morning after and not on the invoice.
    lines.push("", "### What tonight cost", "", spend.report());
  }
  lines.push(
    "",
    "Every item passed the per-item answerability gate and the whole-batch "
    + "checks. The nightly workflow merges this once the checks pass on this "
    + "branch, and the deploy applies the SQL; a red check leaves it open, "
    + "with a comment saying why.",
  );
  return lines.join("\n");
}


/** Add this module's subcommands to the `bjt` parser. */
export function register(sub: SubParsers, types: string[]): void {
  const gp = sub.addParser("gen", { help: "generate, proofread, gate, store, and print one item" });
  gp.addArgument("--type", { required: true, choices: types });
  gp.addArgument("--level", { default: "J2", choices: levels.LEVELS });
  gp.addArgument("--no-gate", { action: "store_true", help: "skip the answerability gate" });
  gp.addArgument("--no-sanity", { action: "store_true",
                                  help: "skip the cheap proofreading pass before the gate" });
  gp.addArgument("--json", { action: "store_true", help: "print the item as JSON (verdict on stderr)" });
  gp.setDefaults({ func: cmdGen });
  const sm = sub.addParser("smoke", { help: "headless acceptance run: generate N items, assert no crash/invalid" });
  sm.addArgument("--type", { required: true, choices: types });
  sm.addArgument("--level", { default: "J2", choices: levels.LEVELS });
  sm.addArgument("-n", { type: "int", default: 10, help: "how many items" });
  sm.addArgument("--no-gate", { action: "store_true", help: "skip the answerability gate" });
  sm.setDefaults({ func: cmdSmoke });
  const b = sub.addParser("batch", { help: "generate a batch offline into a shippable JSON bundle" });
  b.addArgument("--type", { required: true, choices: types });
  b.addArgument("--level", { default: "J2", choices: levels.LEVELS });
  b.addArgument("-n", { type: "int", default: 10, help: "how many items to keep" });
  b.addArgument("--no-gate", { action: "store_true", help: "skip the answerability gate" });
  b.addArgument("--no-sanity", { action: "store_true", help: "skip the cheap proofreading pass before the gate" });
  b.addArgument("--out", { type: pathStr, default: null, help: "bundle path" });
  b.addArgument("--force", { action: "store_true", help: "write the bundle even if checks fail" });
  b.setDefaults({ func: cmdBatch });
  const pl = sub.addParser("plan", { help: "what the bank needs next, emptiest shelf first" });
  pl.addArgument("--budget", { type: "int", default: plan.DEFAULT_BUDGET,
                               help: "most items one run may write" });
  pl.addArgument("--per-slot", { type: "int", default: plan.DEFAULT_PER_SLOT,
                                 help: "most items one run may write into one (type, level)" });
  pl.addArgument("--reading-min", { type: "int", default: plan.DEFAULT_READING_MIN,
                                    help: "items reserved for the reading shelves before the rest" });
  pl.addArgument("--json", { action: "store_true", help: "machine-readable work order" });
  pl.setDefaults({ func: cmdPlan });
  const ni = sub.addParser("nightly", { help: "run the work order: generate, gate, check, publish SQL" });
  ni.addArgument("--budget", { type: "int", default: plan.DEFAULT_BUDGET,
                               help: "most items this run may write" });
  ni.addArgument("--per-slot", { type: "int", default: plan.DEFAULT_PER_SLOT,
                                 help: "most items this run may write into one (type, level)" });
  ni.addArgument("--reading-min", { type: "int", default: plan.DEFAULT_READING_MIN,
                                    help: "items reserved for the reading shelves before the rest" });
  ni.addArgument("--no-gate", { action: "store_true", help: "skip the answerability gate" });
  ni.addArgument("--no-sanity", { action: "store_true", help: "skip the cheap proofreading pass before the gate" });
  ni.addArgument("--dry-run", { action: "store_true", help: "print the work order and stop" });
  ni.addArgument("--summary", { default: null, help: "write a markdown summary here" });
  ni.setDefaults({ func: cmdNightly });
}
