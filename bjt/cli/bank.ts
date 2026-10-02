/**
 * The bank that already shipped: bundles in (`importbatch`), checked
 * (`checkbatch`), out as SQL (`publish`), and the passes over it for what an
 * item never got (`probe` in bjt/backfill.ts, `regate` in bjt/regate.ts).
 *
 * Every handler is async: `probe` and `regate` ask the models, and the rest
 * are async so that every command is called the same way.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as backfill from "../backfill.ts";
import * as batchmod from "../batch.ts";
import * as config from "../config.ts";
import { Store } from "../db/index.ts";
import * as difficulty from "../fidelity/difficulty.ts";
import { getGenerator } from "../generators/index.ts";
import * as jev from "../jev.ts";
import * as llmmod from "../llm.ts";
import * as pipeline from "../pipeline.ts";
import * as publish from "../publish.ts";
import { eprint, errText, fixed, g, get, print, repr, sorted, str, sum, truthy, ValueError } from "../py.ts";
import { loads } from "../pyjson.ts";
import { Random } from "../pyrandom.ts";
import * as regate from "../regate.ts";
import * as schemas from "../schemas.ts";
import * as seedtable from "../seedtable.ts";
import * as withdrawn from "../withdrawn.ts";
import { printAnswer, printQuestion } from "./_print.ts";
import type { Namespace, SubParsers } from "./argparse.ts";

/** An item or a bundle: plain JSON data. */
type Item = Record<string, any>;

/** `str(pathlib.Path(p))`: a path as pathlib spells it — repeated and
 *  trailing slashes and `.` components dropped, `..` kept, an empty path
 *  `.`. What the commands print where the Python printed a `Path`, and the
 *  argument type of `--out` (argparse's `type=pathlib.Path`). */
export function _pathStr(p: string): string {
  const lead = p.startsWith("//") && !p.startsWith("///") ? "//" : p.startsWith("/") ? "/" : "";
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  const out = lead + parts.join("/");
  return out === "" ? "." : out;
}

/**
 * Measure the difficulty of live items that shipped without a measurement.
 *
 * `items.model_p_correct` is the queue's prior on how hard a question is, and
 * it is the only term in `next_items()` that tells two items of the same type
 * and level apart. It is written at generation time — by the difficulty probe,
 * or failing that by the answerability gate — so an item that reached the
 * bank any other way has none. `bjt importbatch` is that other way: it stores
 * with `gate_verdict="skipped"` and measures nothing, which is right for an
 * offline import and leaves a hole: for those items the ranking term falls
 * back to a constant, so the pitch does nothing at all across them.
 *
 * This is the catch-up pass: the same probe, the same weaker model and the
 * same trial count, run over committed bundles (named, or `--all`) rather
 * than over a draft. It touches only live items whose rate is missing, so
 * re-running it is cheap and safe, and it obeys the run ceilings in
 * `bjt/llm.ts` like everything else — a bank-wide catch-up is exactly the
 * shape of run those ceilings exist for, so it writes each bundle as soon as
 * it is done and expects to be run more than once rather than to have them
 * raised (bjt/backfill.ts).
 *
 * Needs an API key. Without one every item reports unmeasured and the bundle
 * is left exactly as it was, because a fabricated prior is worse than none:
 * the queue would trust it.
 */
