/**
 * The geometry of a chart on the sheet, and nothing else.
 *
 * Pure arithmetic from a chart block and a width to a list of marks — rects,
 * lines, text — with no React in it, so ui/chart.tsx can draw the marks with
 * react-native-svg and anything else (a test, a script that rasterises a chart
 * to look at it) can lay one out without a phone. Paint is named by role
 * (`ink`, `grid`, `grey`…) and turned into the paper's colours by the drawer.
 *
 * The rules mirror bjt/render/chart.ts, which is where a chart's shape is
 * enforced before it is ever published: the same axis arithmetic
 * (`niceTicks` ≡ `chart.axis`), the same way of printing a figure
 * (`formatValue` ≡ `chart.format_value`), and the same reading of a malformed
 * block — draw what can be drawn rather than take the screen down.
 *
 * **Legible at phone width is the whole design.** Every bar carries its
 * figure, so a question may quote one: bars stand up as columns while each
 * column is wide enough to see, holds its figure, and has its label fit
 * under its group in two lines at most; below that they turn on their side,
 * one category to a row with its label above and each figure at the end of its
 * bar — the table's stacked rows, for a graph. A line always runs left to
 * right, because time does; it is read against its gridlines, prints its
 * figures only when there is one line and room for them, and when its points
 * crowd it labels every second or third month rather than overprinting twelve.
 */
import type { DocBlock } from "../lib/types";

export type ChartKind = "bar" | "line";

export type ChartData = {
  kind: ChartKind;
  caption: string;
  unit: string;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
};

/** A colour by what it is for; ui/chart.tsx maps each onto the paper's ink. */
export type Paint = "ink" | "faint" | "rule" | "grid" | "grey" | "paper" | "none";

export type Mark =
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: Paint; stroke: Paint }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: Paint; width: number; dash?: string }
  | { kind: "polyline"; points: string; stroke: Paint; width: number; dash?: string }
  | { kind: "circle"; cx: number; cy: number; r: number; fill: Paint; stroke: Paint }
  | { kind: "polygon"; points: string; fill: Paint; stroke: Paint }
  | { kind: "text"; x: number; y: number; text: string; size: number; anchor: "start" | "middle" | "end"; fill: Paint };

type Plot = { width: number; height: number; marks: Mark[]; orientation: "columns" | "rows" };

/** How each series is told apart: fill for a bar; dash and marker for a line. */
export const SERIES_STYLE: { fill: Paint; dash?: string; marker: "circle" | "square" | "triangle" }[] = [
  { fill: "ink", marker: "circle" },
  { fill: "grey", dash: "6 4", marker: "square" },
  { fill: "paper", dash: "2 3", marker: "triangle" },
];

const MAX_SERIES = SERIES_STYLE.length;
/** Category labels. */
const LABEL = 12;
/** The figures on the axis, and at the end of a bar laid on its side. */
const SMALL = 11;
/** A figure over a column, where the column's width is all the room there is. */
const FIGURE = 10;
/** How much of a group its bars take; the rest keeps groups apart. */
const BAR_SHARE = 0.8;

// ----- reading the block -----------------------------------------------------

/** The chart as something that can be drawn, or null when there is nothing to
 *  draw. Unknown kinds draw as bars, a value that is not a number is a gap,
 *  and a series is cut or padded to the categories it has. */
export function readChart(block: DocBlock): ChartData | null {
  const categories = Array.isArray(block.categories) ? block.categories.map((c) => String(c)) : [];
  const rawSeries: unknown[] = Array.isArray(block.series) ? block.series : [];
  const series = rawSeries
    .filter((s): s is { name?: unknown; values?: unknown } => !!s && typeof s === "object")
    .slice(0, MAX_SERIES)
    .map((s) => {
      const raw: unknown[] = Array.isArray(s.values) ? s.values : [];
      const values = categories.map((_, i) => {
        const v = raw[i];
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      });
      return { name: String(s.name ?? "").trim(), values };
    });
  if (!categories.length || !series.length) return null;
  return {
    kind: block.kind === "line" ? "line" : "bar",
    caption: block.caption ?? "",
    unit: block.unit ?? "",
    categories,
    series,
  };
}

/** A figure as print sets it: thousands separated, at most two decimals, no
 *  trailing zeros. The same string the models are shown. */
export function formatValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const [whole, fraction = ""] = Math.abs(value).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = fraction.replace(/0+$/, "");
  const sign = value < 0 && (grouped !== "0" || decimals) ? "-" : "";
  return sign + grouped + (decimals ? `.${decimals}` : "");
}

