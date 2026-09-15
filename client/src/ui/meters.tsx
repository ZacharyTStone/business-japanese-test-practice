/**
 * 失礼度メーター — the two-axis readout shown after a wrong answer.
 *
 * Two bars rather than one score, because the mistakes split cleanly in two and
 * a learner needs to know which one they made. Saying 「まだですか」 to a senior
 * is rude and perfectly clear; saying 「お召し上がりになられてください」 is
 * polite to a fault and still wrong. Collapsing those into "60% wrong" teaches
 * nothing.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { roleInfo } from "../lib/roles";
import { colors, radius, space, type } from "./theme";

function Bar({ label, value, tone }: { label: string; value: number; tone: string }) {
  const segments = [0, 1, 2];
  return (
    <View style={styles.barRow}>
      <Text style={[type.small, styles.barLabel]}>{label}</Text>
      <View style={styles.segments}>
        {segments.map((i) => (
          <View
            key={i}
            style={[
              styles.segment,
              { backgroundColor: i < value ? tone : colors.border },
            ]}
          />
        ))}
      </View>
      {/* The level is also written out, so the meter still reads with the
          colours removed or unseen. */}
      <Text style={[type.small, styles.barValue]}>{["なし", "小", "中", "大"][value] ?? "—"}</Text>
    </View>
  );
}

export function RudenessMeter({ role }: { role: string }) {
  const info = roleInfo(role);
  if (role === "correct") return null;

  return (
    <View style={styles.wrap}>
      <Text style={type.h2}>{info.label}</Text>
      <Bar label="失礼度" value={info.rudeness} tone={colors.wrong} />
      <Bar label="ずれ" value={info.miss} tone={colors.warn} />
      <Text style={[type.small, { marginTop: space.xs }]}>{info.advice}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.wrongSoft,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  barRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  barLabel: { width: 48 },
  barValue: { width: 32, textAlign: "right" },
  segments: { flex: 1, flexDirection: "row", gap: 4 },
  segment: { flex: 1, height: 8, borderRadius: 4 },
});