export async function cmdProbe(args: Namespace): Promise<number> {
  let paths: string[];
  try {
    paths = backfill.selectBundles(args.paths, args.all);
  } catch (e) {
    if (!(e instanceof ValueError)) throw e;
    eprint(errText(e));
    return 2;
  }
  if (truthy(args.compare)) {
    return _probeCompare(args, paths);
  }
  if (args.limit !== null) {
    eprint("--limit is for --compare; a probe measures every item without a rate.");
    return 2;
  }

  const shelves = backfill.surveyProbe(paths);
  for (const shelf of shelves) {
    if (shelf.todo.length || !args.all) {
      print(`${path.basename(shelf.path)}: ${shelf.n_items} item(s), ${shelf.todo.length} without a `
            + "difficulty signal"
            + (shelf.n_withdrawn ? ` (${shelf.n_withdrawn} withdrawn, skipped)` : ""));
    }
  }
  const work = shelves.filter((s) => s.todo.length);
  const items = sum(work.map((s) => s.todo.length));
  if (!items) {
    print("Nothing to measure.");
    return 0;
  }
  if (args.dry_run) {
    for (const shelf of work) {
      for (const it of shelf.todo) {
        print(`  would measure ${str(it["id"])} (${str(it["item_type"])} ${str(it["level"])})`);
      }
    }
    print(`\n${items} live item(s) in ${work.length} bundle(s) have no difficulty signal.`);
    const per = difficulty.callsPerItem();
    const calls = items * per;
    print(`That is ${calls} call(s) to ${config.DIFFICULTY_MODEL}, ${per} per item.`);
    print(backfill.runsEstimate(calls));
    return 0;
  }
  if (!config.DIFFICULTY_ENABLED) {
    eprint("The difficulty probe is switched off (BJT_DIFFICULTY=0); nothing measured.");
    return 1;
  }

  const run = await backfill.probeBank(work.map((s) => s.path));
  print();
  print(run.summary({ spend: llmmod.state.spend }));
  if (truthy(args.summary)) {
    writeFileSync(args.summary, run.summary({ spend: llmmod.state.spend }) + "\n", "utf8");
  }
  if (!run.measured) {
    eprint("\nNothing measured — every bundle is unchanged.");
    return 1;
  }
  print("\nThe bundles and their SQL are content — commit them and let the deploy "
        + "workflow apply the SQL.");
  return 0;
}

/** `bjt probe --compare MODEL`: the probe's model and MODEL on the same
 *  sample of live items, side by side. Writes nothing — no bundle, no SQL —
 *  so it is the evidence for choosing an instrument, never the change. */
export async function _probeCompare(args: Namespace, paths: string[]): Promise<number> {
  const candidate: string = args.compare;
  if (candidate === config.DIFFICULTY_MODEL) {
    eprint(`${candidate} is already the probe's model (BJT_DIFFICULTY_MODEL); `
           + "there is nothing to compare it with.");
    return 2;
  }
  const limit: number = args.limit !== null ? args.limit : backfill.COMPARE_LIMIT;
  if (limit < 1) {
    eprint("--limit must be at least 1.");
    return 2;
  }
  const todo = backfill.sample(paths, limit);
  if (!todo.length) {
    print("No live items to compare on.");
    return 0;
  }
  const calls = todo.length * (difficulty.callsPerItem() + difficulty.callsPerItem({ model: candidate }));
  if (args.dry_run) {
    for (const it of todo) {
      print(`  would compare on ${str(it["id"])} (${str(it["item_type"])} ${str(it["level"])})`);
    }
    print(`\n${todo.length} live item(s): ${calls} call(s) in all, `
          + `${difficulty.callsPerItem()} per item to ${config.DIFFICULTY_MODEL} and `
          + `${difficulty.callsPerItem({ model: candidate })} to ${candidate}. Nothing is written.`);
    print(`A run stops at ${str(config.RUN_MAX_CALLS)} calls, $${fixed(config.RUN_BUDGET_USD, 2)} or `
          + `${g(config.RUN_MAX_MINUTES)} minutes (BJT_RUN_*), and a comparison that stops `
          + "keeps what it measured but does not resume.");
    return 0;
  }
  if (!config.DIFFICULTY_ENABLED) {
    eprint("The difficulty probe is switched off (BJT_DIFFICULTY=0); nothing measured.");
    return 1;
  }
  // Checked here rather than found out three items in, after the baseline's
  // calls on them are already spent.
  if (jev.isJev(candidate) && !process.env.TYPESAFE_API_KEY) {
    eprint(`${candidate} needs TYPESAFE_API_KEY; nothing measured.`);
    return 1;
  }

  const cmp = await backfill.compareBank(paths, candidate, { limit: limit });
  const text = cmp.summary({ spend: llmmod.state.spend });
  print();
  print(text);
  if (truthy(args.summary)) {
    writeFileSync(args.summary, text + "\n", "utf8");
  }
  return cmp.rows.length ? 0 : 1;
}

