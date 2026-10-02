/**
 * `bjt calibrate`: a skip is not a wrong answer, and the bank's side is the app.
 *
 * Dividing the official score by every item, skipped ones included, or taking
 * the bank's score from whatever `bjt practice` wrote to the local database would
 * both flatter the bank. These tests sit a fixture paper with a skip in it, read
 * a fixture export of the app's first attempts, and hold the two numbers apart.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as calibration from "../bjt/calibration.ts";
import * as cli from "../bjt/cli/index.ts";
import * as research from "../bjt/cli/research.ts";
import { Store } from "../bjt/db/index.ts";
import * as fixtures from "../bjt/fixtures.ts";
import { ValueError } from "../bjt/py.ts";
import { dumps } from "../bjt/pyjson.ts";
import * as schemas from "../bjt/schemas.ts";
import { seedsDir } from "./conftest.ts";
import { capture, patch, setConfig, tmpPath } from "./helpers.ts";

/** Four answerable items and one the terminal cannot show (five options). The
 *  keys are A, B, C, D in turn. */
const OFFICIAL = [
  ...[0, 1, 2, 3].map((n) => ({
    "stem": `公式サンプル問題${n}：＿＿＿に入る最も適切なものはどれですか。`,
    "options": ["ござい", "おり", "いたし", "まいり"], "answer": n, "level": "J2",
    "explanation_ja": "解説。",
  })),
  {
    "stem": "選択肢が五つある問題。", "options": ["一", "二", "三", "四", "五"],
    "answer": 0, "level": "J2", "explanation_ja": "解説。",
  },
];

/** Right, skipped, wrong, right — and the fifth is never asked. */
const ANSWERS = ["A", "s", "A", "D"];

/** The byte-order mark a download can carry. */
const BOM = String.fromCharCode(0xfeff);

const CSV = (
  BOM + "item_type,is_correct,chosen_index\n"
  + "goi_bunpou,true,0\n"
  + "goi_bunpou,t,2\n"
  + "goi_bunpou,FALSE,1\n"
  + "goi_bunpou,false,-1\n"                         // the clock ran out: not an answer
  + "hyougen,true,3\n"                              // another type: not this calibration
);

/** `paper`: the official paper in a seeds/ of its own, a database of its own,
 *  and a terminal that answers ANSWERS in turn. Returns the test's directory. */
function paper(): string {
  const tmp = tmpPath();
  const seeds = seedsDir(tmp);
  mkdirSync(path.join(seeds, "official"));
  writeFileSync(path.join(seeds, "official", "goi_bunpou.json"),
                dumps(OFFICIAL, { ensureAscii: false }), "utf8");
  setConfig({ DB_PATH: path.join(tmp, "calibrate.db") });
  const answers = ANSWERS[Symbol.iterator]();
  patch(research.seams, "input", async (prompt: string = "") => {
    const next = answers.next();
    if (next.done) {
      throw new Error("StopIteration");
    }
    return next.value;
  });
  return tmp;
}

function _runs(tmp: string): Record<string, any>[] {
  const store = new Store({ path: path.join(tmp, "calibrate.db") });
  try {
    return store.conn.prepare("SELECT * FROM calibration_runs").all().map((r) => ({ ...r }));
  } finally {
    store.close();
  }
}