/** Gridline values: round numbers, zero among them, spanning every figure. */
export function niceTicks(values: number[], target = 5): number[] {
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw * (1 - 1e-9)) ?? 10 * magnitude;
  const first = Math.floor(lo / step + 1e-9) * step;
  const last = Math.ceil(hi / step - 1e-9) * step;
  const n = Math.round((last - first) / step);
  return Array.from({ length: n + 1 }, (_, i) => Math.round((first + i * step) * 1e10) / 1e10);
}

/** The chart in words, for a screen reader: what it is, in what unit, and every
 *  figure beside its label — the same pairing the models read, so nobody,
 *  human or not, has to line a row of numbers up with a row of months. */
export function chartSummary(chart: ChartData, words: { kind: string; unit: string }): string {
  const head = `${words.kind}：${chart.caption}` + (chart.unit ? `（${words.unit}：${chart.unit}）` : "");
  const lines = chart.series.map((s) => {
    const pairs = chart.categories.map((c, i) => `${c} ${formatValue(s.values[i])}`).join("、");
    return s.name ? `${s.name}：${pairs}` : pairs;
  });
  return [head, ...lines].join("。") + "。";
}

// ----- layout ----------------------------------------------------------------

/** A guess at how wide a label sets: a full em for kanji and kana, a little
 *  over half of one for a digit or a Latin letter. */
function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) em += (ch.codePointAt(0) ?? 0) < 0x2e80 ? 0.58 : 1;
  return em * size;
}

/** A label under a column: one line, two, or null if it will not fit in two. */
function labelLines(label: string, room: number): string[] | null {
  if (textWidth(label, LABEL) <= room) return [label];
  const half = Math.ceil(label.length / 2);
  const lines = [label.slice(0, half), label.slice(half)];
  return lines.every((l) => textWidth(l, LABEL) <= room) ? lines : null;
}

function allValues(chart: ChartData): number[] {
  return chart.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
}

/** Lay a chart out at a given width. */
export function plot(chart: ChartData, width: number): Plot {
  if (chart.kind === "bar") {
    return columns(chart, width, true) ?? rows(chart, width);
  }
  return columns(chart, width, false)!;
}

/** Bars as columns, or a line — both over a horizontal axis with gridlines. Null
 *  when a column would be too thin to see, too thin to hold its figure, or
 *  too narrow for its label: then the bars are laid on their side instead. */
function columns(chart: ChartData, width: number, bars: boolean): Plot | null {
  const ticks = niceTicks(allValues(chart));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const tickLabels = ticks.map(formatValue);
  const left = Math.max(...tickLabels.map((t) => textWidth(t, SMALL))) + 8;
  const plotW = width - left - 4;
  const n = chart.categories.length;
  const m = chart.series.length;
  const group = plotW / n;
  const inner = group * BAR_SHARE;
  const bar = inner / m;

  // Which categories are labelled, and in how many lines.
  let step = 1;
  let labels: (string[] | null)[] = chart.categories.map((c) => labelLines(c, group - 2));
  if (bars) {
    const figuresFit = allValues(chart).every((v) => textWidth(formatValue(v), FIGURE) <= bar + 1);
    if (bar < 7 || !figuresFit || labels.some((l) => l === null)) return null;
  } else {
    // A line may skip labels, never overprint them: every second month is
    // still a readable axis, and twelve squeezed labels are not.
    const widest = Math.max(...chart.categories.map((c) => textWidth(c, LABEL)));
    while (step < n && widest > step * group - 4) step += 1;
    labels = chart.categories.map((c, i) => (i % step === 0 ? [c] : []));
  }
  const lineCount = Math.max(1, ...labels.map((l) => (l ? l.length : 1)));

  const top = 18;
  const plotH = Math.min(220, Math.max(150, width * 0.48));
  const height = top + plotH + lineCount * (LABEL + 3) + 6;
  const y = (v: number) => top + ((hi - v) / (hi - lo)) * plotH;
  const cx = (i: number) => left + (i + 0.5) * group;

  const marks: Mark[] = [];
  ticks.forEach((t, i) => {
    marks.push({ kind: "line", x1: left, y1: y(t), x2: left + plotW, y2: y(t),
                 stroke: t === 0 ? "rule" : "grid", width: t === 0 ? 1.2 : 1 });
    marks.push({ kind: "text", x: left - 5, y: y(t) + SMALL * 0.35, text: tickLabels[i],
                 size: SMALL, anchor: "end", fill: "faint" });
  });

  if (bars) {
    chart.categories.forEach((_, i) => {
      chart.series.forEach((s, j) => {
        const v = s.values[i];
        if (v === null) return;
        const x = left + i * group + (group - inner) / 2 + j * bar;
        const y0 = y(Math.max(v, 0));
        const y1 = y(Math.min(v, 0));
        marks.push({ kind: "rect", x: x + 0.5, y: y0, w: Math.max(bar - 1, 1), h: Math.max(y1 - y0, 0.5),
                     fill: SERIES_STYLE[j].fill, stroke: "ink" });
        // Over the column for a figure above zero, under it for one below.
        // Columns were only chosen because every figure fits.
        marks.push({ kind: "text", x: x + bar / 2, y: v >= 0 ? y0 - 4 : y1 + FIGURE + 2, text: formatValue(v),
                     size: FIGURE, anchor: "middle", fill: "ink" });
      });
    });
  } else {
    const single = m === 1;
    const figuresFit = single && chart.series[0].values.every((v) => textWidth(formatValue(v), SMALL) <= group - 2);
    chart.series.forEach((s, j) => {
      const style = SERIES_STYLE[j];
      // A gap in the data is a gap in the line, not a line drawn through it.
      let run: string[] = [];
      const flush = () => {
        if (run.length > 1) marks.push({ kind: "polyline", points: run.join(" "), stroke: "ink", width: 2, dash: style.dash });
        run = [];
      };
      s.values.forEach((v, i) => {
        if (v === null) return flush();
        run.push(`${cx(i).toFixed(1)},${y(v).toFixed(1)}`);
      });
      flush();
      s.values.forEach((v, i) => {
        if (v === null) return;
        marks.push(...marker(style.marker, cx(i), y(v), style.fill));
        if (figuresFit) {
          marks.push({ kind: "text", x: cx(i), y: y(v) - 8, text: formatValue(v), size: SMALL,
                       anchor: "middle", fill: "ink" });
        }
      });
    });
  }

  labels.forEach((lines, i) => {
    (lines ?? []).forEach((line, k) => {
      marks.push({ kind: "text", x: cx(i), y: top + plotH + (k + 1) * (LABEL + 3), text: line,
                   size: LABEL, anchor: "middle", fill: "ink" });
    });
  });

  return { width, height, marks, orientation: "columns" };
}