/**
 * Put committed questions through the proofreader and the gate they skipped.
 *
 * Most of the bank came in through `bjt importbatch`, which checks an item's
 * shape and nothing else. This asks every live question the two things a
 * fresh draft is asked before it ships — does a proofreader find a fault, and
 * does the gate find it answerable and not leaky — in the same order and by
 * the same rules (bjt/regate.ts).
 *
 * Every verdict is written to batches/regated.txt as it is reached, so a run
 * stopped by the ceilings in bjt/llm.ts carries on where it stopped and a
 * question is never paid for twice. A failure is reported, and proposed for
 * batches/withdrawn.txt in that ledger's format with a reason from its
 * closed set; `--withdraw` appends the proposals and rewrites the SQL of the
 * bundles they are in through the publish path. Nothing is ever taken out of
 * the ledger, no bundle is edited, and nothing is published until the diff is
 * merged.
 */
export async function cmdRegate(args: Namespace): Promise<number> {
  let paths: string[];
  let shelves: backfill.Shelf[];
  try {
    paths = backfill.selectBundles(args.paths, args.all);
    shelves = regate.surveyRegate(paths);
  } catch (e) {
    // A bundle that is not JSON is a ValueError in Python (JSONDecodeError);
    // JSON.parse's is a SyntaxError.
    if (!(e instanceof ValueError || e instanceof SyntaxError)) throw e;
    eprint(errText(e));
    return 2;
  }

  for (const shelf of shelves) {
    if (shelf.todo.length || !args.all) {
      print(`${path.basename(shelf.path)}: ${shelf.n_items} item(s), ${shelf.todo.length} not yet `
            + "regated" + (shelf.n_withdrawn ? ` (${shelf.n_withdrawn} withdrawn, skipped)`
                           : ""));
    }
  }
  const work = shelves.filter((s) => s.todo.length);
  const items = sum(work.map((s) => s.todo.length));
  const perItem = 1 + 2 * config.GATE_TRIALS;

  if (args.dry_run) {
    for (const shelf of work) {
      for (const it of shelf.todo) {
        print(`  would check ${str(it["id"])} (${str(it["item_type"])} ${str(it["level"])})`);
      }
    }
    if (items) {
      print(`\n${items} live question(s) in ${work.length} bundle(s) have no verdict yet.`);
      print(`That is at most ${items * perItem} call(s): one to ${config.SANITY_MODEL} `
            + `and up to ${2 * config.GATE_TRIALS} to ${config.JUDGE_MODEL} per question.`);
      print(backfill.runsEstimate(items * perItem));
    } else {
      print("Every live question here has a verdict.");
    }
    _printProposals(regate.proposals(paths), { appended: false });
    return 0;
  }

  let run: regate.RegateRun | null = null;
  if (items) {
    if (!config.SANITY_ENABLED) {
      eprint("The proofreader is switched off (BJT_SANITY=0), and a regate is the "
             + "proofreader and then the gate; nothing checked.");
      return 2;
    }
    run = await regate.regateBank(work.map((s) => s.path));
    const verdicts: Record<string, number> = {};
    for (const [, verdict] of run.checked) {
      verdicts[verdict] = get(verdicts, verdict, 0) + 1;
    }
    const counted = sorted(Object.entries(verdicts));
    print(`\nChecked ${run.checked.length} question(s)`
          + (counted.length ? ": " + counted.map(([v, n]) => `${v} × ${n}`).join(", ")
             : "")
          + (run.unchecked ? `; ${run.unchecked} could not be checked` : "")
          + `; ${run.todo - run.checked.length} still without a verdict.`);
    if (truthy(run.stopped)) {
      print(`Stopped before the end: ${run.stopped}. The next run starts where this `
            + "one stopped.");
    }
    print(llmmod.state.spend.report());
  } else {
    print("Every live question here has a verdict.");
  }

  const found = regate.proposals(paths);
  if (found.length && args.withdraw) {
    let sqls: string[];
    try {
      sqls = regate.withdraw(found);
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
      eprint(`withdrawn.txt not changed: ${errText(e)}`);
      return 2;
    }
    _printProposals(found, { appended: true });
    for (const sql of sqls) {
      print(`  rewrote ${sql}`);
    }
  } else {
    _printProposals(found, { appended: false });
  }
  if (run !== null && !run.checked.length) {
    eprint("\nNothing checked.");
    return 1;
  }
  return 0;
}

