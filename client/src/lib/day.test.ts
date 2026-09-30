/**
 * The day as Japan counts it: when it turns over, and when a screen about it
 * is stale.
 */
import { describe, expect, it } from "vitest";

import { jstDate, localClock, nextJstMidnight, onJapanTime, REFRESH_AFTER_MS, shouldRefresh } from "./day";

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
