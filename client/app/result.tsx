/**
 * What just happened, and the one thing to take away from it.
 *
 * No estimated BJT score appears here, or anywhere. There is no IRT calibration
 * for generated items, so a number out of 800 would be invented — and an invented
 * score is worse than none, because people plan around it. What is shown instead
 * is the count, and the trap that caught them most, which is true and actionable.
 */
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { hasAdFree } from "../src/lib/db";
import { roleInfo, worstTrap } from "../src/lib/roles";
import { clearSummary, takeSummary } from "../src/lib/session";
import { AdSlot, Button, Card, Notice } from "../src/ui/components";
import { colors, space, type } from "../src/ui/theme";

export default function Result() {
  const router = useRouter();
  const [summary] = useState(() => takeSummary());
  const [adFree, setAdFree] = useState(true); // assume paid until told otherwise

  useEffect(() => {
    hasAdFree().then(setAdFree);
    return () => clearSummary();
  }, []);

  if (!summary) {
    return (
      <View style={styles.page}>
        <Notice title="結果がありません" body="練習を始めると、ここに結果が出ます。" />
        <Button label="ホームへ" onPress={() => router.replace("/")} />
      </View>
    );
  }

  const total = summary.answers.length;
  const correct = summary.answers.filter((a) => a.isCorrect).length;
  const minutes = Math.max(1, Math.round((summary.finishedAt - summary.startedAt) / 60000));
  const trap = worstTrap(
    summary.answers
      .filter((a) => !a.isCorrect)
      .map((a) => a.item.options[a.chosenIndex]?.role ?? "")
  );

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card style={{ gap: space.sm, alignItems: "center" }}>
        <Text style={type.small}>今回</Text>
        <Text style={type.h1}>
          {correct} / {total} 問
        </Text>
        <Text style={type.small}>{minutes}分</Text>
      </Card>

      {trap ? (
        <Card style={{ gap: space.sm }}>
          <Text style={type.small}>今回よく落ちた罠</Text>
          <Text style={type.h2}>{roleInfo(trap.role).label}</Text>
          <Text style={type.small}>{roleInfo(trap.role).advice}</Text>
        </Card>
      ) : correct === total ? (
        <Card style={{ backgroundColor: colors.correctSoft, borderColor: colors.correctSoft }}>
          <Text style={[type.h2, { color: colors.correct }]}>全問正解です</Text>
          <Text style={[type.small, { marginTop: space.xs }]}>
            同じ場面でも、相手が変わると答えは変わります。明日も続けましょう。
          </Text>
        </Card>
      ) : null}

      <View style={{ gap: space.sm }}>
        {summary.answers.map((a, i) => (
          <View key={a.item.id} style={styles.row}>
            <Text style={[type.small, styles.rowMark, { color: a.isCorrect ? colors.correct : colors.wrong }]}>
              {a.isCorrect ? "○" : "×"}
            </Text>
            <Text style={[type.small, { flex: 1 }]}>
              {i + 1}. {a.item.topic}
            </Text>
          </View>
        ))}
      </View>

      {/* The one place an ad is allowed, along with the list screens. Never
          during listening practice. */}
      <AdSlot placement="session_result" enabled={!adFree} />

      <View style={{ gap: space.md }}>
        <Button label="ホームへ" onPress={() => router.replace("/")} />
        <Button label="記録を見る" tone="secondary" onPress={() => router.replace("/progress")} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  row: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  rowMark: { width: 16 },
});
