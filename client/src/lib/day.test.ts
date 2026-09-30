/**
 * The day's three states and the size of the next set.
 */
import { describe, expect, it } from "vitest";

import { dayState, setSize } from "./day";
import type { DayStatus } from "./types";

const day = (d: Partial<DayStatus>): DayStatus => ({
  goal: 10,
  answered_today: 0,
  unlimited: false,
  max_today: 15,
  left_today: 15,
  goal_max: null,
  ...d,
});

describe("the day", () => {
  it("is open until the set is done, and asks for what is left of it", () => {
    const d = day({ answered_today: 3, left_today: 12 });
    expect(dayState(d)).toBe("open");
    expect(setSize(d)).toBe(7);
  });

  it("offers the rest of the allowance once the goal is reached", () => {
    const d = day({ answered_today: 10, left_today: 5 });
    expect(dayState(d)).toBe("bonus");
    expect(setSize(d)).toBe(5);
  });

  it("is done at the ceiling, with nothing to ask for", () => {
    const d = day({ answered_today: 15, left_today: 0 });
    expect(dayState(d)).toBe("done");
    expect(setSize(d)).toBe(0);
  });

  it("never asks past the ceiling, even with the set unfinished", () => {
    // A goal written above a ceiling that was later lowered: the trigger
    // judges a goal being written, never an existing one.
    const d = day({ goal: 15, answered_today: 12, max_today: 13, left_today: 1 });
    expect(dayState(d)).toBe("open");
    expect(setSize(d)).toBe(1);
  });

  it("gives an account with the ceiling lifted a full set after the goal, and is never done", () => {
    const d = day({ answered_today: 40, unlimited: true, max_today: null, left_today: null });
    expect(dayState(d)).toBe("bonus");
    expect(setSize(d)).toBe(10);
    expect(setSize(day({ answered_today: 4, unlimited: true, max_today: null, left_today: null }))).toBe(6);
  });

  it("reads a missing left_today on an ordinary account as nothing left", () => {
    const d = day({ answered_today: 2, left_today: null });
    expect(dayState(d)).toBe("done");
    expect(setSize(d)).toBe(0);
  });
});
