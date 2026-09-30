/**
 * What 記録 ranks: the window, the thresholds, the timeouts on a line of their
 * own, and the order.
 */
import { describe, expect, it } from "vitest";

import { MIN_ANSWERS_PER_TAG, MIN_TIMES_MET, rankTraps, rankWeakTags } from "./ranking";
import type { RoleTrap, TagStat } from "./types";

function tag(over: Partial<TagStat> & { tag: string }): TagStat {
  return {
    axis: "function",
    answered: 0,
    correct: 0,
    accuracy: 0,
    recent_answered: 0,
    recent_accuracy: null,
    ...over,
  };
}

function trap(over: Partial<RoleTrap> & { role: string }): RoleTrap {
  return {
    times_chosen: 0,
    last_chosen_at: "2026-09-01T00:00:00Z",
    recent_times: 0,
    times_met: 0,
    recent_met: 0,
    ...over,
  };
}

describe("the weak tags", () => {
  it("rank the last 30 days, weakest first, and leave out a tag met too few times", () => {
    const { recent, rows } = rankWeakTags([
      tag({ tag: "a", recent_answered: 5, recent_accuracy: 0.8 }),
      tag({ tag: "b", recent_answered: 4, recent_accuracy: 0.25 }),
      tag({ tag: "c", recent_answered: MIN_ANSWERS_PER_TAG - 1, recent_accuracy: 0 }),
      tag({ tag: "d", answered: 40, accuracy: 0.1 }),
    ]);
    expect(recent).toBe(true);
    expect(rows.map((r) => r.tag)).toEqual(["b", "a"]);
    expect(rows[0]).toMatchObject({ n: 4, acc: 0.25 });
  });

  it("fall back to all-time as a whole when nothing is recent", () => {
    const { recent, rows } = rankWeakTags([
      tag({ tag: "a", answered: 10, accuracy: 0.9 }),
      tag({ tag: "b", answered: 6, accuracy: 0.5 }),
      tag({ tag: "c", answered: 2, accuracy: 0 }),
    ]);
    expect(recent).toBe(false);
    expect(rows.map((r) => [r.tag, r.n])).toEqual([
      ["b", 6],
      ["a", 10],
    ]);
  });

  it("stop at six", () => {
    const many = Array.from({ length: 9 }, (_, i) => tag({ tag: `t${i}`, answered: 5, accuracy: i / 10 }));
    expect(rankWeakTags(many).rows).toHaveLength(6);
  });
});

describe("the traps", () => {
  it("rank by the share of offers that caught them, then by count", () => {
    const { top } = rankTraps([
      trap({ role: "often_offered", recent_times: 4, recent_met: 20 }),
      trap({ role: "sharp", recent_times: 3, recent_met: 4 }),
      trap({ role: "sharp_but_more", recent_times: 6, recent_met: 8 }),
    ]);
    expect(top.map((r) => r.role)).toEqual(["sharp_but_more", "sharp", "often_offered"]);
  });

  it("leave out a trap offered too few times to have a share", () => {
    const { top } = rankTraps([trap({ role: "rare", recent_times: 2, recent_met: MIN_TIMES_MET - 1 })]);
    expect(top).toEqual([]);
  });

  it("keep the clock on a line of its own", () => {
    const { top, timeouts } = rankTraps([
      trap({ role: "timed_out", recent_times: 3, recent_met: null }),
      trap({ role: "reads_wrong_row", recent_times: 2, recent_met: 5 }),
    ]);
    expect(top.map((r) => r.role)).toEqual(["reads_wrong_row"]);
    expect(timeouts).toMatchObject({ role: "timed_out", n: 3 });
  });

  it("fall back to all-time when nothing is recent", () => {
    const { recent, top } = rankTraps([trap({ role: "old", times_chosen: 5, times_met: 9 })]);
    expect(recent).toBe(false);
    expect(top).toMatchObject([{ role: "old", n: 5, met: 9 }]);
  });
});