export function _printProposals(found: [string, regate.Regated][], opts: { appended: boolean }): void {
  if (!found.length) {
    return;
  }
  print(`\n${found.length} question(s) failed and nobody has overruled them`
        + (opts.appended ? `; appended to batches/${withdrawn.LEDGER_NAME}:`
           : `; \`--withdraw\` appends these to batches/${withdrawn.LEDGER_NAME}:`));
  for (const [, entry] of found) {
    print("  " + withdrawn.line(regate.asWithdrawal(entry)));
  }
}

/**
 * Turn a hand-written source file into a checked bundle.
 *
 * Not every item has to come out of a model. The first batch of any new type is
 * written by hand — that is how you find out what the generator is supposed to
 * be aiming at — and the reference batch stays in the repo afterwards as the
 * regression set. This path runs exactly the same validation and the same
 * whole-batch checks as generated items; the only thing it skips is the model
 * call.
 */
export async function cmdImportbatch(args: Namespace): Promise<number> {
  const src: Item = loads(readFileSync(args.path, "utf8"));
  const [itemType, level]: [string, string] = [src["item_type"], src["level"]];
  const table = seedtable.load(itemType);
  const gen = getGenerator(itemType);

  const items: Item[] = [];
  let problems = 0;
  for (const [i, raw] of (src["items"] as Item[]).entries()) {
    const cell = table.get(get(raw, "seed_cell_id", ""));
    if (cell === null) {
      print(`  item ${i}: seed_cell_id ${repr(get(raw, "seed_cell_id"))} is not a valid `
            + `cell in seedtable/${itemType}.json`);
      problems += 1;
      continue;
    }
    if (cell.level !== level) {
      print(`  item ${i}: cell is ${cell.level}, bundle is ${level}`);
      problems += 1;
      continue;
    }
    const item: Item = Object.fromEntries(
      Object.entries(raw).filter(([k]) => !k.startsWith("_") && k !== "seed_cell_id"));
    item["item_type"] = itemType;
    item["level"] = level;
    item["seed_cell"] = cell.toDict();
    const errs = [...schemas.validateItem(itemType, item), ...gen.validateExtra(item, { cell: cell })];
    if (errs.length) {
      print(`  item ${i} (${str(get(item, "topic", ""))}): ${repr(errs)}`);
      problems += 1;
      continue;
    }
    items.push(item);
  }

  if (problems) {
    eprint(`\n${problems} item(s) rejected; nothing written.`);
    return 1;
  }

  if (args.shuffle) {
    const rng = new Random(args.seed);
    for (const item of items) {
      rng.shuffle(item["options"]);
    }
  }

  const model: string = get(src, "source", "author-composed");
  if (!args.no_store) {
    const store = new Store();
    try {
      for (const item of items) {
        store.insertItem(itemType, level, item, model, { gateVerdict: "skipped" });
      }
    } finally {
      store.close();
    }
  }

  const bundle = batchmod.buildBundle(itemType, level, items, model);
  const report = batchmod.checkBundle(bundle);
  pipeline.printBundleReport(bundle, report);
  if (!report.ok && !args.force) {
    eprint("\nBundle NOT written — fix the failures above or pass --force.");
    return 1;
  }
  const out = batchmod.save(bundle, {
    path: truthy(args.out) ? args.out : _pathStr((args.path as string).replaceAll(".source.json", ".json")),
  });
  print(`\nWrote ${items.length} item(s) to ${out}`);
  return 0;
}

/** Re-run every offline check over an existing bundle. No API key needed. */
export async function cmdCheckbatch(args: Namespace): Promise<number> {
  const bundle = batchmod.load(_pathStr(args.path));
  const report = batchmod.checkBundle(bundle);
  pipeline.printBundleReport(bundle, report);
  if (args.show) {
    for (const bi of bundle["items"] as Item[]) {
      const item: Item = { ...bi };
      item["options"] = [...bi["options"]];
      printQuestion(item);
      printAnswer(item);
    }
  }
  return report.ok ? 0 : 1;
}

/** Bundle → SQL. Content reaches the database as a reviewable file, never as
 *  a live call from a laptop holding a service key. */