describe("calibrate", () => {
  test("a skip is not a wrong answer", async () => {
    const tmp = paper();
    const cap = capture();
    const csvPath = path.join(tmp, "attempts.csv");
    writeFileSync(csvPath, CSV, "utf8");
    expect(await cli.main({ argv: ["calibrate", "--type", "goi_bunpou", "--attempts-csv", csvPath] })).toBe(0);
    const out = cap.readouterr().out;

    // Two right of the three answered — not two of five.
    expect(out).toContain("official items:  2 right of 3 answered (67%); answered 3 of 5");
    expect(out).toContain("2 left unanswered, which is not the same as wrong");
    const runs = _runs(tmp);
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run["official_accuracy"]).toBeCloseTo(2 / 3, 6);
    expect(run["n_official"]).toBe(3);
  });

  test("the banks side is the apps first attempts", async () => {
    const tmp = paper();
    const cap = capture();
    const csvPath = path.join(tmp, "attempts.csv");
    writeFileSync(csvPath, CSV, "utf8");
    expect(await cli.main({ argv: ["calibrate", "--type", "goi_bunpou", "--attempts-csv", csvPath] })).toBe(0);
    const out = cap.readouterr().out;

    expect(out).toContain("generated items: 2 right of 3 answered (67%)");
    expect(out).toContain("your first attempts in the app (attempts.csv)");
    expect(out).toContain("1 timed out, not counted as answers");
    expect(out).toContain("comparable");
    const runs = _runs(tmp);
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run["generated_accuracy"]).toBeCloseTo(2 / 3, 6);
    expect(run["n_generated"]).toBe(3);
  });

  test("without a file the local database is read", async () => {
    const tmp = paper();
    const cap = capture();
    const store = new Store({ path: path.join(tmp, "calibrate.db") });
    try {
      const item = fixtures.FIXTURES["goi_bunpou"];
      const iid = store.insertItem("goi_bunpou", "J2", item, "fixture");
      const ci = schemas.correctIndex(item["options"]);
      for (const chosen of [ci, ci, ci, (ci + 1) % 4]) {
        store.recordResponse(iid, chosen, chosen === ci);
      }
    } finally {
      store.close();
    }

    expect(await cli.main({ argv: ["calibrate", "--type", "goi_bunpou"] })).toBe(0);
    const out = cap.readouterr().out;
    expect(out).toContain("generated items: 3 right of 4 answered (75%)");
    expect(out).toContain("what `bjt practice` recorded here");
  });

  test("a bad export is refused before the sitting", async () => {
    const tmp = paper();
    const cap = capture();
    patch(research.seams, "input", async (prompt: string = "") => {
      throw new Error("AssertionError: the file is read before anybody answers anything");
    });

    const csvPath = path.join(tmp, "attempts.csv");
    writeFileSync(csvPath, "item_type,chosen_index\ngoi_bunpou,0\n", "utf8");
    expect(await cli.main({ argv: ["calibrate", "--type", "goi_bunpou", "--attempts-csv", csvPath] })).toBe(2);
    expect(cap.readouterr().err).toContain("no is_correct column");
  });

  /** A skipped row is a number that looks measured and is not. */
  test("an unreadable row is an error not a skip", () => {
    const csvPath = path.join(tmpPath(), "a.csv");
    writeFileSync(csvPath, "item_type,is_correct\ngoi_bunpou,true\ngoi_bunpou,maybe\n", "utf8");
    expect(() => calibration.readAttemptsCsv(csvPath, "goi_bunpou")).toThrow(ValueError);
    expect(() => calibration.readAttemptsCsv(csvPath, "goi_bunpou")).toThrow(/a\.csv:3/);
  });

  test("without chosen index every row is an answer", () => {
    const csvPath = path.join(tmpPath(), "a.csv");
    writeFileSync(csvPath, "is_correct,item_type,user\n1,goi_bunpou,x\n0,goi_bunpou,x\n", "utf8");
    const tally = calibration.readAttemptsCsv(csvPath, "goi_bunpou");
    expect([tally.right, tally.answered, tally.total]).toEqual([1, 2, 2]);
  });

  test("the export sql is in the help and only reads", async () => {
    const cap = capture();
    // argparse's SystemExit(0) after the help; `main` returns that status
    // (bjt/cli/index.ts) where Python's let the exception out.
    expect(await cli.main({ argv: ["calibrate", "--help"] })).toBe(0);
    const out = cap.readouterr().out;
    expect(out.includes("from attempts att") && out.includes("you@example.com")).toBe(true);

    const sql = calibration.ATTEMPTS_EXPORT_SQL.toLowerCase();
    expect(sql.trimStart().startsWith("select") && sql.split(";").length - 1 === 1).toBe(true);
    for (const verb of ["insert", "update", "delete", "truncate", "drop", "alter", "grant"]) {
      expect(sql, `the export must only read, and it says ${verb}`).not.toContain(verb);
    }
    // First attempts, one account, the live bank.
    expect(sql.includes("partition by att.item_id") && sql.includes("order by att.answered_at, att.id")
           && sql.includes("nth = 1")).toBe(true);
    expect(sql.includes("u.email") && sql.includes("is_published")).toBe(true);
  });
});
