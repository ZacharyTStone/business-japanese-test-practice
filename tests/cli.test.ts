/**
 * CLI orchestration: official-item normalization, generate+gate+store wiring,
 * and the argparse guard.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import * as cli from "../bjt/cli/index.ts";
import * as config from "../bjt/config.ts";
import { Store } from "../bjt/db/index.ts";
import * as difficulty from "../bjt/fidelity/difficulty.ts";
import * as roles from "../bjt/fidelity/roles.ts";
import * as fixtures from "../bjt/fixtures.ts";
import * as llm from "../bjt/llm.ts";
import * as pipeline from "../bjt/pipeline.ts";
import { deepcopy } from "../bjt/py.ts";
import { BUNDLE_FLOAT_KEYS, dumps } from "../bjt/pyjson.ts";
import * as schemas from "../bjt/schemas.ts";
import { goiItem, store } from "./conftest.ts";
import { capture, patch, setConfig, tmpPath } from "./helpers.ts";

function _valid(t: string): Record<string, any> {
  return deepcopy(fixtures.FIXTURES[t]);
}

/** Python's `str.count`: how many times `sub` occurs, not overlapping. */
function _count(text: string, sub: string): number {
  return text.split(sub).length - 1;
}

/** `text.index(sub)`: where it is, and a failure (Python's ValueError) when
 *  it is not there at all. */
function _index(text: string, sub: string, start: number = 0): number {
  const i = text.indexOf(sub, start);
  expect(i, `${JSON.stringify(sub)} is in the text`).toBeGreaterThanOrEqual(0);
  return i;
}

