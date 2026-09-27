/**
 * The small pure modules: the reading clock, the exam date, the levels and the
 * role table. Each is arithmetic a screen trusts without checking.
 */
import { describe, expect, it } from "vitest";

import { daysUntil, EXAM_NEAR_DAYS, examIsNear, isIsoDate } from "./exam";
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
  const inDays = (n: number) =>
    new Date(Date.now() + 9 * 3600 * 1000 + n * 86400 * 1000).toISOString().slice(0, 10);

  it("counts whole days in Japan", () => {
    expect(daysUntil(inDays(10))).toBe(10);
    expect(daysUntil(null)).toBeNull();
  });

  it("is near for the last two weeks, today included, and not after", () => {
    expect(examIsNear(inDays(0))).toBe(true);
    expect(examIsNear(inDays(EXAM_NEAR_DAYS))).toBe(true);
    expect(examIsNear(inDays(EXAM_NEAR_DAYS + 1))).toBe(false);
    expect(examIsNear(inDays(-1))).toBe(false);
    expect(examIsNear(null)).toBe(false);
  });

  it("accepts only days that exist", () => {
    expect(isIsoDate("2026-12-06")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("6 Dec")).toBe(false);
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

  it("finds the trap that caught them most, leaving out the right answers", () => {
    expect(worstTrap(["correct", "reads_wrong_row", "reads_wrong_row", "timed_out"])).toEqual({
      role: "reads_wrong_row",
      count: 2,
    });
    expect(worstTrap(["correct"])).toBeNull();
  });
});
