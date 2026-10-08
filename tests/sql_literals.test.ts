/**
 * Every value that reaches the SQL goes in as data, never as SQL.
 *
 * `publish.lit` quotes a value; `publish.comment` makes one safe inside a `--`
 * line. Without the second, a newline in a bundle's model name, a product
 * name or an address typed into a form ended the comment and started a line of
 * SQL the deploy would run.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as cli from "../bjt/cli/index.ts";
import * as config from "../bjt/config.ts";
import * as publish from "../bjt/publish.ts";
import { range, repr, slice, sorted, splitlines, ValueError } from "../bjt/py.ts";
import { Random } from "../bjt/pyrandom.ts";
import { capture } from "./helpers.ts";

/** The alphabet the random strings are drawn from: everything that has ever
 *  broken hand-quoted SQL, and the Japanese the content is written in. */
const _HARD = ["'", "''", "\\", "\\'", "$$", "$tag$", "\n", "\r\n", "--", "/*", "*/", ";",
               "\"", "`", "\t", " ", "　", "「", "」", "敬語", "ご確認ください。",
               String.fromCodePoint(0x1F600), String.fromCodePoint(0x1F9E7), "é", "E'x'", "%s", "{}", "a", " "];

/** Read a standard-conforming SQL string literal back, or fail. */
function _unquote(literal: string): string {
  expect(/^'(?:[^']|'')*'$/s.test(literal), literal).toBe(true);
  return literal.slice(1, -1).replaceAll("''", "'");
}

function* _strings(seed: number, n: number = 300): Generator<string> {
  const rng = new Random(seed);
  for (let i = 0; i < n; i++) {
    const k = rng.randint(0, 12);
    let s = "";
    for (let j = 0; j < k; j++) {
      s += rng.choice(_HARD);
    }
    yield s;
  }
}

describe("literals", () => {
  test.each(range(5))("any string comes back as itself [%s]", (seed) => {
    for (const s of _strings(seed)) {
      expect(_unquote(publish.lit(s))).toBe(s);
    }
  });

  test.each(range(3))("any json comes back as itself [%s]", (seed) => {
    for (const s of _strings(seed, 100)) {
      const value = { "text": s, "list": [s, 1, 2.5, null, true], [s]: [s] };
      // JSON text, which the schema checks with json_valid().
      expect(JSON.parse(_unquote(publish.lit(value)))).toEqual(value);
    }
  });

  test("null, booleans and numbers become sql literals", () => {
    expect(publish.lit(null)).toBe("null");
    // A SQLite boolean is an integer, and the schema checks it is 0 or 1.
    expect(publish.lit(true) === "1" && publish.lit(false) === "0").toBe(true);
    expect(publish.lit(3) === "3" && publish.lit(-2) === "-2").toBe(true);
    expect(publish.lit(0.75)).toBe("0.75");
    expect(Number(publish.lit(2 / 3))).toBeCloseTo(2 / 3, 6);
  });

  test.each([NaN, Infinity, -Infinity])("a number that is not one is refused [%s]", (bad) => {
    expect(() => publish.lit(bad)).toThrow(ValueError);
    expect(() => publish.lit({ "model_p_correct": bad })).toThrow(ValueError);
  });

  test("a nul is refused rather than cut off", () => {
    expect(() => publish.lit("before\x00after")).toThrow(ValueError);
  });

  test.each(range(3))("a comment is always one line [%s]", (seed) => {
    for (const s of _strings(seed)) {
      const text = "-- " + publish.comment(s);
      expect(splitlines(text).length, repr(s)).toBe(1);
    }
  });
});

/** The lines SQL would run: string literals (data) blanked out, and the
 *  comment lines themselves left in, since those are what is tested. */
function _codeLines(sql: string): string[] {
  return splitlines(sql.replace(/'(?:[^']|'')*'/gs, "''"));
}

