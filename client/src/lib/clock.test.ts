/**
 * The reading clock's rules — above all that a clock belongs to one question.
 */
import { describe, expect, it } from "vitest";

import { clockFace, clockFor, newClock, pause, resume, tick } from "./clock";

describe("one clock per question", () => {
  it("starts a new runKey at the new budget, even while the old one is running", () => {
    let a = resume(newClock("A", 60_000), 0);
    a = tick(a, 50_000).clock; // ten seconds left on A
    const b = resume(clockFor(a, "B", 90_000), 50_000);
    expect(b.runKey).toBe("B");
    expect(b.deadline).toBe(50_000 + 90_000);
    expect(tick(b, 51_000).clock.remainingMs).toBe(89_000);
  });

  it("does not let a timeout on A expire B", () => {
    let a = resume(newClock("A", 30_000), 0);
    const out = tick(a, 30_000);
    expect(out.expired).toBe(true);
    a = pause(out.clock, 30_000);
    expect(a.remainingMs).toBe(0);

    const b = resume(clockFor(a, "B", 45_000), 30_100);
    const first = tick(b, 30_350);
    expect(first.expired).toBe(false);
    expect(first.clock.remainingMs).toBe(44_750);
    expect(first.clock.fired).toBe(false);
  });

  it("starts again when only the budget changes", () => {
    const a = pause(tick(resume(newClock("A", 60_000), 0), 20_000).clock, 20_000);
    expect(clockFor(a, "A", 60_000)).toBe(a);
    expect(clockFor(a, "A", 90_000).remainingMs).toBe(90_000);
  });
});

describe("holding and running", () => {
  it("does not spend time while held", () => {
    let c = resume(newClock("A", 60_000), 0);
    c = pause(c, 10_000);
    expect(c.remainingMs).toBe(50_000);
    c = resume(c, 100_000);
    expect(tick(c, 110_000).clock.remainingMs).toBe(40_000);
  });

  it("says it ran out exactly once", () => {
    const c = resume(newClock("A", 1_000), 0);
    const first = tick(c, 1_200);
    const second = tick(first.clock, 1_450);
    expect([first.expired, second.expired]).toEqual([true, false]);
    expect(second.clock.remainingMs).toBe(0);
  });

  it("reads nothing while held", () => {
    const c = newClock("A", 1_000);
    expect(tick(c, 999_999)).toEqual({ clock: c, expired: false });
  });
});

describe("the face", () => {
  it("rounds up, so the first second still reads the whole budget", () => {
    expect(clockFace(60_000)).toBe("1:00");
    expect(clockFace(59_001)).toBe("1:00");
    expect(clockFace(59_000)).toBe("0:59");
    expect(clockFace(-5)).toBe("0:00");
  });
});
