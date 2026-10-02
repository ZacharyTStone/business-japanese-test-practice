/**
 * The passes over the bank that already shipped (bjt/backfill.ts, bjt/regate.ts).
 *
 * Every test here fakes the model. What is under test is the bookkeeping around
 * it: only live items, only what is missing, every bundle written as soon as it
 * is done, a run stopped by its ceiling keeping what it paid for, and the next
 * run picking up where that one stopped.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as backfill from "../bjt/backfill.ts";
import * as batch from "../bjt/batch.ts";
import * as config from "../bjt/config.ts";
import * as answerability from "../bjt/fidelity/answerability.ts";
import * as difficulty from "../bjt/fidelity/difficulty.ts";
import * as sanity from "../bjt/fidelity/sanity.ts";
import * as llm from "../bjt/llm.ts";
import * as publish from "../bjt/publish.ts";
import { ValueError, zip } from "../bjt/py.ts";
import * as regate from "../bjt/regate.ts";
import * as withdrawn from "../bjt/withdrawn.ts";
import { capture, patch, setConfig, tmpPath } from "./helpers.ts";

type Item = Record<string, any>;

const ROOT = path.resolve(import.meta.dirname, "..");
/** Two small committed bundles, two live items each, in this order on disk. */
const SHELVES = ["hyougen_J3_001.json", "sougou_dokkai_J1_001.json"] as const;

/** Not ported yet: the CLI. Imported by a name tsc does not resolve, so this
 *  file type-checks before bjt/cli/index.ts exists. */
const CLI_MODULE = "../bjt/cli/index.ts";

/** `bank`: the two bundles in a batches/ of their own, with no rates and
 *  nothing withdrawn, and a fresh spend ledger: a bank the tests may write to. */
function bank(): string {
  const d = path.join(tmpPath(), "batches");
  mkdirSync(d);
  for (const name of SHELVES) {
    const bundle = JSON.parse(readFileSync(path.join(ROOT, "batches", name), "utf8"));
    for (const it of bundle["items"]) {
      delete it["model_p_correct"];
    }
    batch.save(bundle, { path: path.join(d, name) });
  }
  writeFileSync(path.join(d, withdrawn.LEDGER_NAME), "# nothing withdrawn\n", "utf8");
  setConfig({ BATCH_DIR: d });
  patch(llm.state, "spend", new llm.Spend());
  return d;
}

function _cells(d: string, name: string): string[] {
  return batch.load(path.join(d, name))["items"].map((it: Item) => it["seed_cell"]["id"]);
}

function _rates(d: string, name: string): (number | null)[] {
  return batch.load(path.join(d, name))["items"].map((it: Item) => it["model_p_correct"] ?? null);
}

function _sqlOf(d: string, name: string): string {
  return path.join(d, name.replace(/\.json$/, ".sql"));
}

/** The SQL beside the bundle is exactly what `bjt publish` writes from it. */
function _sqlIsPublished(d: string, name: string): boolean {
  const p = path.join(d, name);
  return readFileSync(_sqlOf(d, name), "utf8") === publish.bundleSql(
    batch.load(p), path.basename(p, path.extname(p)));
}

/** `measured`: a probe that answers, and bills one call per item as the real
 *  one would bill five. Returns the seed cells it was asked about, in order. */
function measured(): string[] {
  const seen: string[] = [];

  patch(difficulty, "measure", async (item: Item) => {
    seen.push(item["seed_cell"]["id"]);
    llm.state.spend.beginRequest();  // what a real call does first
    llm.state.spend.add("claude-haiku-4-5", { input_tokens: 100, output_tokens: 10 });
    return new difficulty.DifficultyResult({
      rate: 0.6, model: "weak-model", measured: true, trials: [0, 1, 2, 3, 4].map((t) =>
        new answerability.Trial({ side: "difficulty", trial: t, chosen: 0, correct: t < 3 })),
    });
  });
  return seen;
}

// ----- the probe ----------------------------------------------------------------