describe("what reaches the SQL", () => {
  test("a bundle cannot smuggle a statement through its header", () => {
    const bundle = { "item_type": "goi_bunpou", "level": "J2", "items": [],
                     "generated_at": "2026-09-30\ndelete from items; --",
                     "generator_model": "claude\r\ndrop table attempts;" };
    const sql = publish.bundleSql(bundle, "goi_bunpou_J2_999", { withdrawnIds: new Set() });
    for (const line of _codeLines(sql)) {
      const code = line.trimStart();
      expect(["delete from items;", "drop table"].some((p) => code.startsWith(p)), line).toBe(false);
    }
    expect(sql).toContain("-- generated 2026-09-30 delete from items, -- by claude drop table");
  });

  test("the grant refuses what is not a user id", async () => {
    capture();
    expect(await cli.main({ argv: ["grant", "00000000-0000-0000-0000-000000000000\n; drop table x"] })).toBe(2);
    expect(await cli.main({ argv: ["grant", "not-a-uuid"] })).toBe(2);
    expect(await cli.main({ argv: ["grant", "3f2b8c1e-9d4a-4e6b-8a7f-1c2d3e4f5a6b"] })).toBe(0);
  });

  test("the grants product stays in its comment", async () => {
    const cap = capture();
    expect(await cli.main({ argv: ["grant", "3f2b8c1e-9d4a-4e6b-8a7f-1c2d3e4f5a6b",
                                   "--product", "ads_free\ndelete from entitlements;"] })).toBe(0);
    const out = cap.readouterr().out;
    expect(_codeLines(out).some((line) => line.startsWith("delete"))).toBe(false);
  });

  test.each([
    "not-an-email", "a@b", "a@@b.co", "@b.co", "a@.co", "a b@c.co", "a@b.co\n; drop",
    "a@b.co x", "a\x00@b.co",
  ])("the tester list refuses what is not an address [%j]", async (address) => {
    capture();
    expect(await cli.main({ argv: ["tester", address] })).toBe(2);
  });

  test.each(["owner@example.com", "o'brien@example.co.jp",
             "first.last+app@mail.example.org"])("the tester list takes a real address [%s]", async (address) => {
    const cap = capture();
    expect(await cli.main({ argv: ["tester", address] })).toBe(0);
    const out = cap.readouterr().out;
    expect(out).toContain(publish.lit(address));
  });
});

// ----- what a statement splitter sees -------------------------------------------

/** A splitter that does not know about `--` comments reads a quote in one as
 *  the start of a string, and a semicolon as the end of a statement. D1 splits
 *  a migration on its own side, and a "learner's" in a comment swallowed the
 *  rest of one (the first remote deploy, 2026-10-01: "incomplete input"). */
const _SPLITTER_CHARS = ["'", ";", "`", '"'];

function _commentLines(sql: string): string[] {
  return splitlines(sql).filter((line) => line.trimStart().startsWith("--"));
}

/** `root.glob("d1/**\/*.sql")`: every .sql file under d1/, at any depth. */
function _d1Sql(): string[] {
  const d1 = path.join(config.ROOT, "d1");
  return readdirSync(d1, { recursive: true, encoding: "utf8" })
    .filter((rel) => rel.endsWith(".sql"))
    .map((rel) => path.join(d1, rel));
}

function _shippedSql(): string[] {
  const batches = path.join(config.ROOT, "batches");
  return sorted([..._d1Sql(),
                 ...readdirSync(batches).filter((n) => n.endsWith(".sql")).map((n) => path.join(batches, n))]);
}

describe("what a statement splitter sees", () => {
  test("no sql this project ships has a quote or a semicolon in a comment", () => {
    const files = _shippedSql();
    expect(files.length).toBeGreaterThan(0);
    for (const p of files) {
      for (const line of _commentLines(readFileSync(p, "utf8"))) {
        expect(_SPLITTER_CHARS.some((ch) => line.includes(ch)), `${path.basename(p)}: ${line}`).toBe(false);
      }
    }
  });

  /** CASE ... END inside BEGIN ... END is what a splitter counting ENDs
   *  closes the trigger on. Plain boolean logic says the same thing. */
  test("a trigger body has no case expression", () => {
    for (const p of sorted(_d1Sql())) {
      for (const body of readFileSync(p, "utf8").match(/create trigger.*?\nend;/gis) ?? []) {
        const code = splitlines(body).map((line) => line.split("--")[0]).join("\n");
        // Python's \b is Unicode-aware: a letter of any script is a word character.
        expect(/(?<![\p{L}\p{N}_])case(?![\p{L}\p{N}_])/iu.test(code), `${path.basename(p)}: ${slice(body, 0, 80)}`).toBe(false);
      }
    }
  });

  test.each([
    [["tester", "o'brien@example.com", "--note", "it's me; really", "--max-goal", "60", "--veto"]],
    [["tester", "o'brien@example.com", "--remove"]],
    [["grant", "3f2b8c1e-9d4a-4e6b-8a7f-1c2d3e4f5a6b", "--product", "ads'free;x"]],
    [["grant", "3f2b8c1e-9d4a-4e6b-8a7f-1c2d3e4f5a6b", "--revoke"]],
  ])("the one off sql the commands print has clean comments %j", async (argv) => {
    const cap = capture();
    expect(await cli.main({ argv })).toBe(0);
    for (const line of _commentLines(cap.readouterr().out)) {
      expect(_SPLITTER_CHARS.some((ch) => line.includes(ch)), line).toBe(false);
    }
  });

  test("a comment value loses what a splitter would read", () => {
    expect(publish.comment("borrows desk's; `x` \"y\"")).toBe("borrows desk’s, x y");
  });
});