/** Bars on their side: one category to a row, its label above, each figure at
 *  the end of its bar. Height grows with the categories; width never runs out. */
function rows(chart: ChartData, width: number): Plot {
  const values = allValues(chart);
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (lo === hi) hi = lo + 1;
  const figureW = Math.max(12, ...values.map((v) => textWidth(formatValue(v), SMALL))) + 6;
  const negative = lo < 0;
  const left = negative ? figureW : 0;
  const plotW = Math.max(40, width - left - figureW);
  const x = (v: number) => left + ((v - lo) / (hi - lo)) * plotW;

  const barH = 13;
  const gap = 3;
  const labelH = LABEL + 5;
  const groupH = labelH + chart.series.length * (barH + gap) + 8;
  const height = chart.categories.length * groupH;

  const marks: Mark[] = [];
  chart.categories.forEach((label, i) => {
    const top = i * groupH;
    marks.push({ kind: "text", x: 0, y: top + LABEL, text: label, size: LABEL, anchor: "start", fill: "ink" });
    chart.series.forEach((s, j) => {
      const v = s.values[i];
      if (v === null) return;
      const barTop = top + labelH + j * (barH + gap);
      const x0 = x(Math.min(v, 0));
      const x1 = x(Math.max(v, 0));
      marks.push({ kind: "rect", x: x0, y: barTop, w: Math.max(x1 - x0, 0.5), h: barH,
                   fill: SERIES_STYLE[j].fill, stroke: "ink" });
      marks.push({ kind: "text", x: v >= 0 ? x1 + 4 : x0 - 4, y: barTop + barH - 2.5, text: formatValue(v),
                   size: SMALL, anchor: v >= 0 ? "start" : "end", fill: "ink" });
    });
  });
  // The baseline, through every row: where zero is, and which way is less.
  marks.push({ kind: "line", x1: x(0), y1: LABEL + 3, x2: x(0), y2: height - 6, stroke: "rule", width: 1.2 });
  return { width, height, marks, orientation: "rows" };
}

/** One point of a line, in its series' shape. */
export function marker(shape: "circle" | "square" | "triangle", x: number, y: number, fill: Paint): Mark[] {
  if (shape === "square") return [{ kind: "rect", x: x - 3.5, y: y - 3.5, w: 7, h: 7, fill, stroke: "ink" }];
  if (shape === "triangle") {
    const points = `${x},${y - 4.5} ${x - 4.5},${y + 3.5} ${x + 4.5},${y + 3.5}`;
    return [{ kind: "polygon", points, fill, stroke: "ink" }];
  }
  return [{ kind: "circle", cx: x, cy: y, r: 3.5, fill, stroke: "ink" }];
}
