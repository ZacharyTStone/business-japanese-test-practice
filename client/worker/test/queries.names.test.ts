/**
 * Every query the app asks for by name is one the Worker serves.
 *
 * The app reaches the database only by naming an entry of `queries`
 * (src/lib/api.ts `call`), and a name the Worker does not have is a 404
 * `unknown_query` that only shows on the screen that asks it. So each
 * `call("…")` in the app is read here and looked up; a call whose name is
 * not written out as a string fails too, since it could not be checked.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { queries } from "../queries";

const CLIENT = path.resolve(import.meta.dirname, "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "test" ? [] : sources(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** `call(`, with or without a type argument — not `x.call(` or `useCallback(`. */
const ANY_CALL = /(?<![.\w])call\s*(?:<[^()]*?>)?\s*\(/g;
/** The same, naming its query with a string literal. */
const NAMED_CALL = /(?<![.\w])call\s*(?:<[^()]*?>)?\s*\(\s*"([A-Za-z]+)"/g;

describe("the queries the app names", () => {
  const files = [...sources(path.join(CLIENT, "src")), ...sources(path.join(CLIENT, "app"))].filter(
    (f) => f !== path.join(CLIENT, "src", "lib", "api.ts")
  );
  const named = files.flatMap((f) => {
    const text = readFileSync(f, "utf8");
    const names = [...text.matchAll(NAMED_CALL)].map((m) => m[1]);
    const all = [...text.matchAll(ANY_CALL)].length;
    return [{ file: path.relative(CLIENT, f), names, unnamed: all - names.length }];
  });

  it("finds the app's calls", () => {
    expect(named.flatMap((f) => f.names).length).toBeGreaterThan(10);
  });

  it("names every query with a string the test can read", () => {
    expect(named.filter((f) => f.unnamed > 0).map((f) => f.file)).toEqual([]);
  });

  it("names only queries the Worker serves", () => {
    const missing = named.flatMap((f) => f.names.filter((n) => !Object.hasOwn(queries, n)).map((n) => `${f.file}: ${n}`));
    expect(missing).toEqual([]);
  });
});