export async function cmdPublish(args: Namespace): Promise<number> {
  const p = _pathStr(args.path);
  const bundle = batchmod.load(p);
  const report = batchmod.checkBundle(bundle);
  if (!report.ok && !args.force) {
    pipeline.printBundleReport(bundle, report);
    eprint("\nRefusing to publish a bundle that fails its own checks.");
    return 1;
  }

  const [out] = publish.publishBundle(p, { out: args.out });
  const nClips = (get(bundle, "audio_manifest", []) as unknown[]).length;
  print(`Wrote ${out}`);
  print(`  ${bundle["items"].length} item(s), ${nClips} audio clip(s), `
        + `${(get(bundle, "scenes", []) as unknown[]).length} scene(s)`);
  const pulled = bundle["items"].length - withdrawn.liveItems(bundle).length;
  if (pulled) {
    print(`  ${pulled} of the items are withdrawn (batches/${withdrawn.LEDGER_NAME}) `
          + "and are unpublished by this file");
  }
  print();
  print("Apply it with either:");
  print(`  (cd client && npx wrangler d1 execute business-japanese-drill --remote --file ../${out})`);
  print("  or paste it into the D1 console in the Cloudflare dashboard");
  print();
  print("Re-running it is safe — every statement is an upsert.");
  return 0;
}


/** Add this module's subcommands to the `bjt` parser. */
export function register(sub: SubParsers, types: string[]): void {
  const ib = sub.addParser("importbatch", { help: "validate a hand-written source file into a bundle" });
  ib.addArgument("path");
  ib.addArgument("--out", { type: _pathStr, default: null, help: "bundle path" });
  ib.addArgument("--shuffle", { action: "store_true",
                                help: "re-shuffle option order (leave off when the author set it deliberately)" });
  ib.addArgument("--seed", { type: "int", default: null, help: "make --shuffle reproducible" });
  ib.addArgument("--no-store", { action: "store_true",
                                 help: "do not record the items (and so the cells they use) in the DB" });
  ib.addArgument("--force", { action: "store_true", help: "write the bundle even if checks fail" });
  ib.setDefaults({ func: cmdImportbatch });
  const pb = sub.addParser("publish", { help: "turn a bundle into idempotent SQL for the database" });
  pb.addArgument("path");
  pb.addArgument("--out", { type: _pathStr, default: null,
                            help: "where to write the SQL (default: alongside the bundle)" });
  pb.addArgument("--force", { action: "store_true",
                              help: "publish even if the bundle fails its own checks" });
  pb.setDefaults({ func: cmdPublish });
  const prb = sub.addParser("probe", { help: "measure difficulty for live items that shipped without it" });
  prb.addArgument("paths", { nargs: "*", metavar: "PATH", help: "committed bundles (batches/*.json)" });
  prb.addArgument("--all", { action: "store_true", help: "every committed bundle" });
  prb.addArgument("--dry-run", { action: "store_true",
                                 help: "list what would be measured, count the calls, and spend nothing" });
  prb.addArgument("--summary", { default: null, help: "write a markdown summary here" });
  prb.addArgument("--compare", { default: null, metavar: "MODEL",
                                 help: "measure a sample of live items with MODEL beside the probe's model "
                                       + "(e.g. jev-latest) and print both; writes nothing" });
  prb.addArgument("--limit", { type: "int", default: null, metavar: "N",
                               help: `with --compare: how many items (default ${backfill.COMPARE_LIMIT}), `
                                     + "taken a type at a time" });
  prb.setDefaults({ func: cmdProbe });
  const rg = sub.addParser("regate", { help: "put committed questions through the proofreader and "
                                             + "the gate they skipped" });
  rg.addArgument("paths", { nargs: "*", metavar: "PATH", help: "committed bundles (batches/*.json)" });
  rg.addArgument("--all", { action: "store_true", help: "every committed bundle" });
  rg.addArgument("--dry-run", { action: "store_true",
                                help: "list what would be checked, count the calls, show what --withdraw "
                                      + "would append, and spend nothing" });
  rg.addArgument("--withdraw", { action: "store_true",
                                 help: "append every failure nobody has overruled to "
                                       + `batches/${withdrawn.LEDGER_NAME} and rewrite its bundle's SQL` });
  rg.setDefaults({ func: cmdRegate });
  const cb = sub.addParser("checkbatch", { help: "run the offline quality checks over a bundle" });
  cb.addArgument("path");
  cb.addArgument("--show", { action: "store_true", help: "also print every item with its 解説" });
  cb.setDefaults({ func: cmdCheckbatch });
}
