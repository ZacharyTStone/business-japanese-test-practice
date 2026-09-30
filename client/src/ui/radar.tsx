/**
 * The nine-type radar.
 *
 * Every type is drawn whether or not it has been attempted, and an untried type
 * is marked as untried rather than plotted at zero. A chart that shows "0%" for
 * a section you have never opened is telling you something false, and it is the
 * exact lie that would push somebody to drill the thing they are already good at.
 * So the shape is drawn through the tried types only — an untried axis gets a
 * hollow ring at its rim and no corner of the polygon — and until three types
 * have been tried there is no polygon at all, only their dots.
 *
 * Sized to the card it is in rather than fixed: a 320pt phone leaves the card
 * about 256 wide, and a fixed 260 pushed the side labels over its edge.
 */
import React, { useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Polygon, Polyline, Text as SvgText } from "react-native-svg";

import { useLang } from "../lib/i18n";
import type { TypeStat } from "../lib/types";
import { colors, space, type } from "./theme";

/** The widest the chart grows: past this it is just a bigger picture. */
const MAX_SIZE = 300;
/** Before the first layout, and in a test with no layout at all. */
const FALLBACK_SIZE = 260;
/** The labels are text somebody reads, so they are at least this big. */
const LABEL_SIZE = 11;
/** Room outside the rim for a label of four or five kanji at that size. */
const LABEL_ROOM = 46;

function geometry(size: number) {
  const center = size / 2;
  const radius = Math.max(40, center - LABEL_ROOM);
  return {
    center,
    radius,
    /** Where a value lands on axis `index` of `count`: 12 o'clock first and
     *  clockwise, so the first section is where the eye lands first. */
    point(index: number, count: number, value: number) {
      const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
      const r = radius * Math.max(0, Math.min(1, value));
      return { x: center + r * Math.cos(angle), y: center + r * Math.sin(angle) };
    },
  };
}

/** What a screen reader says for the whole chart: every type and its share. */
export function radarDescription(stats: TypeStat[], t: ReturnType<typeof useLang>["t"]): string {
  const parts = stats.map((s) =>
    s.answered === 0 || s.accuracy === null
      ? `${s.label_ja} ${t("radar_untried")}`
      : `${s.label_ja} ${Math.round(s.accuracy * 100)}%`
  );
  return t("radar_a11y", { list: parts.join("、") });
}

export function TypeRadar({ stats }: { stats: TypeStat[] }) {
  const { t } = useLang();
  const [width, setWidth] = useState<number | null>(null);
  const n = stats.length;
  if (n < 3) return null;

  const size = Math.min(MAX_SIZE, width ?? FALLBACK_SIZE);
  const g = geometry(size);
  const tried = stats
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.answered > 0 && s.accuracy !== null);
  const corners = tried.map(({ s, i }) => g.point(i, n, s.accuracy ?? 0));
  const outline = corners.map((p) => `${p.x},${p.y}`).join(" ");

  function onLayout(e: LayoutChangeEvent) {
    const next = Math.floor(e.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  }

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <View accessible accessibilityRole="image" accessibilityLabel={radarDescription(stats, t)}>
        <Svg width={size} height={size}>
          {[0.25, 0.5, 0.75, 1].map((ring) => (
            <Circle
              key={ring}
              cx={g.center}
              cy={g.center}
              r={g.radius * ring}
              stroke={colors.border}
              strokeWidth={1}
              fill="none"
            />
          ))}

          {stats.map((s, i) => {
            const spoke = g.point(i, n, 1);
            return (
              <Line
                key={s.item_type}
                x1={g.center}
                y1={g.center}
                x2={spoke.x}
                y2={spoke.y}
                stroke={colors.border}
                strokeWidth={1}
              />
            );
          })}

          {corners.length >= 3 ? (
            <Polygon points={outline} fill={colors.accent} fillOpacity={0.18} stroke={colors.accent} strokeWidth={2} />
          ) : corners.length === 2 ? (
            <Polyline points={outline} fill="none" stroke={colors.accent} strokeWidth={2} />
          ) : null}

          {stats.map((s, i) => {
            const at = g.point(i, n, 1);
            // Nudge the label outward so it clears the rim.
            const lx = g.center + (at.x - g.center) * ((g.radius + LABEL_ROOM / 2) / g.radius);
            const ly = g.center + (at.y - g.center) * ((g.radius + LABEL_ROOM / 2) / g.radius);
            const untried = s.answered === 0 || s.accuracy === null;
            return (
              <React.Fragment key={s.item_type}>
                {!untried ? (
                  <Circle {...g.point(i, n, s.accuracy ?? 0)} r={3} fill={colors.accent} />
                ) : (
                  // A hollow ring on the rim: present, but no data behind it.
                  <Circle {...at} r={3} fill={colors.bg} stroke={colors.inputBorder} strokeWidth={1} />
                )}
                <SvgText
                  x={lx}
                  y={ly}
                  fill={untried ? colors.muted : colors.text}
                  fontSize={LABEL_SIZE}
                  textAnchor="middle"
                  alignmentBaseline="middle"
                >
                  {s.label_ja.replace("問題", "")}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      </View>

      {tried.length === 0 ? (
        <Text style={[type.small, { marginTop: space.sm }]}>{t("radar_empty")}</Text>
      ) : (
        <Text style={[type.small, styles.caption]}>{t("radar_caption")}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", alignSelf: "stretch" },
  caption: { marginTop: space.sm, textAlign: "center" },
});