describe("the probe", () => {
  // needs bjt/cli (ported later)
  test.skip("the whole bank is counted before anything is spent", async () => {
    const cli: any = await import(CLI_MODULE);
    const cap = capture();
    patch(difficulty, "measure", async () => {
      throw new Error("--dry-run must not reach the model");
    });

    const gone = withdrawn.ids();
    let missing = 0;
    for (const p of batch.bundles()) {
      for (const it of withdrawn.liveItems(batch.load(p), { withdrawn: gone })) {
        if ((it["model_p_correct"] ?? null) === null) missing += 1;
      }
    }
    expect(await cli.main({ argv: ["probe", "--all", "--dry-run"] })).toBe(0);
    const out = cap.readouterr().out;
    if (missing) {
      expect(out).toContain(`${missing} live item(s) in`);
      expect(out).toContain(`${missing * config.DIFFICULTY_TRIALS} call(s) to ${config.DIFFICULTY_MODEL}`);
      expect(out.includes("at least") && out.includes("run(s)")).toBe(true);
    } else {
      expect(out).toContain("Nothing to measure.");
    }
  });

  /** Three items' allowance for four items: the first bundle is written whole,
   *  the second with the one item it got to, and the run says it stopped. */
  // needs bjt/cli (ported later)
  test.skip("a run stopped by its ceiling keeps what it measured", async () => {
    const cli: any = await import(CLI_MODULE);
    const tmp = tmpPath();
    const d = bank();
    measured();
    capture();
    setConfig({ RUN_MAX_CALLS: 3 });
    const summary = path.join(tmp, "summary.md");
    expect(await cli.main({ argv: ["probe", "--all", "--summary", summary] })).toBe(0);

    expect(_rates(d, SHELVES[0])).toEqual([0.6, 0.6]);
    expect(_rates(d, SHELVES[1])).toEqual([0.6, null]);
    expect(_sqlIsPublished(d, SHELVES[0]) && _sqlIsPublished(d, SHELVES[1])).toBe(true);
    expect(readFileSync(_sqlOf(d, SHELVES[1]), "utf8")).toContain("model_p_correct");
    const text = readFileSync(summary, "utf8");
    expect(text).toContain("Measured the difficulty of 3 item(s) in 2 bundle(s); 1 live item(s) still");
    expect(text.includes("call ceiling reached") && text.includes("What it cost")).toBe(true);
  });

  // needs bjt/cli (ported later)
  test.skip("the next run resumes where the last one stopped", async () => {
    const cli: any = await import(CLI_MODULE);
    const d = bank();
    const seen = measured();
    setConfig({ RUN_MAX_CALLS: 3 });
    expect(await cli.main({ argv: ["probe", "--all"] })).toBe(0);
    const first = [...seen];

    patch(llm.state, "spend", new llm.Spend());   // a new run, a new allowance
    expect(await cli.main({ argv: ["probe", "--all"] })).toBe(0);

    expect(seen.slice(first.length), "only what was left").toEqual([_cells(d, SHELVES[1])[1]]);
    expect(_rates(d, SHELVES[1])).toEqual([0.6, 0.6]);
    expect(await cli.main({ argv: ["probe", "--all"] })).toBe(0);          // and then there is nothing to do
    expect(seen.length).toBe(4);
  });

  // needs bjt/cli (ported later)
  test.skip("a withdrawn item is never measured", async () => {
    const cli: any = await import(CLI_MODULE);
    const d = bank();
    const seen = measured();
    const victim = batch.load(path.join(d, SHELVES[0]))["items"][0];
    writeFileSync(path.join(d, withdrawn.LEDGER_NAME),
                  `${victim["id"]}  unnatural  A line nobody would say, for the test.\n`, "utf8");

    expect(await cli.main({ argv: ["probe", "--all"] })).toBe(0);
    expect(!seen.includes(victim["seed_cell"]["id"]) && seen.length === 3).toBe(true);
    expect(_rates(d, SHELVES[0])).toEqual([null, 0.6]);
    // And the SQL written for its bundle still unpublishes it.
    expect(readFileSync(_sqlOf(d, SHELVES[0]), "utf8")).toContain("is_published = 0");
  });

  // needs bjt/cli (ported later)
  test.skip("an unreachable model stops the pass and writes nothing", async () => {
    const cli: any = await import(CLI_MODULE);
    const d = bank();
    const cap = capture();
    const calls: number[] = [];

    patch(difficulty, "measure", async () => {
      calls.push(1);
      return new difficulty.DifficultyResult({
        model: "weak-model", measured: false, trials: [0, 1, 2, 3, 4].map((t) =>
          new answerability.Trial({ side: "difficulty", trial: t, chosen: null, correct: false })),
      });
    });

    const snapshot = () => Object.fromEntries(SHELVES.map((name) => [name, readFileSync(path.join(d, name))]));
    const before = snapshot();
    expect(await cli.main({ argv: ["probe", "--all"] })).toBe(1);
    expect(calls.length, "three unreachable items in a row are enough").toBe(3);
    expect(snapshot()).toEqual(before);
    expect(readdirSync(d).filter((n) => n.endsWith(".sql"))).toEqual([]);
    expect(cap.readouterr().out).toContain("could not be reached for 3 items in a row");
  });

  // needs bjt/cli (ported later)
  test.skip.each([
    [["probe"]],                                               // nothing named
    [["probe", "--all", "batches/hyougen_J3_001.json"]],       // both
    [["probe", "batches/hyougen_J3_001.source.json"]],         // a source file
    [["probe", "batches/no_such_bundle.json"]],                // nothing there
  ])("a probe that cannot mean anything is refused %j", async (argv) => {
    const cli: any = await import(CLI_MODULE);
    const cap = capture();
    expect(await cli.main({ argv })).toBe(2);
    expect(cap.readouterr().err).toBeTruthy();
  });
});