describe("cli", () => {
  test("normalize light shape", () => {
    const raw = [{ "stem": "x", "options": ["a", "b", "c", "d"], "answer": 2, "explanation_ja": "e" }];
    const norm = cli._normalizeOfficial(raw, "goi_bunpou");
    expect(schemas.correctIndex(norm[0]["options"])).toBe(2);
    expect(norm[0]["item_type"]).toBe("goi_bunpou");
  });

  test("normalize full shape passthrough", () => {
    const item = goiItem();
    const norm = cli._normalizeOfficial([item], "goi_bunpou");
    expect(schemas.correctIndex(norm[0]["options"])).toBe(schemas.correctIndex(item["options"]));
  });

  test("generate and gate kept", async () => {
    const s = store();
    patch(llm, "generateStructured", async () => _valid("goi_bunpou"));
    // A clean proofread, so the item goes on to the gate this test is about.
    patch(llm, "sanityCheck", async (rendered: string, rules: Record<string, string>) =>
      ({ ...Object.fromEntries(Object.keys(rules).map((r) => [r, false])), "notes": "" }));

    // The gated item is shuffled, so locate the correct option by its text.
    const correctText = (_valid("goi_bunpou")["options"] as Record<string, any>[])
      .find((o) => o["role"] === roles.CORRECT)!["text"];

    const fakeAnswer = async (question: string, options: string[]) => {
      const ci = options.indexOf(correctText);
      expect(ci).toBeGreaterThanOrEqual(0);
      // full: correct; cold (stem withheld): wrong
      return { "choice": !question.includes("withheld") ? ci : (ci + 1) % 4, "reason": "x" };
    };

    patch(llm, "answerChoice", fakeAnswer);

    const [, iid, kept] = await pipeline.generateAndGate(s, "goi_bunpou", "J2", { gate: true });
    expect(kept).toBe(true);
    const stored = s.getItem(iid)!;
    expect(stored["gate_verdict"]).toBe("kept");
    expect(stored["full_success_rate"]).toBe(1.0);
    expect(stored["cold_success_rate"]).toBe(0.0);
  });

  test("generate and gate skipped", async () => {
    const s = store();
    patch(llm, "generateStructured", async () => _valid("hyougen"));
    // Nothing but the generator: no proofreader and no probe to fake.
    setConfig({ SANITY_ENABLED: false, DIFFICULTY_ENABLED: false });
    const [, iid, kept] = await pipeline.generateAndGate(s, "hyougen", "J2", { gate: false });
    expect(kept).toBe(true);
    expect(s.getItem(iid)!["gate_verdict"]).toBe("skipped");
  });

  /** argparse's error is a SystemExit(2); `main` returns its status. */
  test("practice requires type without demo", async () => {
    const cap = capture();
    expect(await cli.main({ argv: ["practice", "-n", "1"] })).toBe(2);
    expect(cap.readouterr().err).toContain("practice requires --type unless --demo is used");
  });

  test("selftest passes", async () => {
    capture();
    expect(await cli.main({ argv: ["selftest"] })).toBe(0);
  });

  // ----- the tester list -----------------------------------------------------

  test("tester sql is lowercased and idempotent", async () => {
    const cap = capture();
    expect(await cli.main({ argv: ["tester", " Zach@Example.com ", "--note", "owner"] })).toBe(0);
    const out = cap.readouterr().out;
    expect(out).toContain("insert into testers");
    expect(out.includes("'zach@example.com'") && !out.split("--").at(-1)!.includes("Zach")).toBe(true);
    expect(out).toContain("on conflict (email) do update");
  });

  test("tester unlimited lifts the ceiling and is off by default", async () => {
    const cap = capture();
    expect(await cli.main({ argv: ["tester", "z@example.com"] })).toBe(0);
    let out = cap.readouterr().out;
    expect(out).toContain("insert into testers (email, note, unlimited, may_veto, max_daily_goal)");
    expect(out).toContain("'z@example.com', '', 0");
    expect(out, "an unnamed flag is left alone").not.toContain("unlimited = excluded.unlimited");

    expect(await cli.main({ argv: ["tester", "z@example.com", "--unlimited"] })).toBe(0);
    out = cap.readouterr().out;
    expect(out).toContain("'z@example.com', '', 1, 0");
    expect(out).toContain("no daily ceiling");
  });

  /** The veto flag unpublishes for everybody on one press, so the SQL that
   *  grants it says so out loud — it is the owner's row, not a tester's. */
  test("tester veto is off by default and says what it does", async () => {
    const cap = capture();
    expect(await cli.main({ argv: ["tester", "z@example.com"] })).toBe(0);
    expect(cap.readouterr().out).toContain("'z@example.com', '', 0, 0");

    expect(await cli.main({ argv: ["tester", "z@example.com", "--veto"] })).toBe(0);
    let out = cap.readouterr().out;
    expect(out).toContain("'z@example.com', '', 0, 1");
    expect(out).toContain("for EVERYBODY on one press");
    expect(out).toContain("may_veto = excluded.may_veto");

    expect(await cli.main({ argv: ["tester", "z@example.com", "--unlimited", "--veto"] })).toBe(0);
    out = cap.readouterr().out;
    expect(out).toContain("'z@example.com', '', 1, 1");
    expect(out).toContain("no daily ceiling and the veto button");
  });

  /** One row may carry a number: the largest set that account may choose in
   *  the app, and where its day stops. Null everywhere else, which is the
   *  ten-a-day, fifteen-at-most everybody gets. */
  test("tester max goal sizes one accounts day", async () => {
    const cap = capture();
    expect(await cli.main({ argv: ["tester", "z@example.com"] })).toBe(0);
    let out = cap.readouterr().out;
    expect(out).toContain("insert into testers (email, note, unlimited, may_veto, max_daily_goal)");
    expect(out).toContain("'z@example.com', '', 0, 0, null)");

    expect(await cli.main({ argv: ["tester", "z@example.com", "--max-goal", "40"] })).toBe(0);
    out = cap.readouterr().out;
    expect(out).toContain("'z@example.com', '', 0, 0, 40)");
    expect(out).toContain("a day of up to 40 questions");
    expect(out).toContain("max_daily_goal = excluded.max_daily_goal");

    // However many: there is no product ceiling here, because what limits a set
    // is how many items the bank has in the learner's window rather than this.
    expect(await cli.main({ argv: ["tester", "z@example.com", "--max-goal", "500"] })).toBe(0);
    expect(cap.readouterr().out).toContain("'z@example.com', '', 0, 0, 500)");

    // The only bound is the smallint the column is declared as, so the CLI
    // refuses only SQL the database itself would reject.
    expect(await cli.main({ argv: ["tester", "z@example.com", "--max-goal", "32767"] })).toBe(0);
    expect(await cli.main({ argv: ["tester", "z@example.com", "--max-goal", "32768"] })).toBe(2);
    expect(await cli.main({ argv: ["tester", "z@example.com", "--max-goal", "0"] })).toBe(2);
  });

  /** Actions logs are public in this repository, and a step's `env:` block
   *  is printed at the top of its log. The address and note are read from the
   *  event payload inside the script and masked before anything can echo them.
   *
   *  The workflow runs the Node command line now: `bjt/main.ts tester` where
   *  the Python test looked for `bjt tester`, and the lower-cased form is
   *  masked with `trim().toLowerCase()` where it was `strip().lower()`. */
  test("the deploy workflow never prints a testers address", () => {
    const text = readFileSync(path.join(config.ROOT, ".github/workflows/deploy-db.yml"), "utf8");
    const start = _index(text, "- name: let a tester in");
    const step = text.slice(start, _index(text, "- name:", start + 1));
    expect(step).not.toContain("env:");
    const run = step.slice(_index(step, "run: |"));
    expect(run, "an expression is expanded into the logged script").not.toContain("${{");
    expect(_index(run, "::add-mask::$EMAIL")).toBeLessThan(_index(run, "bjt/main.ts tester"));
    expect(_index(run, "bjt/main.ts tester")).toBeLessThan(_index(run, "d1 execute"));
    expect(run, "the form bjt tester writes into the SQL is masked too").toContain("trim().toLowerCase()");
    expect(run).toContain("::add-mask::$NOTE");
    // Named once, in the `if:` (which is not logged); read nowhere else.
    expect(_count(text, "github.event.inputs.tester_email")).toBe(1);
    expect(text).not.toContain("github.event.inputs.tester_note");
  });

  test("tester remove and bad input", async () => {
    const cap = capture();
    expect(await cli.main({ argv: ["tester", "b@example.com", "--remove"] })).toBe(0);
    expect(cap.readouterr().out).toContain("delete from testers where email = 'b@example.com'");
    expect(await cli.main({ argv: ["tester", "not-an-email"] })).toBe(2);
  });

  /** A committed bundle as it was before the probe measured it. The bank's
   *  own bundles gain `model_p_correct` as the probe runs (2026-10-02 measured
   *  this one), so a test about unmeasured items makes its own. */
  function _unmeasuredCopy(tmp: string): string {
    const bundle = JSON.parse(readFileSync(path.join(config.ROOT, "batches/sougou_dokkai_J1_001.json"), "utf8"));
    for (const item of bundle["items"]) {
      delete item["model_p_correct"];
    }
    const dst = path.join(tmp, "b.json");
    writeFileSync(dst, dumps(bundle, { ensureAscii: false, indent: 2, floatKeys: BUNDLE_FLOAT_KEYS }) + "\n", "utf8");
    return dst;
  }

  /** A catch-up pass over the committed bank. The dry run is what makes it
   *  safe to look before spending, since the real one calls a model per item. */
  test("probe dry run names the items with no prior and spends nothing", async () => {
    const tmp = tmpPath();
    const cap = capture();
    const explode = async (): Promise<difficulty.DifficultyResult> => {
      throw new Error("--dry-run must not reach the model");
    };
    patch(difficulty, "measure", explode);

    expect(await cli.main({ argv: ["probe", _unmeasuredCopy(tmp), "--dry-run"] })).toBe(0);
    const out = cap.readouterr().out;
    expect(out).toContain("without a difficulty signal");
    expect(out).toContain("would measure");
  });

  /** A fabricated prior is worse than none — the queue would trust it — so a
   *  probe that cannot run writes nothing and says so. */
  test("probe leaves the bundle alone when nothing could be measured", async () => {
    const tmp = tmpPath();
    capture();
    const dst = _unmeasuredCopy(tmp);
    const before = readFileSync(dst, "utf8");

    patch(difficulty, "measure", async () => new difficulty.DifficultyResult({ measured: false }));
    expect(await cli.main({ argv: ["probe", dst] })).toBe(1);
    expect(readFileSync(dst, "utf8")).toBe(before);
  });

  /** An empty accuracy report made `db_ok` a list, and `ok &= []` a
   *  TypeError on the one path that exists to report a failure. */
  test("a failing selftest says so rather than crashing", async () => {
    const cap = capture();
    vi.spyOn(Store.prototype, "accuracyByType").mockReturnValue([]);
    expect(await cli.main({ argv: ["selftest"] })).toBe(1);
    expect(cap.readouterr().out).toContain("Self-test FAILED");
  });
});
