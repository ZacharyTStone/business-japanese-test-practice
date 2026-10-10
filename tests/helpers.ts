/**
 * What pytest's fixtures gave the Python tests, for vitest.
 *
 *   patch(obj, key, value)   monkeypatch.setattr: a module's export (through
 *                            vitest's spy on its getter) or a plain object's
 *                            property (`seams`, `state`), put back after the
 *                            test.
 *   setConfig({...})         monkeypatch.setattr(config, ...) for several.
 *   setEnv / delEnv          monkeypatch.setenv / delenv.
 *   tmpPath()                tmp_path: a fresh directory, removed after.
 *   capture()                capsys: what the test printed, `readouterr()`.
 *
 * Every one of them is undone after each test by tests/setup.ts. Below them,
 * the small text and iterator helpers several test files share.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, vi } from "vitest";
import * as config from "../bjt/config.ts";
import * as llm from "../bjt/llm.ts";
import { sorted } from "../bjt/py.ts";

const undo: (() => void)[] = [];

/** Run by tests/setup.ts after every test: everything patched, put back,
 *  newest first. */
export function restoreAll(): void {
  while (undo.length) undo.pop()!();
}

/** `monkeypatch.setattr(obj, key, value)`. */
export function patch<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (desc && desc.get && !desc.set) {
    // A module's export: callers in other modules read it through the
    // module object, so replacing its getter is what they see.
    vi.spyOn(obj as any, key as any, "get").mockReturnValue(value);
    return;
  }
  const had = Object.prototype.hasOwnProperty.call(obj, key);
  const old = (obj as any)[key];
  (obj as any)[key] = value;
  undo.push(() => {
    if (had) (obj as any)[key] = old;
    else delete (obj as any)[key];
  });
}

/** Several settings at once: `setConfig({ RUN_BUDGET_USD: 1 })`. */
export function setConfig(values: Partial<Record<keyof typeof config, unknown>>): void {
  for (const [k, v] of Object.entries(values)) patch(config as any, k, v);
}

export function setEnv(name: string, value: string): void {
  const old = process.env[name];
  process.env[name] = value;
  undo.push(() => {
    if (old === undefined) delete process.env[name];
    else process.env[name] = old;
  });
}

export function delEnv(name: string): void {
  if (!(name in process.env)) return;
  const old = process.env[name];
  delete process.env[name];
  undo.push(() => {
    process.env[name] = old;
  });
}

/** A fresh directory for this test. */
export function tmpPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bjt-test-"));
  undo.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export type Captured = {
  /** What was printed since the last read, as pytest's capsys returns it. */
  readouterr(): { out: string; err: string };
};

/** capsys: capture stdout and stderr for the rest of the test. */
export function capture(): Captured {
  let out = "";
  let err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: any) => {
    out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as any);
  const e = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: any) => {
    err += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as any);
  undo.push(() => {
    o.mockRestore();
    e.mockRestore();
  });
  return {
    readouterr() {
      const r = { out, err };
      out = "";
      err = "";
      return r;
    },
  };
}

/** A test reached a network seam it did not replace. Not an `LLMError` on
 *  purpose: the tolerant call sites (the proofreader, the probe) turn an
 *  `LLMError` into "did not run", so a test that forgot to fake a call
 *  would pass on that path and say nothing. This one goes straight through
 *  them and fails the test. */
export class UnmockedCall extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnmockedCall";
  }
}

export function refuse(what: string): (...args: any[]) => never {
  return () => {
    throw new UnmockedCall(`${what} was called for real; fake it in the test`);
  };
}

// ------------------------------------------------------------ the seams

/** Every place the pipeline would open a connection. tests/setup.ts makes
 *  each refuse before every test; a module with a seam of its own adds it
 *  here (llm.ts adds the Anthropic client). */
type Seam = { obj: any; key: string; what: string; original: unknown };
const SEAMS: Seam[] = [];
/** State that must start fresh in every test (llm's spend ledger). */
const RESETS: (() => void)[] = [];

export function registerSeam(obj: object, key: string, what: string): void {
  SEAMS.push({ obj, key, what, original: (obj as any)[key] });
}

export function registerReset(fn: () => void): void {
  RESETS.push(fn);
}

/** Run by tests/setup.ts before every test. */
export function refuseSeams(): void {
  for (const r of RESETS) r();
  for (const s of SEAMS) patch(s.obj, s.key as never, refuse(s.what) as never);
}

/** For the test that needs the real seam functions because it fakes what
 *  is behind them instead (pytest's `unmocked_seams` mark). */
export function useRealSeams(): void {
  for (const s of SEAMS) s.obj[s.key] = s.original;
}

/** A fake Anthropic client behind `llm.seams.getClient` for the rest of the
 *  test: `create` answers (or throws for) every request the pipeline sends. */
export function fakeMessages(create: (params: Record<string, any>) => unknown): void {
  const client: llm.MessagesClient = { messages: { create } };
  patch(llm.seams, "getClient", () => client);
}

// ------------------------------------------------------------ shared helpers

/** A string as UTF-8 bytes, the shape every fake wire and bucket deals in. */
export const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

/** How many times `sub` occurs in `text`, not overlapping. */
export function countOf(text: string, sub: string): number {
  return text.split(sub).length - 1;
}

/** Where `sub` first occurs in `text` from `start`; a failed assertion when it
 *  is not there at all, so a slice between two markers never silently spans
 *  the wrong text. */
export function mustFind(text: string, sub: string, start: number = 0): number {
  const i = text.indexOf(sub, start);
  expect(i, `${JSON.stringify(sub)} is in the text`).toBeGreaterThanOrEqual(0);
  return i;
}

/** Everything after the first `sep`; a failed assertion when there is none. */
export function after(s: string, sep: string): string {
  const i = s.indexOf(sep);
  expect(i, `${JSON.stringify(sep)} not found`).toBeGreaterThanOrEqual(0);
  return s.slice(i + sep.length);
}

/** Everything before the first `sep` (all of `s` when there is none). */
export function before(s: string, sep: string): string {
  const i = s.indexOf(sep);
  return i < 0 ? s : s.slice(0, i);
}

/** The two hold the same members, whatever their order or repeats. */
export function sameSet(a: Iterable<string>, b: Iterable<string>): void {
  expect(sorted(new Set(a))).toEqual(sorted(new Set(b)));
}

/** A function handing out the next of `values` on every call, and throwing
 *  once they run out: a fake that answers a fixed script of replies. */
export function iter<T>(values: T[]): () => T {
  const it = values[Symbol.iterator]();
  return () => {
    const n = it.next();
    if (n.done) throw new Error("StopIteration");
    return n.value;
  };
}
