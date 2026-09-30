/**
 * Where you are in the set, and — on a reading question — how long is left.
 *
 * Stuck to the top of the practice screen's scroll (stickyHeaderIndices), so a
 * learner deep in a long passage still sees both: a clock that has scrolled
 * away is not pacing anybody.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useLang } from "../../lib/i18n";
import { QuestionClock } from "../clock";
import { ProgressBar, Tag } from "../components";
import { colors, space, tabular, type } from "../theme";

export function ProgressHeader({
  index,
  total,
  revealed,
  retest,
  again,
  clock,
  onHeight,
}: {
  index: number;
  total: number;
  /** The question on screen is answered: its share of the bar is filled. */
  revealed: boolean;
  /** A 類題: an unseen question re-testing a lesson that is due. */
  retest: boolean;
  /** A question met before. */
  again: boolean;
  /** The reading clock, on the questions that have one. */
  clock: { runKey: string; seconds: number; running: boolean; onExpire: () => void } | null;
  /** Told how tall this is, so a scroll to the verdict can clear it. */
  onHeight: (height: number) => void;
}) {
  const { t } = useLang();
  return (
    <View style={styles.header} onLayout={(e) => onHeight(e.nativeEvent.layout.height)}>
      <View
        style={styles.progressRow}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t("q_of_n", { i: index + 1, n: total })}
      >
        <Text style={[type.small, tabular]}>
          {index + 1} / {total}
        </Text>
        <ProgressBar value={(index + (revealed ? 1 : 0)) / total} height={6} style={{ flex: 1 }} />
        {retest ? (
          <Tag tone="violet">{t("retest_tag")}</Tag>
        ) : again ? (
          <Tag tone="amber">{t("again_tag")}</Tag>
        ) : null}
      </View>

      {/* The clock, on the reading questions only, directly under the counter:
          both of them answer "where am I", and both stay in view while the
          passage scrolls. It keeps running until the answer is in and then
          freezes at what was left, which is the number worth seeing on the way
          to the next question. */}
      {clock ? (
        <QuestionClock
          // A new question is a new clock, not the last one's leftovers.
          key={clock.runKey}
          seconds={clock.seconds}
          running={clock.running}
          runKey={clock.runKey}
          onExpire={clock.onExpire}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Its own background, out to the page's edges, so a passage scrolling under
  // it does not show through.
  header: {
    backgroundColor: colors.bg,
    marginHorizontal: -space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    marginVertical: -space.sm,
    gap: space.sm,
  },
  progressRow: { flexDirection: "row", alignItems: "center", gap: space.md },
});
