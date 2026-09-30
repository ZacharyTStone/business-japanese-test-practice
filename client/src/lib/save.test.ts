/**
 * A setting's save: one write at a time, the last press is the one written,
 * and a failure puts the screen back to what the database holds.
 */
import { describe, expect, it } from "vitest";

import { settingSaver } from "./save";

/** A saver whose writes wait until the test settles them. */
function harness<T>(confirmed: T) {
  const writes: { value: T; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const shown: T[] = [];
  const saved: T[] = [];
  const failures: unknown[] = [];
  const saver = settingSaver<T>({
    write: (value) =>
      new Promise<void>((resolve, reject) => {
        writes.push({ value, resolve, reject });
      }),
    show: (value) => shown.push(value),
    saved: (value) => saved.push(value),
    failed: (error) => failures.push(error),
  });
  saver.confirm(confirmed);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { saver, writes, shown, saved, failures, flush };
}

describe("a setting's save", () => {
  it("shows a press at once and writes it", async () => {
    const h = harness(false);
    h.saver.set(true);
    expect(h.shown).toEqual([true]);
    expect(h.writes.map((w) => w.value)).toEqual([true]);
    expect(h.saver.busy()).toBe(true);
    h.writes[0].resolve();
    await h.flush();
    expect(h.saved).toEqual([true]);
    expect(h.saver.busy()).toBe(false);
  });

  it("never has two writes out, and writes only the last press held behind one", async () => {
    const h = harness("a");
    h.saver.set("b");
    h.saver.set("c");
    h.saver.set("d");
    expect(h.writes.map((w) => w.value)).toEqual(["b"]);
    expect(h.shown).toEqual(["b", "c", "d"]);
    h.writes[0].resolve();
    await h.flush();
    expect(h.writes.map((w) => w.value)).toEqual(["b", "d"]);
    h.writes[1].resolve();
    await h.flush();
    expect(h.saved).toEqual(["b", "d"]);
  });

  it("does not write a press that lands back on the value just saved", async () => {
    const h = harness(false);
    h.saver.set(true);
    h.saver.set(false);
    h.saver.set(true);
    h.writes[0].resolve();
    await h.flush();
    expect(h.writes).toHaveLength(1);
  });

  it("does not write the value the database already holds", () => {
    const h = harness(3);
    h.saver.set(3);
    expect(h.writes).toHaveLength(0);
  });

  it("puts the screen back to the confirmed value when a write fails, and drops what was held", async () => {
    const h = harness<string | null>("2026-12-01");
    h.saver.set("2027-01-10");
    h.saver.set(null);
    const boom = new Error("offline");
    h.writes[0].reject(boom);
    await h.flush();
    expect(h.shown.at(-1)).toBe("2026-12-01");
    expect(h.failures).toEqual([boom]);
    expect(h.writes).toHaveLength(1);
    expect(h.saver.busy()).toBe(false);
  });

  it("rolls back to the last value that was saved, not the one first read", async () => {
    const h = harness(10);
    h.saver.set(12);
    h.writes[0].resolve();
    await h.flush();
    h.saver.set(14);
    h.writes[1].reject(new Error("refused"));
    await h.flush();
    expect(h.shown.at(-1)).toBe(12);
  });
});
