/**
 * The arithmetic inside a few of the drawn pieces, loaded through the React
 * Native stub (vitest.config.ts): what the radar says aloud, how much the
 * tab bar grows for larger text, and which windows split the practice screen.
 */
import { describe, expect, it } from "vitest";

import { tr } from "../lib/i18n";
import type { TypeStat } from "../lib/types";
import { radarDescription } from "./radar";
import { labelGrowth, TAB_LABEL } from "./tabbar";
import { ANSWER_COLUMN_WIDTH, colors, PAGE_MAX_WIDTH, space, SPLIT_MIN_WIDTH, splitLayout, type } from "./theme";

function stat(label_ja: string, answered: number, accuracy: number | null): TypeStat {
  return {
    item_type: label_ja,
    label_ja,
    section: "choukai",
    sort_order: 0,
    answered,
    correct: 0,
    accuracy,
    last_answered_at: null,
    recent_answered: 0,
    recent_accuracy: null,
  };
}

describe("the radar, said aloud", () => {
  const stats = [stat("発言聴解問題", 10, 0.62), stat("総合聴解問題", 0, null), stat("表現読解問題", 4, 1)];

  it("names every type and its share, and an untried one as untried rather than zero", () => {
    const ja = radarDescription(stats, (key, vars) => tr("ja", key, vars));
    expect(ja).toBe("種類ごとの正答率。発言聴解問題 62%、総合聴解問題 まだ解いていません、表現読解問題 100%");
    const en = radarDescription(stats, (key, vars) => tr("en", key, vars));
    expect(en).toBe("Accuracy by type. 発言聴解問題 62%, 総合聴解問題 not tried yet, 表現読解問題 100%");
  });
});

describe("the tab bar", () => {
  it("does not grow at the default text size, and grows a line per step above it", () => {
    expect(labelGrowth(1)).toBe(0);
    expect(labelGrowth(0.85)).toBe(0);
    expect(labelGrowth(2)).toBe(TAB_LABEL.lineHeight);
    expect(labelGrowth(1.3)).toBe(Math.ceil(TAB_LABEL.lineHeight * 0.3));
  });
});

describe("the theme, through the stub", () => {
  it("loads as written", () => {
    expect(type.small.color).toBe(colors.muted);
  });
});

describe("the split practice screen", () => {
  it("is for a laptop's window, never a phone's or a portrait tablet's", () => {
    for (const width of [320, 375, 430, 768, 834, SPLIT_MIN_WIDTH - 1]) expect(splitLayout(width)).toBe(false);
    for (const width of [SPLIT_MIN_WIDTH, 1280, 1440, 2560]) expect(splitLayout(width)).toBe(true);
  });

  it("leaves the reading column room for the scene's picture where it starts", () => {
    // The window less the page's padding, the gap and the answer column; the
    // scene picture is drawn at most 480 wide (SceneCard).
    const reading = SPLIT_MIN_WIDTH - 2 * space.lg - space.xl - ANSWER_COLUMN_WIDTH;
    expect(reading).toBeGreaterThanOrEqual(480);
    expect(reading).toBeLessThanOrEqual(PAGE_MAX_WIDTH);
  });
});
