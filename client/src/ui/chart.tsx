/**
 * A graph on the sheet — a document's `chart` block, drawn natively.
 *
 * 資料聴読解 on the real paper often hands the candidate a graph and asks about
 * it together with what is heard: which month fell, which branch overtook
 * which, whether a figure cleared its target once the speaker has said what to
 * leave out. Reading a trend off bars is its own skill, and a table is not a
 * graph.
 *
 * Like every block it is data, never a picture: the pipeline ships categories
 * and numbers (enforced by bjt/render/chart.ts before anything is published)
 * and the app draws them, so the chart is as sharp at any size as the text
 * around it. ui/plot.ts does the geometry; this file turns its marks into
 * react-native-svg and dresses them in the paper's ink — solid, grey and open
 * bars; solid, dashed and dotted lines; circle, square and triangle — so the
 * series stay apart in black and white, as a photocopied chart keeps them.
 *
 * To a screen reader the chart is one element whose label is the caption, the
 * unit and every figure beside its label: what a sighted reader takes off the
 * bars, rather than a tour of rectangles.
 */
import { useMemo, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent, type TextStyle } from "react-native";
import Svg, { Circle, Line, Polygon, Polyline, Rect, Text as SvgText } from "react-native-svg";

import { useLang } from "../lib/i18n";
import type { DocBlock } from "../lib/types";
import { chartSummary, marker, plot, readChart, SERIES_STYLE, type ChartData, type Mark, type Paint } from "./plot";
import { ink, space } from "./theme";

/** Each role a mark can play, in the paper's ink. */
const PAINT: Record<Paint, string> = {
  ink: ink.text,
  faint: ink.faint,
  rule: ink.rule,
  grid: ink.ruleLight,
  grey: ink.seriesGrey,
  paper: ink.paper,
  none: "none",
};

function draw(mark: Mark, key: number) {
  switch (mark.kind) {
    case "rect":
      return (
        <Rect key={key} x={mark.x} y={mark.y} width={mark.w} height={mark.h}
          fill={PAINT[mark.fill]} stroke={PAINT[mark.stroke]} strokeWidth={0.75} />
      );
    case "line":
      return (
        <Line key={key} x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2}
          stroke={PAINT[mark.stroke]} strokeWidth={mark.width} strokeDasharray={mark.dash} />
      );
    case "polyline":
      return (
        <Polyline key={key} points={mark.points} fill="none" stroke={PAINT[mark.stroke]}
          strokeWidth={mark.width} strokeDasharray={mark.dash} />
      );
    case "circle":
      return (
        <Circle key={key} cx={mark.cx} cy={mark.cy} r={mark.r}
          fill={PAINT[mark.fill]} stroke={PAINT[mark.stroke]} strokeWidth={1.2} />
      );
    case "polygon":
      return (
        <Polygon key={key} points={mark.points}
          fill={PAINT[mark.fill]} stroke={PAINT[mark.stroke]} strokeWidth={1.2} />
      );
    case "text":
      return (
        <SvgText key={key} x={mark.x} y={mark.y} fontSize={mark.size}
          textAnchor={mark.anchor} fill={PAINT[mark.fill]}>
          {mark.text}
        </SvgText>
      );
  }
}

/** Which drawing is which series. Only for two or more: one series is what
 *  the caption already says. Text rather than SVG, so it wraps and follows the
 *  reader's text size. */
function Legend({ chart, face }: { chart: ChartData; face: TextStyle }) {
  if (chart.series.length < 2) return null;
  return (
    <View style={styles.legend}>
      {chart.series.map((s, j) => {
        const style = SERIES_STYLE[j];
        const swatch: Mark[] =
          chart.kind === "bar"
            ? [{ kind: "rect", x: 1, y: 1, w: 16, h: 10, fill: style.fill, stroke: "ink" }]
            : [
                { kind: "line", x1: 0, y1: 6, x2: 26, y2: 6, stroke: "ink", width: 2, dash: style.dash },
                ...marker(style.marker, 13, 6, style.fill),
              ];
        return (
          <View key={j} style={styles.legendItem}>
            <Svg width={26} height={12}>{swatch.map(draw)}</Svg>
            <Text style={[styles.legendText, face]}>{s.name}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function ChartView({ block, face }: { block: DocBlock; face: TextStyle }) {
  const { t } = useLang();
  // The plot is laid out for the width it is given, which is only known once
  // the sheet has been measured; until then it holds its place.
  const [width, setWidth] = useState(0);
  // Worked out once per block and width, not per render: the screen around a
  // chart redraws on every tick of an audio player and every answer, and
  // laying a chart out is the most arithmetic anything on it does.
  const chart = useMemo(() => readChart(block), [block]);
  const laid = useMemo(() => (chart && width > 0 ? plot(chart, width) : null), [chart, width]);
  const summary = useMemo(
    () =>
      chart
        ? chartSummary(chart, { kind: t(chart.kind === "line" ? "chart_line" : "chart_bar"), unit: t("chart_unit") })
        : "",
    [chart, t]
  );
  if (!chart) {
    // Nothing to draw. The title still says a chart was meant to be here, and
    // a learner in the middle of a question keeps the rest of the page.
    return block.caption ? <Text style={[styles.title, face]}>{block.caption}</Text> : null;
  }

  const onLayout = (e: LayoutChangeEvent) => {
    const measured = Math.floor(e.nativeEvent.layout.width);
    if (measured !== width) setWidth(measured);
  };

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} style={styles.chart}>
      <Text style={[styles.title, face]}>{chart.caption}</Text>
      {chart.unit ? <Text style={[styles.unit, face]}>（単位：{chart.unit}）</Text> : null}
      <Legend chart={chart} face={face} />
      <View onLayout={onLayout} style={styles.plotArea}>
        {laid ? (
          <Svg width={laid.width} height={laid.height}>
            {laid.marks.map(draw)}
          </Svg>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { gap: space.xs },
  title: { fontSize: 15, fontWeight: "700", color: ink.text, textAlign: "center", lineHeight: 22 },
  unit: { fontSize: 12, color: ink.faint, lineHeight: 18 },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: space.lg,
    rowGap: space.xs,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: space.xs },
  legendText: { fontSize: 13, color: ink.text, lineHeight: 20 },
  plotArea: { width: "100%" },
  placeholder: { height: 180 },
});