// ----- the regate ----------------------------------------------------------------

function _key(item: Item): number {
  return item["options"].findIndex((o: Item) => o["role"] === "correct");
}

function _ids(d: string): string[] {
  return SHELVES.flatMap((name) => batch.load(path.join(d, name))["items"].map((it: Item) => it["id"]));
}

type Reviewers = {
  cells: string[];
  plan: Record<string, string>;
  asked: { sanity: string[]; gate: string[] };
};

/** `reviewers`: a proofreader and a gate that say, by seed cell, what the test
 *  decides: the first question is clean and kept, the second reads
 *  unnaturally, the third's options give it away, the fourth's key is
 *  disputed. Each proofreading bills one call. Returns what each was asked
 *  about. */
function reviewers(d: string): Reviewers {
  const cells = [..._cells(d, SHELVES[0]), ..._cells(d, SHELVES[1])];
  const plan: Record<string, string> = Object.fromEntries(
    zip(cells, ["kept", "unnatural", "leaky", "wrong"], { strict: true }));
  const asked = { sanity: [] as string[], gate: [] as string[] };

  patch(sanity, "runCheck", async (item: Item) => {
    const cell = item["seed_cell"]["id"];
    asked.sanity.push(cell);
    llm.state.spend.beginRequest();
    llm.state.spend.add("claude-haiku-4-5", { input_tokens: 100, output_tokens: 10 });
    if (plan[cell] === "down") {
      return new sanity.SanityResult({ checked: false, notes: "API request failed: overloaded" });
    }
    if (plan[cell] === "unnatural") {
      return new sanity.SanityResult({
        faults: ["unnatural_japanese", "broken_japanese"],
        notes: "「お借りさせていただかせていただいても」は\n誰も言わない。" });
    }
    return new sanity.SanityResult();
  });

  patch(answerability, "runGate", async (item: Item) => {
    const cell = item["seed_cell"]["id"];
    asked.gate.push(cell);
    const ci = _key(item);
    const other = (ci + 1) % 4;
    const T = (side: string, trial: number, chosen: number | null, correct: boolean, reason?: string) =>
      new answerability.Trial({ side, trial, chosen, correct, reason });
    const cold = [T("cold", 0, other, false), T("cold", 1, other, false)];
    if (plan[cell] === "leaky") {
      return new answerability.GateResult({ cold_success_rate: 1.0, full_success_rate: null, verdict: "discarded:leaky", trials: [
        T("cold", 0, ci, true, "only this option answers a request"),
        T("cold", 1, ci, true, "the others are refusals")] });
    }
    if (plan[cell] === "wrong") {
      return new answerability.GateResult({ cold_success_rate: 0.0, full_success_rate: 0.0, verdict: "discarded:ambiguous", trials: [
        T("full", 0, other, false, "the document says Tuesday"),
        T("full", 1, other, false), ...cold] });
    }
    if (plan[cell] === "unreachable") {
      return new answerability.GateResult({ cold_success_rate: 0.0, full_success_rate: 1.0, verdict: "kept", trials: [
        T("full", 0, ci, true), T("full", 1, null, false), ...cold] });
    }
    return new answerability.GateResult({ cold_success_rate: 0.0, full_success_rate: 1.0, verdict: "kept", trials: [
      T("full", 0, ci, true), T("full", 1, ci, true), ...cold] });
  });
  return { cells, plan, asked };
}

