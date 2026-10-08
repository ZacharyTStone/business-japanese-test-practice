/**
 * Everything a person runs by hand to look at the pipeline: `init`, `selftest`,
 * `seeds`, `seedtable`, `practice`, `quality`, `discriminate` and `calibrate`.
 *
 * Every handler is async: `practice` and `calibrate` read answers from the
 * terminal, `practice` and `discriminate` ask the models, and the rest are
 * async so that every command is called the same way.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import * as batchmod from "../batch.ts";
import * as calibration from "../calibration.ts";
import * as config from "../config.ts";
import { Store } from "../db/index.ts";
import * as discriminator from "../fidelity/discriminator.ts";
import * as roles from "../fidelity/roles.ts";
import * as vocab from "../fidelity/vocab.ts";
import * as fixtures from "../fixtures.ts";
import { loadSeedJson } from "../generators/base.ts";
import { GENERATORS } from "../generators/index.ts";
import * as levels from "../levels.ts";
import * as pipeline from "../pipeline.ts";
import {
  eprint, errText, get, has, indent, isDict, KeyError, or, pathStr, percent, print, PyError, repr, sorted, str, strip,
  sum, truthy, TypeError_, ValueError, write,
} from "../py.ts";
import * as render from "../render/index.ts";
import * as schemas from "../schemas.ts";
import * as seedsmod from "../seeds.ts";
import * as seedtable from "../seedtable.ts";
import { LETTERS, printAnswer, printQuestion } from "./_print.ts";
import type { Namespace, SubParsers } from "./argparse.ts";

/** An item: plain JSON data. */
type Item = Record<string, any>;

// ----- the terminal ----------------------------------------------------------

/** Python's EOFError: `input()` reached the end of stdin. */
export class EOFError extends PyError {}

/** The one reader of stdin a run's prompts share. A pipe delivers its lines in
 *  one chunk, and a reader made per prompt would drop the ones after the first
 *  when it closed. */
const _stdin: { rl: Interface | null; lines: AsyncIterator<string> | null } = { rl: null, lines: null };

/** `input(prompt)`: the prompt on stdout, then a line of stdin without its
 *  ending; EOFError at the end of stdin. */
async function _input(prompt: string): Promise<string> {
  write(prompt);
  if (_stdin.rl === null || _stdin.lines === null) {
    _stdin.rl = createInterface({ input: process.stdin, terminal: false });
    _stdin.lines = _stdin.rl[Symbol.asyncIterator]();
  }
  const next = await _stdin.lines.next();
  if (next.done) {
    throw new EOFError("EOF when reading a line");
  }
  return next.value;
}

/** Let go of stdin when a command that read it is done, so the process can
 *  end. */
function _closeInput(): void {
  if (_stdin.rl !== null) {
    _stdin.rl.close();
  }
  _stdin.rl = null;
  _stdin.lines = null;
}

/** What the tests fake: `patch(research.seams, "input", async (prompt) => "A")`
 *  is pytest's `monkeypatch.setattr("builtins.input", ...)`. */
export const seams = { input: _input };

// ----- the commands ----------------------------------------------------------

export async function cmdInit(args: Namespace): Promise<number> {
  new Store().close();  // creates the schema
  print(`Initialised database at ${config.DB_PATH}`);
  print(`Seeds directory: ${config.SEEDS_DIR}  (gitignored)`);
  print();
  print("To enable full fidelity, populate seeds/ — see seeds.example/ for the format:");
  print("  seeds/fewshot/<type>.json    3-5 official-style examples WITH their 解説");
  print("  seeds/official/<type>.json   official sample items (for discriminate/calibrate)");
  print("  seeds/vocab/*.txt            JLPT kanji tiers + business term list");
  print("  seeds/levels.json            official CAN-DO descriptors per level");
  return 0;
}

