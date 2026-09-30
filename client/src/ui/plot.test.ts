/**
 * The chart's arithmetic: reading a block, printing a figure, choosing the
 * gridlines, and the sentence a screen reader hears. The expected values are
 * what bjt/render/chart.py gives for the same input (`format_value`, `axis`),
 * because the page and the phone are meant to draw the same chart.
 */
import { describe, expect, it } from "vitest";

import type { DocBlock } from "../lib/types";
import { chartSummary, formatValue, niceTicks, plot, readChart } from "./plot";

const bars: DocBlock = {
  type: "chart",
  kind: "bar",
  caption: "月別の問い合わせ件数",
  unit: "件",
  categories: ["4月", "5月", "6月"],
  series: [
    { name: "東京", values: [12, 47, 33] },
    { name: "大阪", values: [8, 21, 30] },
  ],
};

describe("reading a chart block", () => {
  it("reads a well-formed block as it is", () => {
    expect(readChart(bars)).toEqual({
      kind: "bar",
      caption: "月別の問い合わせ件数",
      unit: "件",
      categories: ["4月", "5月", "6月"],
      series: [
        { name: "東京", values: [12, 47, 33] },
        { name: "大阪", values: [8, 21, 30] },
      ],
    });
  });

  it("draws what can be drawn: unknown kinds as bars, gaps for non-numbers, series fitted to the labels", () => {
    const odd = readChart({
      type: "chart",
      kind: "pie" as DocBlock["kind"],
      categories: ["A", "B", "C"],
      series: [
        { name: "x", values: [1, "2" as unknown as number, Number.NaN, 4] },
        { name: "y", values: [5] },
      ],
    });
    expect(odd?.kind).toBe("bar");
    expect(odd?.series.map((s) => s.values)).toEqual([
      [1, null, null],
      [5, null, null],
    ]);
  });

  it("keeps at most three series, which is all the inks there are", () => {
    const many = readChart({
      ...bars,
      series: [1, 2, 3, 4].map((n) => ({ name: `s${n}`, values: [n, n, n] })),
    });
    expect(many?.series).toHaveLength(3);
  });

  it("has nothing to draw without labels or figures", () => {
    expect(readChart({ ...bars, categories: [] })).toBeNull();
    expect(readChart({ ...bars, series: [] })).toBeNull();
  });
});

describe("printing a figure", () => {
  it("separates thousands, keeps up to two decimals and drops trailing zeros", () => {
    expect([1234567, 1234.5, -2000, 3.1, 0, 0.25].map(formatValue)).toEqual([
      "1,234,567",
      "1,234.5",
      "-2,000",
      "3.1",
      "0",
      "0.25",
    ]);
  });

  it("prints a gap as a dash", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue(Number.NaN)).toBe("—");
  });
});

describe("the gridlines", () => {
  it("are round numbers from zero past every figure", () => {
    expect(niceTicks([12, 47, 33])).toEqual([0, 10, 20, 30, 40, 50]);
    expect(niceTicks([1234567])).toEqual([0, 250000, 500000, 750000, 1000000, 1250000]);
  });

  it("run below zero for a negative figure, and keep zero among them", () => {
    expect(niceTicks([-15, 40])).toEqual([-20, 0, 20, 40]);
  });

  it("step in fractions without float noise", () => {
    expect(niceTicks([0.3, 0.7])).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });

  it("still make an axis of nothing", () => {
    expect(niceTicks([])).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});

describe("the chart in words", () => {
  it("names the kind and the unit, then every figure beside its label", () => {
    const chart = readChart(bars)!;
    expect(chartSummary(chart, { kind: "棒グラフ", unit: "単位" })).toBe(
      "棒グラフ：月別の問い合わせ件数（単位：件）。" +
        "東京：4月 12、5月 47、6月 33。" +
        "大阪：4月 8、5月 21、6月 30。"
    );
  });

  it("leaves out the unit and the series name where there are none", () => {
    const chart = readChart({ ...bars, unit: "", series: [{ name: "", values: [1, null as unknown as number, 3] }] })!;
    expect(chartSummary(chart, { kind: "Bar chart", unit: "unit" })).toBe(
      "Bar chart：月別の問い合わせ件数。4月 1、5月 —、6月 3。"
    );
  });
});

describe("laying it out", () => {
  it("stands bars up where they fit, and lays them down where they do not", () => {
    const chart = readChart(bars)!;
    expect(plot(chart, 600).orientation).toBe("columns");
    const crowded = readChart({
      ...bars,
      categories: Array.from({ length: 12 }, (_, i) => `第${i + 1}営業部`),
      series: [{ name: "", values: Array.from({ length: 12 }, (_, i) => 1000 * (i + 1)) }],
    })!;
    expect(plot(crowded, 320).orientation).toBe("rows");
  });

  it("prints every bar's figure", () => {
    const laid = plot(readChart(bars)!, 600);
    const texts = laid.marks.filter((m) => m.kind === "text").map((m) => (m as { text: string }).text);
    for (const figure of ["12", "47", "33", "8", "21", "30"]) expect(texts).toContain(figure);
  });
});