describe("the regate", () => {
  // needs bjt/cli (ported later)
  test.skip("the regate dry run counts the calls and spends nothing", async () => {
    const cli: any = await import(CLI_MODULE);
    const cap = capture();
    const explode = async (): Promise<never> => {
      throw new Error("--dry-run must not reach a model");
    };
    patch(sanity, "runCheck", explode);
    patch(answerability, "runGate", explode);

    const [gone, done] = [withdrawn.ids(), regate.loadRegated()];
    let todo = 0;
    for (const p of batch.bundles()) {
      for (const it of withdrawn.liveItems(batch.load(p), { withdrawn: gone })) {
        if (!done.has(it["id"])) todo += 1;
      }
    }
    expect(await cli.main({ argv: ["regate", "--all", "--dry-run"] })).toBe(0);
    const out = cap.readouterr().out;
    if (todo) {
      expect(out).toContain(`${todo} live question(s) in`);
      expect(out).toContain(`at most ${todo * (1 + 2 * config.GATE_TRIALS)} call(s)`);
    } else {
      expect(out).toContain("Every live question here has a verdict.");
    }
  });

  // needs bjt/cli (ported later)
  test.skip("every verdict is written down and the failures are proposed", async () => {
    const cli: any = await import(CLI_MODULE);
    const d = bank();
    const r = reviewers(d);
    const cap = capture();
    const ledger = readFileSync(path.join(d, withdrawn.LEDGER_NAME), "utf8");
    expect(await cli.main({ argv: ["regate", "--all"] })).toBe(0);
    const out = cap.readouterr().out;

    const ids = _ids(d);
    const got = regate.loadRegated();
    expect(ids.map((i) => [got.get(i)!.verdict, got.get(i)!.reason])).toEqual([
      ["kept", "-"],
      ["discarded:sanity", "unnatural"],
      ["discarded:leaky", "other"],
      ["discarded:ambiguous", "wrong_answer"]]);
    // The proofreader never hands the gate a question it already failed.
    expect(r.asked.gate).toEqual([r.cells[0], r.cells[2], r.cells[3]]);
    expect(got.get(ids[1])!.note).toContain("unnatural_japanese+broken_japanese");
    expect(got.get(ids[1])!.note).not.toContain("\n");
    expect(got.get(ids[2])!.note).toContain("only this option answers a request");
    expect(got.get(ids[3])!.note.includes("chose option") && got.get(ids[3])!.note.includes("the document says Tuesday")).toBe(true);

    // Proposed, not written: the ledger is untouched without --withdraw.
    expect(readFileSync(path.join(d, withdrawn.LEDGER_NAME), "utf8")).toBe(ledger);
    expect(out).toContain("`--withdraw` appends these");
    expect(out.split(`  ${ids[1]}  unnatural`).length - 1).toBe(1);
  });

  // needs bjt/cli (ported later)
  test.skip("withdraw appends the proposals and publishes them", async () => {
    const cli: any = await import(CLI_MODULE);
    const d = bank();
    reviewers(d);
    capture();
    const before = readFileSync(path.join(d, withdrawn.LEDGER_NAME), "utf8");
    const snapshot = () => Object.fromEntries(SHELVES.map((name) => [name, readFileSync(path.join(d, name))]));
    const bundles = snapshot();
    expect(await cli.main({ argv: ["regate", "--all", "--withdraw"] })).toBe(0);

    const after = readFileSync(path.join(d, withdrawn.LEDGER_NAME), "utf8");
    expect(after.startsWith(before), "nothing in the ledger is rewritten or removed").toBe(true);
    expect(after).toContain("proposed by `bjt regate`");
    const ids = _ids(d);
    const ledger = withdrawn.load();
    expect(Object.fromEntries(Object.entries(ledger).map(([i, w]) => [i, w.reason]))).toEqual({
      [ids[1]]: "unnatural", [ids[2]]: "other", [ids[3]]: "wrong_answer" });
    expect(Object.values(ledger).every((w) => w.note.length >= 20)).toBe(true);

    // The bundles are not edited; their SQL is what `bjt publish` writes now,
    // and it unpublishes exactly the proposals.
    expect(snapshot()).toEqual(bundles);
    for (const name of SHELVES) {
      expect(_sqlIsPublished(d, name)).toBe(true);
    }
    const unpublished = readFileSync(_sqlOf(d, SHELVES[0]), "utf8").split("is_published = 0")[1];
    expect(unpublished.includes(ids[1]) && !unpublished.includes(ids[0])).toBe(true);

    // A second run finds nothing left to check and nothing new to add.
    expect(await cli.main({ argv: ["regate", "--all", "--withdraw"] })).toBe(0);
    expect(readFileSync(path.join(d, withdrawn.LEDGER_NAME), "utf8")).toBe(after);
  });

  // needs bjt/cli (ported later)
  test.skip("a regate stopped by its ceiling carries on where it stopped", async () => {
    const cli: any = await import(CLI_MODULE);
    const d = bank();
    const r = reviewers(d);
    capture();
    // Each question costs one proofreading call here; two calls' allowance
    // stops the run after two questions.
    setConfig({ RUN_MAX_CALLS: 2 });
    expect(await cli.main({ argv: ["regate", "--all"] })).toBe(0);
    expect([...regate.loadRegated().keys()]).toEqual(_ids(d).slice(0, 2));

    patch(llm.state, "spend", new llm.Spend());
    expect(await cli.main({ argv: ["regate", "--all"] })).toBe(0);
    expect(r.asked.sanity, "each question checked exactly once").toEqual(r.cells);
    expect([...regate.loadRegated().keys()]).toEqual(_ids(d));
  });

  // needs bjt/cli (ported later)
  test.skip("an outage decides nothing", async () => {
    const cli: any = await import(CLI_MODULE);
    const d = bank();
    const r = reviewers(d);
    capture();
    for (const cell of r.cells) {
      r.plan[cell] = "down";
    }
    expect(await cli.main({ argv: ["regate", "--all", "--withdraw"] })).toBe(1);
    expect(r.asked.sanity.length).toBe(backfill.UNREACHABLE_PATIENCE);
    expect(existsSync(regate.regateLedgerPath())).toBe(false);
    expect(withdrawn.load()).toEqual({});
  });

  // needs bjt/cli (ported later)
  test.skip("a gate that could not answer every trial decides nothing", async () => {
    const cli: any = await import(CLI_MODULE);
    const d = bank();
    const r = reviewers(d);
    capture();
    r.plan[r.cells[0]] = "unreachable";
    expect(await cli.main({ argv: ["regate", "--all"] })).toBe(0);
    expect(regate.loadRegated().has(_ids(d)[0])).toBe(false);
  });

  // needs bjt/cli (ported later)
  test.skip("an overruled or withdrawn question is left alone", async () => {
    const cli: any = await import(CLI_MODULE);
    const d = bank();
    const r = reviewers(d);
    capture();
    const ids = _ids(d);
    regate.recordRegated(new regate.Regated({ item_id: ids[1], verdict: "overruled", date: "2026-09-27",
                                              reason: "unnatural", note: "Read by the owner, who keeps it." }));
    writeFileSync(path.join(d, withdrawn.LEDGER_NAME),
                  `${ids[2]}  unclear       Withdrawn by hand before the regate ran.\n`, "utf8");

    expect(await cli.main({ argv: ["regate", "--all", "--withdraw"] })).toBe(0);
    expect(r.asked.sanity).toEqual([r.cells[0], r.cells[3]]);
    expect(new Set(Object.keys(withdrawn.load())), "only the fresh failure is added").toEqual(new Set([ids[2], ids[3]]));
  });

  test("every proofreader flag has a reason in the ledgers set", () => {
    expect(new Set(Object.keys(regate.SANITY_REASONS))).toEqual(new Set(Object.keys(sanity.RULES)));
    for (const reason of Object.values(regate.SANITY_REASONS)) {
      expect(withdrawn.REASONS).toContain(reason);
    }
  });

  test("the withdrawn ledger only grows", () => {
    const p = path.join(tmpPath(), "w.txt");
    writeFileSync(p, "# a header\nabc123  unnatural     Nobody says this, for the test.", "utf8");
    const W = (item_id: string, reason: string, note: string) => new withdrawn.Withdrawal({ item_id, reason, note });
    for (const bad of [W("abc123", "unclear", "Already withdrawn, so refused."),
                       W("def456", "boring", "Not a reason in the closed set."),
                       W("def456", "unclear", "Two\nlines are not one line."),
                       W("def456", "unclear", "  ")]) {
      expect(() => withdrawn.append([bad], { path: p })).toThrow(ValueError);
    }
    expect(withdrawn.append([W("def456", "wrong_answer", "The key cannot be right.")],
                            { heading: "proposed by a test", path: p })).toBe(1);
    const text = readFileSync(p, "utf8");
    expect(text.startsWith("# a header\nabc123  unnatural     Nobody says this, for the test.\n")).toBe(true);
    expect(text.endsWith("\n# proposed by a test\ndef456  wrong_answer  The key cannot be right.\n")).toBe(true);
    expect(new Set(Object.keys(withdrawn.load({ path: p })))).toEqual(new Set(["abc123", "def456"]));
  });
});
