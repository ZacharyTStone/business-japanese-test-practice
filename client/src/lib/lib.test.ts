/**
 * The small pure modules: the reading clock, the exam date, the levels and the
 * role table. Each is arithmetic a screen trusts without checking.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  countdownLine,
  daysUntil,
  EXAM_NEAR_DAYS,
  examIsNear,
  formatExamDate,
  isIsoDate,
  todayIso,
  typedDate,
} from "./exam";
import { tr } from "./i18n";
import { DISTRACTOR_ROLES } from "./generated";
import { levelMove, levelsAgree, placedLevel, placedLevels } from "./levels";
import { budgetSeconds, type TypePace } from "./pace";
import { roleInfo, verdictFor, worstTrap } from "./roles";
import type { QueuedItem, SectionLevel } from "./types";

function readingItem(stem: string): QueuedItem {
  return {
    id: "x",
    item_type: "sougou_dokkai",
    level: "J2",
    topic: "",
    stem,
    scene_id: null,
    scene_image_path: null,
    speaker_role: null,
    listener_role: null,
    channel: null,
    seed_cell_id: null,
    correct_index: 0,
    explanation_ja: "",
    explanation_en: "",
    vocab_notes: [],
    documents: [],
    dialogue: [],
    narration_clip_id: null,
    narration_path: null,
    options: [],
    times_seen: 0,
    stands_for: null,
    lesson_trap: null,
  };
}

describe("the reading clock", () => {
  const pace: Record<string, TypePace> = { sougou_dokkai: { seconds: 105, typicalChars: 650 } };

  it("gives a typical item its type's budget", () => {
    expect(budgetSeconds(readingItem("あ".repeat(650)), pace)).toBe(105);
  });

  it("scales with the reading, and is clamped at 1.6 and 0.6 of the budget", () => {
    expect(budgetSeconds(readingItem("あ".repeat(5000)), pace)).toBe(168);
    expect(budgetSeconds(readingItem("あ"), pace)).toBe(63);
  });

  it("counts a graph's labels and figures as reading", () => {
    const withChart: QueuedItem = {
      ...readingItem("あ".repeat(400)),
      documents: [
        {
          template: "progress_report",
          title: "",
          meta: [],
          blocks: [
            {
              type: "chart",
              kind: "bar",
              caption: "月別 件数",
              unit: "件",
              categories: ["4月", "5月", "6月", "7月", "8月", "9月"],
              series: [
                { name: "電話", values: [330, 410, 340, 260, 240, 460] },
                { name: "メール", values: [150, 190, 250, 320, 340, 370] },
              ],
            },
          ],
        },
      ],
    };
    expect(budgetSeconds(withChart, pace)).toBeGreaterThan(budgetSeconds(readingItem("あ".repeat(400)), pace));
  });

  it("has no clock for a type the audio paces", () => {
    expect(budgetSeconds({ ...readingItem("あ"), item_type: "hatsugen_choukai" }, pace)).toBe(0);
  });
});

describe("the exam date", () => {
  // 15:30 UTC on 30 September is 00:30 on 1 October in Tokyo: the moment a
  // count done in UTC and one done in Japan disagree by a day. The expected
  // dates are written out rather than computed, so a mistake in the code's
  // own arithmetic cannot be repeated in the test's.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T15:30:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts whole days in Japan", () => {
    expect(todayIso()).toBe("2026-10-01");
    expect(daysUntil("2026-10-01")).toBe(0);
    expect(daysUntil("2026-10-11")).toBe(10);
    expect(daysUntil("2026-09-30")).toBe(-1);
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil("someday")).toBeNull();
  });

  it("is near for the last two weeks, today included, and not after", () => {
    expect(EXAM_NEAR_DAYS).toBe(14);
    expect(examIsNear("2026-10-01")).toBe(true);
    expect(examIsNear("2026-10-15")).toBe(true);
    expect(examIsNear("2026-10-16")).toBe(false);
    expect(examIsNear("2026-09-30")).toBe(false);
    expect(examIsNear(null)).toBe(false);
  });

  it("is said the way a person says a date", () => {
    expect(formatExamDate("2026-12-06", "ja")).toBe("12月6日");
    expect(formatExamDate("2026-12-06", "en")).toBe("6 Dec");
  });

  it("counts down in words, and stops counting once it has passed", () => {
    expect(countdownLine(null, "ja")).toBeNull();
    expect(countdownLine(-3, "ja")).toBe("試験はもう終わりました");
    expect(countdownLine(0, "en")).toBe("The exam is today");
    expect(countdownLine(1, "en")).toBe("1 day to the exam");
    expect(countdownLine(12, "en")).toBe("12 days to the exam");
    expect(countdownLine(12, "ja")).toBe("試験まであと12日");
  });

  it("accepts only days that exist", () => {
    expect(isIsoDate("2026-12-06")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("6 Dec")).toBe(false);
  });

  it("writes the hyphens into digits typed on a number pad", () => {
    expect(typedDate("20261201")).toBe("2026-12-01");
    expect(typedDate("2026")).toBe("2026");
    expect(typedDate("20261")).toBe("2026-1");
    expect(typedDate("202612")).toBe("2026-12");
    expect(typedDate("2026121")).toBe("2026-12-1");
    // What the field already shows comes back through it unchanged, one more
    // digit or one fewer.
    expect(typedDate("2026-12-0")).toBe("2026-12-0");
    expect(typedDate("2026-12")).toBe("2026-12");
    // Pasted in another shape, and too long.
    expect(typedDate("2026/12/01")).toBe("2026-12-01");
    expect(typedDate("2026120199")).toBe("2026-12-01");
    expect(typedDate("")).toBe("");
    expect(isIsoDate(typedDate("20261201"))).toBe(true);
  });
});

describe("the string table", () => {
  it("fills in its variables", () => {
    expect(tr("ja", "goal_ring", { done: 3, goal: 10 })).toBe("今日の目標10問のうち3問");
    expect(tr("en", "goal_ring", { done: 3, goal: 10 })).toBe("3 of today's 10 questions");
  });

  it("picks the English plural by n, and leaves Japanese alone", () => {
    expect(tr("en", "streak_days", { n: 1 })).toBe("1 day");
    expect(tr("en", "streak_days", { n: 2 })).toBe("2 days");
    expect(tr("en", "streak_days", { n: 0 })).toBe("0 days");
    expect(tr("ja", "streak_days", { n: 1 })).toBe("1日");
    expect(tr("ja", "streak_days", { n: 2 })).toBe("2日");
  });

  it("uses a string with no variables as written", () => {
    expect(tr("en", "retry")).toBe("Try again");
    expect(tr("ja", "retry")).toBe("もう一度読み込む");
  });
});

describe("levels", () => {
  const lv = (section: SectionLevel["section"], level: SectionLevel["level"], placed: boolean): SectionLevel => ({
    section,
    level,
    placed,
    changed_at: "2026-09-27T00:00:00Z",
  });

  it("names only a placed level", () => {
    const levels = [lv("choukai", "J2", false), lv("dokkai", "J1", true)];
    expect(placedLevel(levels, "choukai")).toBeNull();
    expect(placedLevel(levels, "dokkai")).toBe("J1");
    expect(placedLevels(levels).map((l) => l.section)).toEqual(["dokkai"]);
  });

  it("says which section moved and which way", () => {
    const before = [lv("choukai", "J2", true), lv("dokkai", "J2", true)];
    const after = [lv("choukai", "J2", true), lv("dokkai", "J1", true)];
    expect(levelMove(before, after)).toEqual({ section: "dokkai", from: "J2", to: "J1", direction: 1 });
    expect(levelMove(after, before)?.direction).toBe(-1);
    expect(levelMove(before, before)).toBeNull();
    expect(levelsAgree(before)).toBe(true);
    expect(levelsAgree(after)).toBe(false);
  });
});

describe("the role table", () => {
  it("describes every role a question can carry, in both languages", () => {
    for (const role of DISTRACTOR_ROLES) {
      for (const lang of ["ja", "en"] as const) {
        const info = roleInfo(role, lang);
        expect(info.label, `${role} ${lang}`).not.toBe(roleInfo("__unknown__", lang).label);
        expect(info.verdict, `${role} ${lang}`).not.toBe("");
      }
    }
  });

  it("never glues でした onto a verb or an adjective", () => {
    for (const role of [...DISTRACTOR_ROLES, "timed_out", "__unknown__"]) {
      const verdict = roleInfo(role, "ja").verdict;
      expect(verdict, role).not.toMatch(/(ない|る|う|い)でした$/);
    }
  });

  it("keeps the rudeness meter to the questions about manners", () => {
    expect(roleInfo("register_too_casual").manner).toBe(true);
    expect(roleInfo("reads_wrong_row").manner).toBe(false);
    expect(roleInfo("superseded_by_later_turn").manner).toBe(false);
    expect(roleInfo("timed_out").manner).toBe(false);
  });

  it("names who the words landed on", () => {
    expect(verdictFor("register_too_casual", "部長", "ja")).toBe("部長には、くだけすぎでした");
    expect(verdictFor("register_too_casual", null, "ja")).toBe("相手には、くだけすぎでした");
  });

  it("keeps Japanese out of the middle of an English sentence", () => {
    expect(verdictFor("register_too_casual", "部長", "en")).toBe("Too casual for them (部長)");
    expect(verdictFor("register_too_casual", null, "en")).toBe("Too casual for them");
    expect(verdictFor("content_mismatch", "取引先の担当者", "en")).toBe(
      "It didn't answer what they wanted to know (取引先の担当者)"
    );
    // A role about reading, not about a listener, names nobody.
    expect(verdictFor("reads_wrong_row", "部長", "en")).toBe("That was the row next to it");
    for (const role of [...DISTRACTOR_ROLES, "timed_out", "__unknown__"]) {
      expect(roleInfo(role, "en").verdict, role).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/);
    }
  });

  it("finds the trap that caught them most, leaving out the right answers", () => {
    expect(worstTrap(["correct", "reads_wrong_row", "reads_wrong_row", "timed_out"])).toEqual({
      role: "reads_wrong_row",
      count: 2,
    });
    expect(worstTrap(["correct"])).toBeNull();
  });
});
