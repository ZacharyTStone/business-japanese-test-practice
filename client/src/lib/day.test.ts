/**
 * The day as Japan counts it — when it turns over, and when a screen about it
 * is stale — and the day's three states and the size of the next set.
 */
import { describe, expect, it } from "vitest";

import {
  dayState,
  jstDate,
  localClock,
  nextJstMidnight,
  onJapanTime,
  REFRESH_AFTER_MS,
  setSize,
  shouldRefresh,
} from "./day";
import type { DayStatus } from "./types";

const at = (iso: string) => Date.parse(iso);

describe("the Japanese day", () => {
  it("is the date on the wall in Japan, not in UTC", () => {
    // 15:30 UTC is 00:30 the next day in Tokyo.
    expect(jstDate(at("2026-09-30T15:30:00Z"))).toBe("2026-10-01");
    expect(jstDate(at("2026-09-30T14:59:59Z"))).toBe("2026-09-30");
  });

  it("turns over at 15:00 UTC", () => {
    expect(nextJstMidnight(at("2026-09-30T05:00:00Z"))).toBe(at("2026-09-30T15:00:00Z"));
    expect(nextJstMidnight(at("2026-09-30T15:00:00Z"))).toBe(at("2026-10-01T15:00:00Z"));
    expect(nextJstMidnight(at("2026-09-30T14:59:59Z"))).toBe(at("2026-09-30T15:00:00Z"));
  });
});

describe("midnight in Japan, on the learner's clock", () => {
  const midnight = at("2026-09-30T15:00:00Z");

  it("needs no gloss on a device that keeps Japan's time", () => {
    expect(onJapanTime(-540)).toBe(true);
    expect(onJapanTime(0)).toBe(false);
    expect(onJapanTime(420)).toBe(false);
  });

  it("is said as the hour it is where they are", () => {
    expect(localClock(midnight, -540)).toBe("00:00");
    expect(localClock(midnight, -60)).toBe("16:00"); // London in summer
    expect(localClock(midnight, 420)).toBe("08:00"); // California in summer
    expect(localClock(midnight, -330)).toBe("20:30"); // India
  });
});

describe("coming back to a screen about today", () => {
  const loaded = at("2026-09-30T14:55:00Z"); // 23:55 in Tokyo

  it("re-reads once the day has turned over in Japan", () => {
    expect(shouldRefresh(loaded, at("2026-09-30T15:01:00Z"))).toBe(true);
  });

  it("re-reads once it is old, and not while it is fresh", () => {
    expect(shouldRefresh(loaded, loaded + 60 * 1000)).toBe(false);
    const morning = at("2026-09-30T01:00:00Z");
    expect(shouldRefresh(morning, morning + REFRESH_AFTER_MS + 1)).toBe(true);
  });
});

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
    // A goal written above a ceiling that was later lowered: `updateProfile()`
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