/** Exercise validation, role enforcement, and the DB with no API calls. */
export async function cmdSelftest(args: Namespace): Promise<number> {
  print("Running offline self-test (no API)...\n");
  let ok = true;

  // 1. Fixtures validate cleanly.
  for (const [it, item] of Object.entries(fixtures.FIXTURES)) {
    const errs = schemas.validateItem(it, item);
    print(`  validate ${it}: ${!errs.length ? "OK" : "FAIL " + str(errs)}`);
    ok = ok && !errs.length;
  }

  // 2. Role validation catches a duplicate role and a bad role.
  const bad = [
    { "text": "a", "role": "correct" },
    { "text": "b", "role": "opposite_valence" },
    { "text": "c", "role": "opposite_valence" },   // duplicate
    { "text": "d", "role": "not_a_real_role" },     // outside enum
  ];
  let errs = roles.validateRoles("goi_bunpou", bad);
  let caught = errs.some((e) => e.includes("duplicate")) && errs.some((e) => e.includes("not in"));
  print(`  role validator rejects duplicate + bad role: ${caught ? "OK" : "FAIL"}`);
  ok = ok && caught;

  // 3. Missing-correct is caught.
  const noCorrect = [..."abcd"].map((t) => ({ "text": t, "role": "opposite_valence" }));
  errs = roles.validateRoles("goi_bunpou", noCorrect);
  caught = errs.some((e) => e.includes("exactly 1 correct"));
  print(`  role validator rejects missing correct option: ${caught ? "OK" : "FAIL"}`);
  ok = ok && caught;

  // 4. Round-trip through the DB (a throwaway file).
  const dir = mkdtempSync(path.join(tmpdir(), "tmp"));
  try {
    const store = new Store({ path: path.join(dir, "selftest.db") });
    const iid = store.insertItem("goi_bunpou", "J2", fixtures.FIXTURES["goi_bunpou"],
                                 "fixture", { gateVerdict: "skipped" });
    store.recordResponse(iid, schemas.correctIndex(fixtures.FIXTURES["goi_bunpou"]["options"]), true);
    const acc = store.accuracyByType();
    // Every part a bool: an empty accuracy list here was a list, and
    // `ok &= []` a TypeError on exactly the path that reports a failure.
    const dbOk = truthy(store.getItem(iid)) && truthy(acc) && acc[0]["correct"] === 1;
    print(`  DB insert + response + accuracy round-trip: ${dbOk ? "OK" : "FAIL"}`);
    ok = ok && dbOk;
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  print(`\nSelf-test ${ok ? "PASSED" : "FAILED"}.`);
  return ok ? 0 : 1;
}

/** Validate and report what's in seeds/ so seeding is guided, not guesswork. */
export async function cmdSeeds(args: Namespace): Promise<number> {
  if (get(args, "bootstrap", false)) {
    const result = seedsmod.bootstrap({ force: get(args, "force", false) });
    print(result.summary());
    print();
  }

  print(`Seeds directory: ${config.SEEDS_DIR}`
        + (existsSync(path.join(config.SEEDS_DIR, seedsmod.MARKER))
          ? "  (bootstrapped from batches/, not licensed material)" : "")
        + "\n");
  let problems = 0;
  for (const t of sorted(Object.keys(GENERATORS))) {
    const fs = loadSeedJson("fewshot", t);
    const off = loadSeedJson("official", t);
    // A good few-shot example carries its 解説 and a valid option/role set.
    let fsGood = 0;
    for (const ex of fs) {
      const hasExpl = truthy(get(ex, "explanation_ja"));
      const options = get(ex, "options");
      const roleOk = Array.isArray(options) && options.length && isDict(options[0])
        ? !schemas.validateItem(t, ex).length : false;
      fsGood += hasExpl && roleOk ? 1 : 0;
    }
    const flag = fs.length ? "" : "  ← add 3-5 examples WITH their 解説";
    print(`  ${t}:`);
    print(`    fewshot:  ${fs.length} example(s), ${fsGood} well-formed${flag}`);
    print(`    official: ${off.length} item(s)`
          + (off.length ? "" : "  ← needed for discriminate/calibrate"));
    if (!fs.length) {
      problems += 1;
    }
  }

  const vs = vocab.statusSummary();
  print("\n  vocab:");
  print(`    JLPT kanji tiers loaded: ${str(or(vs.tiers_loaded, "none"))}`
        + (vs.tiers_loaded.length ? "" : "  ← add seeds/vocab/jlpt_*.txt to enable the kanji gate"));
  print(`    business terms: ${vs.business_terms}`);
  print("  levels: official CAN-DO descriptors "
        + `${levels.usingOfficialDescriptors() ? "loaded" : "NOT loaded (using neutral defaults)"}`);
  if (problems) {
    print(`\n  ${problems} item type(s) have no few-shot examples — generation quality `
          + "will suffer until you add them. See seeds.example/README.md.");
  }
  return 0;
}

export async function cmdPractice(args: Namespace): Promise<number> {
  if (args.demo) {
    return _practiceDemo(args);
  }

  const store = new Store();
  try {
    let served = 0;
    const target: number = args.n;
    let attemptsBudget = target * 4;  // cap regen attempts so a bad streak can't loop forever
    while (served < target && attemptsBudget > 0) {
      attemptsBudget -= 1;
      const [item, iid, kept, detail] = await pipeline.generateAndGate(
        store, args.type, args.level, { gate: !args.fast },
      );
      if (!kept) {
        print(`  (regenerating — ${detail})`);
        continue;
      }
      served += 1;
      print(`\n=== Item ${served}/${target} ===`);
      await _askAndScore(store, item, iid);
    }
    print(`\nDone. Answered ${served} item(s).`);
    _printRunAccuracy(store);
  } finally {
    store.close();
    _closeInput();
  }
  return 0;
}

/** Offline demo using the author-composed fixtures (no API key). */
export async function _practiceDemo(args: Namespace): Promise<number> {
  print("DEMO MODE — author-composed sample items, not official BJT material.\n");
  const store = new Store();
  try {
    const types: string[] = truthy(args.type) ? [args.type] : Object.keys(fixtures.FIXTURES);
    let served = 0;
    for (let i = 0; i < args.n; i++) {
      const t = types[i % types.length];
      if (!has(fixtures.FIXTURES, t)) {
        throw new KeyError(repr(t));
      }
      const item = fixtures.FIXTURES[t];
      const iid = store.insertItem(item["item_type"], item["level"], item,
                                   "demo-fixture", { gateVerdict: "skipped" });
      served += 1;
      print(`\n=== Item ${served}/${args.n} (demo) ===`);
      await _askAndScore(store, item, iid);
    }
    print(`\nDone. Answered ${served} item(s).`);
    _printRunAccuracy(store);
  } finally {
    store.close();
    _closeInput();
  }
  return 0;
}

export async function _askAndScore(store: Store, item: Item, itemId: number): Promise<void> {
  printQuestion(item);
  const ci = schemas.correctIndex(item["options"]);
  const choice = await _readChoice(item["options"].length);
  if (choice === null) {
    print("  (skipped)");
    return;
  }
  const correct = choice === ci;
  store.recordResponse(itemId, choice, correct);
  print(`\n  ${correct ? "✓ 正解！" : "✗ 不正解"}  (you chose ${LETTERS[choice]})\n`);
  printAnswer(item);
}

export async function _readChoice(n: number): Promise<number | null> {
  const offered = LETTERS.slice(0, n);
  for (;;) {
    let raw: string;
    try {
      raw = strip(await seams.input(`  Your answer [${offered.join("/")}, or 's' to skip]: `)).toUpperCase();
    } catch (e) {
      if (e instanceof EOFError) {
        return null;
      }
      throw e;
    }
    if (raw === "S") {
      return null;
    }
    if (offered.includes(raw)) {
      return LETTERS.indexOf(raw);
    }
    print("  Please enter one of:", offered.join(", "));
  }
}

export function _printRunAccuracy(store: Store): void {
  print("\n  Per-item-type accuracy so far (raw — never a BJT score):");
  for (const row of store.accuracyByType()) {
    const acc = row["accuracy"] !== null ? percent(row["accuracy"]) : "n/a";
    print(`    ${row["item_type"]}: ${row["correct"]}/${row["answered"]} (${acc})`);
  }
}

/** `f"{x:.0%}"` of a number the database may hand back as NULL, which Python
 *  refused to format. */
function _pct(x: unknown): string {
  if (x === null || x === undefined) {
    throw new TypeError_("unsupported format string passed to NoneType.__format__");
  }
  return percent(x as number);
}

export async function cmdQuality(args: Namespace): Promise<number> {
  const store = new Store();
  try {
    print("=".repeat(60));
    print("FIDELITY REPORT");
    print("=".repeat(60));

    print("\n[accuracy] raw per-item-type accuracy (no estimated BJT score):");
    const acc = store.accuracyByType();
    if (!acc.length) {
      print("  (no answers recorded yet)");
    }
    for (const row of acc) {
      const a = row["accuracy"] !== null ? percent(row["accuracy"]) : "n/a";
      print(`  ${row["item_type"]}: ${row["correct"]}/${row["answered"]} (${a})`);
    }

    print("\n[1 · distractor roles] item verdicts (role/gate/vocab enforcement):");
    const vc = store.verdictCounts();
    if (!vc.length) {
      print("  (no items generated yet)");
    }
    for (const row of vc) {
      print(`  ${str(row["item_type"])}: ${str(row["gate_verdict"])} × ${str(row["n"])}`);
    }

    print("\n[2 · answerability gate] average cold/full success (lower cold = less leakage):");
    const gs = store.gateSummary();
    if (!gs.length) {
      print("  (gate not run on any items yet)");
    }
    for (const row of gs) {
      print(`  ${str(row["item_type"])}: cold=${_pct(row["avg_cold"])}  full=${_pct(row["avg_full"])}  (n=${str(row["n"])})`);
    }

    print("\n[2b · difficulty probe] average pass rate of the difficulty model on kept items:");
    const ds = store.difficultySummary();
    if (!ds.length) {
      print("  (probe not run on any items yet)");
    }
    for (const row of ds) {
      print(`  ${str(row["item_type"])}: p_correct=${_pct(row["avg_rate"])}  (n=${str(row["n"])})`);
    }
    print(`  model: ${config.DIFFICULTY_MODEL}  trials: ${str(config.DIFFICULTY_TRIALS)}`
          + (config.DIFFICULTY_ENABLED ? "" : "  — DISABLED (BJT_DIFFICULTY=0)"));

    print("\n[3 · discriminator] latest discrimination rate (→ 50% is the goal):");
    const dr = store.latestDiscriminatorRuns();
    if (!dr.length) {
      print("  (run `bjt discriminate` — needs seeds/official/<type>.json)");
    }
    for (const row of dr) {
      print(`  ${str(row["item_type"])}: ${_pct(row["discrimination_rate"])} `
            + `(gen=${str(row["n_generated"])}, official=${str(row["n_official"])})`);
      for (const reason of (row["reasons"] as unknown[]).slice(0, 3)) {
        print(`      tell: ${str(reason)}`);
      }
    }

    print("\n[4 · document templates] the shapes a 資料 is set in (bjt/render/templates.ts):");
    print(`  ${Object.keys(render.TEMPLATES).length} templates: ${Object.keys(render.TEMPLATES).join(", ")}`);
    print("  every document is held to its template's required fields by `bjt checkbatch`");

    print("\n[5 · sanity check] items the proofreader stopped before the gate:");
    const stopped = sum(vc.filter((row) => row["gate_verdict"] === "discarded:sanity").map((row) => row["n"] as number));
    print(`  discarded:sanity × ${stopped}`
          + (stopped ? "" : "  (nothing has been flagged yet)"));
    print(`  model: ${config.SANITY_MODEL}`
          + (config.SANITY_ENABLED ? "" : "  — DISABLED (BJT_SANITY=0)"));

    print("\n[6 · vocabulary gating] loaded seed data:");
    const vs = vocab.statusSummary();
    print(`  JLPT kanji tiers loaded: ${str(or(vs.tiers_loaded, "none"))}`);
    print(`  business terms loaded: ${vs.business_terms}`);
    print("  official CAN-DO level descriptors: "
          + `${levels.usingOfficialDescriptors() ? "yes" : "no (using neutral defaults)"}`);

    print("\n[calibrate] `bjt calibrate --type <t> --attempts-csv <file>` sets your score on the");
    print("  official samples beside your first attempts in the app (the export SQL is in its --help).");
    print("=".repeat(60));
  } finally {
    store.close();
  }
  return 0;
}

export async function cmdDiscriminate(args: Namespace): Promise<number> {
  let official = loadSeedJson("official", args.type);
  if (!official.length) {
    eprint(`No official items found at seeds/official/${args.type}.json — `
           + "the discriminator needs real items to compare against.");
    return 2;
  }

  const store = new Store();
  try {
    const generated = store.keptItems(args.type, args.n);
    if (generated.length < 1) {
      eprint(`No generated ${args.type} items in the DB yet — run \`bjt gen\` first.`);
      return 2;
    }
    official = _normalizeOfficial(official, args.type).slice(0, args.n);
    print(`Discriminating ${generated.length} generated vs ${official.length} official ${args.type} items...`);
    let result: discriminator.DiscriminatorResult;
    try {
      result = await discriminator.runDiscriminator(args.type, generated, official);
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
      // A comparison the judge could win on the shape of the seed file
      // rather than on the writing. Reported as a fault to fix, never as
      // a rate — see discriminator._refuseLopsided.
      eprint(`\nCannot score this comparison: ${errText(e)}`);
      return 2;
    }
    store.insertDiscriminatorRun(
      args.type, result.n_generated, result.n_official,
      result.discrimination_rate, result.reasons,
    );
    print(`\n  discrimination rate: ${percent(result.discrimination_rate)} `
          + "(50% = judge cannot tell them apart)");
    print("  judge's stated tells:");
    for (const r of result.reasons) {
      print(`    - ${r}`);
    }
    print("\n  These tells are now auto-folded into the generator prompt for "
          + `${args.type}; the next items will be written to avoid them.`);
  } finally {
    store.close();
  }
  return 0;
}

/** `strerror` for the errors a read can meet, as Python prints them. */
const _STRERROR: Readonly<Record<string, string>> = {
  ENOENT: "No such file or directory",
  EACCES: "Permission denied",
  EPERM: "Operation not permitted",
  EISDIR: "Is a directory",
  ENOTDIR: "Not a directory",
  ELOOP: "Too many levels of symbolic links",
  ENAMETOOLONG: "File name too long",
};

/** A Node error that carries an errno code: Python's OSError. */
function _isOsError(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && typeof (e as NodeJS.ErrnoException).code === "string";
}

/** `str(exc)` of the OSError Python raised opening `filename`:
 *  `[Errno 2] No such file or directory: 'x.csv'`. */
function _osErrorText(e: NodeJS.ErrnoException, filename: string): string {
  const text = e.code !== undefined ? get(_STRERROR, e.code) : null;
  if (text === null || typeof e.errno !== "number") {
    return errText(e);
  }
  return `[Errno ${Math.abs(e.errno)}] ${text}: ${repr(filename)}`;
}

/**
 * Sit the official samples here; set the score beside the bank's.
 *
 * Right over answered on both sides, with how much was answered said
 * separately: a skip is not a wrong answer. The bank's side is your first
 * attempts in the app, from `--attempts-csv` (the export SQL is
 * `calibration.ATTEMPTS_EXPORT_SQL`, printed by `bjt calibrate --help`), or
 * what `bjt practice` recorded here when no file is given. See
 * bjt/calibration.ts for how both can flatter the bank.
 */
export async function cmdCalibrate(args: Namespace): Promise<number> {
  const official = _normalizeOfficial(loadSeedJson("official", args.type), args.type);
  if (!official.length) {
    eprint(`No official items at seeds/official/${args.type}.json to sit.`);
    return 2;
  }

  // The file is read before the sitting, so a wrong export is found before
  // anybody has answered ten questions rather than after.
  let bank: calibration.Tally | null = null;
  let source: string;
  if (truthy(args.attempts_csv)) {
    const csvPath = pathStr(args.attempts_csv);
    try {
      bank = calibration.readAttemptsCsv(csvPath, args.type);
    } catch (e) {
      // (OSError, ValueError): a Node error that carries an errno code is
      // Python's OSError.
      if (_isOsError(e)) {
        eprint(`cannot read ${args.attempts_csv}: ${_osErrorText(e, csvPath)}`);
        return 2;
      }
      if (!(e instanceof ValueError)) throw e;
      eprint(`cannot read ${args.attempts_csv}: ${errText(e)}`);
      return 2;
    }
    source = `your first attempts in the app (${path.basename(csvPath)})`;
  } else {
    source = "what `bjt practice` recorded here (--attempts-csv reads the app instead)";
  }

  const store = new Store();
  try {
    print(`Sitting ${official.length} official ${args.type} sample items.\n`);
    const sat = new calibration.Tally({ total: official.length });
    for (const [i, item] of official.entries()) {
      if ((get(item, "options", []) as unknown[]).length > LETTERS.length) {
        print(`\n(skipping official item ${i + 1}: more than ${LETTERS.length} options)`);
        continue;
      }
      print(`\n=== Official item ${i + 1}/${official.length} ===`);
      printQuestion(item);
      const ci = schemas.correctIndex(item["options"]);
      const choice = await _readChoice(item["options"].length);
      if (choice === null) {
        continue;
      }
      const correct = choice === ci;
      sat.answered += 1;
      sat.right += correct ? 1 : 0;
      print(`  ${correct ? "✓" : "✗"}  正解: ${LETTERS[ci]}\n`);
    }

    if (bank === null) {
      bank = calibration.fromStore(store, args.type);
    }
    // Each rate with the count it is a rate of: the answered items, not
    // the paper or the file.
    store.insertCalibrationRun(args.type, sat.accuracy, bank.accuracy,
                               sat.answered, bank.answered);
    print(calibration.report(args.type, sat, bank, source));
  } finally {
    store.close();
    _closeInput();
  }
  return 0;
}

/** Accept official seed items in either our item shape (options carry roles)
 *  or a lighter {stem, options:[str], answer: idx} shape, and normalise to our
 *  shape so the rest of the code can treat them uniformly. */
export function _normalizeOfficial(items: Item[], itemType: string): Item[] {
  const out: Item[] = [];
  for (const raw of items) {
    const opts = get(raw, "options", []);
    let item: Item;
    if (truthy(opts) && isDict(opts[0]) && has(opts[0], "role")) {
      item = { ...raw };
    } else {
      // A bool is an int to Python's `==` (`True == 1`).
      const rawAnswer = get(raw, "answer", 0);
      const answer = typeof rawAnswer === "boolean" ? Number(rawAnswer) : rawAnswer;
      item = { ...raw };
      // `enumerate(opts)`: a string's characters, as Python iterates one.
      item["options"] = (typeof opts === "string" ? [...opts] : opts as unknown[]).map((o, i) => ({
        "text": (typeof o === "string" ? o : get(o as Item, "text", "")),
        "role": i === answer ? roles.CORRECT : "unknown",
      }));
    }
    if (!has(item, "item_type")) item["item_type"] = itemType;
    if (!has(item, "level")) item["level"] = get(raw, "level", "");
    if (!has(item, "explanation_ja")) item["explanation_ja"] = get(raw, "explanation_ja", "");
    out.push(item);
  }
  return out;
}

/** Inspect the axes and how much of the table has been spent. This is the
 *  answer to 'will we run out of questions?' — it is a counting question, not a
 *  prompting one. */
export async function cmdSeedtable(args: Namespace): Promise<number> {
  const types = seedtable.available();
  if (!types.length) {
    eprint(`No seed tables in ${config.SEEDTABLE_DIR}.`);
    return 2;
  }

  const store = new Store();
  try {
    for (const t of !truthy(args.type) ? types : [args.type as string]) {
      const table = seedtable.load(t);
      const shipped = batchmod.spentCellIds(t);
      const local = new Set([...store.usedCellIds(t)].filter((c) => !shipped.has(c)));
      const used = new Set([...shipped, ...local]);
      const cov = table.coverage(used);
      print(`\n${t}  (${path.join(config.SEEDTABLE_DIR, t + ".json")})`);
      print(`  valid cells: ${cov["total_cells"]}   used: ${cov["used_cells"]}   `
            + `remaining: ${cov["total_cells"] - cov["used_cells"]}`);
      // Split out, because the two ledgers mean different things: one
      // travels with the repository, the other only exists here.
      print(`    of which shipped in batches/: ${shipped.size}`
            + (local.size ? `   local only: ${local.size}` : ""));
      for (const level of table.levels) {
        print(`    ${level}: ${table.cells({ level: level }).length} cell(s)`);
      }
      print(`  scene bank: ${cov["scene_bank"]} reusable image(s)`);
      if (args.sample) {
        print(`\n  sample of ${args.sample} unused cell(s) at ${args.level}:`);
        for (const c of table.sample(args.sample, { level: args.level,
                                                    excludeIds: used, seed: args.seed })) {
          print(`    ${c.id}`);
          print(`      ${c.describeJa()}  ·  ${c.channel}  ·  ${c.scenes.join("、")}`);
        }
      }
    }
  } finally {
    store.close();
  }
  return 0;
}


/** Add this module's subcommands to the `bjt` parser. */
export function register(sub: SubParsers, types: string[]): void {
  sub.addParser("init", { help: "create the DB and print seed setup instructions" }).setDefaults({ func: cmdInit });
  sub.addParser("selftest", { help: "offline validation + DB test (no API key)" }).setDefaults({ func: cmdSelftest });
  const se = sub.addParser("seeds", { help: "validate and report what's in seeds/" });
  se.addArgument("--bootstrap", { action: "store_true",
                                  help: "build seeds/ from the reference batches when there is no licensed material" });
  se.addArgument("--force", { action: "store_true",
                              help: "with --bootstrap: overwrite a seeds/ that holds real material" });
  se.setDefaults({ func: cmdSeeds });
  const st = sub.addParser("seedtable", { help: "inspect the 場面×関係×機能×レベル table" });
  const tables = seedtable.available();
  st.addArgument("--type", { choices: tables.length ? tables : undefined });
  st.addArgument("--level", { default: "J2", choices: levels.LEVELS });
  st.addArgument("--sample", { type: "int", default: 0, help: "also print N unused cells" });
  st.addArgument("--seed", { type: "int", default: null, help: "make the sample reproducible" });
  st.setDefaults({ func: cmdSeedtable });
  const prc = sub.addParser("practice", { help: "answer a run of items interactively" });
  prc.addArgument("--type", { choices: types, help: "restrict to one item type" });
  prc.addArgument("--level", { default: "J2", choices: levels.LEVELS });
  prc.addArgument("-n", { type: "int", default: 10, help: "how many items" });
  prc.addArgument("--fast", { action: "store_true", help: "skip the gate for speed" });
  prc.addArgument("--demo", { action: "store_true", help: "offline demo with sample items (no API key)" });
  prc.setDefaults({ func: cmdPractice });
  sub.addParser("quality", { help: "print the fidelity report" }).setDefaults({ func: cmdQuality });
  const d = sub.addParser("discriminate", { help: "run the discriminator loop" });
  d.addArgument("--type", { required: true, choices: types });
  d.addArgument("-n", { type: "int", default: 6, help: "max items per side" });
  d.setDefaults({ func: cmdDiscriminate });
  const c = sub.addParser(
    "calibrate", {
      help: "sit official items, compare to your accuracy on the bank",
      epilog: ("Your side of the bank comes from the app. Export it with this read-only\n"
               + "SQL in the D1 console of the Cloudflare dashboard (your sign-in address in place of\n"
               + "you@example.com), download the result as CSV, and pass the file:\n\n"
               + indent(calibration.ATTEMPTS_EXPORT_SQL, "    ")),
    });
  c.addArgument("--type", { required: true, choices: types });
  c.addArgument("--attempts-csv", { metavar: "PATH",
                                    help: "your first attempts in the app, exported with the SQL below "
                                          + "(columns item_type and is_correct, and chosen_index so a "
                                          + "timed-out answer is not counted as one); without it, what "
                                          + "`bjt practice` recorded in the local database" });
  c.setDefaults({ func: cmdCalibrate });
}
