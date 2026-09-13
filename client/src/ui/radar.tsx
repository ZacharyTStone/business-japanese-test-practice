/**
 * The nine-type radar.
 *
 * Every type is drawn whether or not it has been attempted, and an untried type
 * is marked as untried rather than plotted at zero. A chart that shows "0%" for
 * a section you have never opened is telling you something false, and it is the
 * exact lie that would push somebody to drill the thing they are already good at.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polygon, Text as SvgText } from "react-native-svg";

import type { TypeStat } from "../lib/types";
import { colors, space, type } from "./theme";

const SIZE = 260;
const CENTER = SIZE / 2;
const RADIUS = SIZE / 2 - 46;

function point(index: number, count: number, value: number) {
  // Start at 12 o'clock and go clockwise, so the first section is where the eye
  // lands first.
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  const r = RADIUS * Math.max(0.04, value);
  return { x: CENTER + r * Math.cos(angle), y: CENTER + r * Math.sin(angle) };
}

export function TypeRadar({ stats }: { stats: TypeStat[] }) {
  const n = stats.length;
  if (n < 3) return null;

  const filled = stats.map((s, i) => point(i, n, s.accuracy ?? 0));
  const polygon = filled.map((p) => `${p.x},${p.y}`).join(" ");
  const anyData = stats.some((s) => s.answered > 0);

  return (
    <View style={{ alignItems: "center" }}>
      <Svg width={SIZE} height={SIZE}>
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <Circle
            key={ring}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS * ring}
            stroke={colors.border}
            strokeWidth={1}
            fill="none"
          />
        ))}

        {stats.map((s, i) => {
          const spoke = point(i, n, 1);
          return (
            <Line
              key={s.item_type}
              x1={CENTER}
              y1={CENTER}
              x2={spoke.x}
              y2={spoke.y}
              stroke={colors.border}
              strokeWidth={1}
            />
          );
        })}

        {anyData ? (
          <Polygon points={polygon} fill={colors.accent} fillOpacity={0.18} stroke={colors.accent} strokeWidth={2} />
        ) : null}

        {stats.map((s, i) => {
          const at = point(i, n, 1);
          // Nudge the label outward so it clears the ring.
          const lx = CENTER + (at.x - CENTER) * 1.2;
          const ly = CENTER + (at.y - CENTER) * 1.2;
          const untried = s.answered === 0;
          return (
            <React.Fragment key={s.item_type}>
              {!untried ? (
                <Circle {...point(i, n, s.accuracy ?? 0)} r={3} fill={colors.accent} />
              ) : (
                // A hollow ring on the axis: present, but no data behind it.
                <Circle {...point(i, n, 1)} r={3} fill={colors.bg} stroke={colors.border} strokeWidth={1} />
              )}
              <SvgText
                x={lx}
                y={ly}
                fill={untried ? colors.muted : colors.text}
                fontSize={9}
                textAnchor="middle"
                alignmentBaseline="middle"
              >
                {s.label_ja.replace("問題", "")}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>

      {!anyData ? (
        <Text style={[type.small, { marginTop: space.sm }]}>
          まだ記録がありません。5問解くと形が出ます。
        </Text>
      ) : (
        <Text style={[type.small, styles.caption]}>
          白い丸はまだ解いていない種類です（0%ではありません）。
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { marginTop: space.sm, textAlign: "center" },
});
