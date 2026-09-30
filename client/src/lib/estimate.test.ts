/**
 * How long home says a set takes: the learner's own pace once they have one,
 * the exam's reading pace before.
 */
import { describe, expect, it } from "vitest";

import { MIN_SAMPLES, minutesFor, secondsPerQuestion } from "./estimate";

describe("the time a set takes", () => {
  const exam = [30, 45, 105];

  it("is the exam's reading pace before there is a record", () => {
    expect(secondsPerQuestion([], exam)).toBe(60);
    expect(minutesFor(10, secondsPerQuestion([], exam))).toBe(10);
  });

  it("is the learner's own median once there are enough answers", () => {
    const own = [40_000, 50_000, 70_000, 80_000, 90_000];
    expect(own).toHaveLength(MIN_SAMPLES);
    expect(secondsPerQuestion(own, exam)).toBe(70);
    expect(minutesFor(10, secondsPerQuestion(own, exam))).toBe(12);
  });

  it("is not moved by a question left open over lunch, or tapped through", () => {
    const own = [60_000, 60_000, 60_000, 3_600_000, 3_600_000, 100, 60_000];
    expect(secondsPerQuestion(own, exam)).toBe(60);
  });

  it("needs a few answers before it trusts them", () => {
    expect(secondsPerQuestion([200_000, 200_000], exam)).toBe(60);
  });

  it("stands on its own feet with nothing to read", () => {
    expect(secondsPerQuestion([], [])).toBe(60);
    expect(minutesFor(1, 10)).toBe(1);
    expect(minutesFor(3, 60)).toBe(3);
  });
});
