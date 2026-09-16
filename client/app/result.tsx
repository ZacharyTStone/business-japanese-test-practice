/**
 * What just happened, and the one thing to take away from it.
 *
 * No estimated BJT score appears here, or anywhere. There is no IRT calibration
 * for generated items, so a number out of 800 would be invented — and an invented
 * score is worse than none, because people plan around it. What is shown instead
 * is how many of *these* questions were right, and the trap that caught them
 * most, which is true and actionable.
 */
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { hasAdFree } from "../src/lib/db";
import { roleInfo, worstTrap } from "../src/lib/roles";
import { clearSummary, takeSummary } from "../src/lib/session";
import {
  AdSlot,
  Button,
  Card,
  GradientCard,
  IconBadge,
  Notice,
  ProgressRing,
  SectionLabel,
} from "../src/ui/components";
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
      <GradientCard style={styles.hero}>
        <ProgressRing
          value={total > 0 ? correct / total : 0}
          size={96}
          label={`${correct}/${total}`}
          caption="正解"
        />
        <View style={{ flex: 1, gap: space.xs }}>
          <Text style={styles.heroLabel}>{summary.mode === "mock" ? "模試" : "今回"}</Text>
          <Text style={styles.heroTitle}>{correct}問 正解</Text>
          <Text style={styles.heroSub}>
            {total}問・{minutes}分
          </Text>
        </View>
      </GradientCard>

      {summary.mode === "mock" ? (
        <Card style={{ gap: space.xs }}>
          <Text style={type.small}>点数の予測は出していません</Text>
          <Text style={type.body}>
            ここにある問題は本番の問題ではなく、何点に当たるかを換算する根拠がありません。
            正答数と、下に出ている「落ちた罠」のほうが、次に何をすればよいかをはっきり示します。
          </Text>
        </Card>
      ) : null}

      {trap ? (
        <Card style={{ gap: space.md }}>
          <View style={styles.trapHead}>
            <IconBadge name="alert" tone="pink" />
            <View style={{ flex: 1 }}>
              <Text style={type.small}>今回よく落ちた罠</Text>
              <Text style={type.h2}>{roleInfo(trap.role).label}</Text>
            </View>
          </View>
          <Text style={type.small}>{roleInfo(trap.role).advice}</Text>
        </Card>
      ) : correct === total ? (
        <Card style={{ backgroundColor: colors.correctSoft }}>
          <View style={styles.trapHead}>
            <IconBadge name="check" tone="teal" />
            <Text style={[type.h2, { color: colors.correct, flex: 1 }]}>全問正解です</Text>
          </View>
          <Text style={[type.small, { marginTop: space.sm }]}>
            同じ場面でも、相手が変わると答えは変わります。明日も続けましょう。
          </Text>
        </Card>
      ) : null}

      <View style={{ gap: space.sm }}>
        <SectionLabel>この回の内訳</SectionLabel>
        <Card style={{ gap: space.md }}>
          {summary.answers.map((a, i) => (
            <View key={a.item.id} style={styles.row}>
              <Text
                style={[
                  styles.rowMark,
                  { color: a.isCorrect ? colors.correct : colors.wrong },
                ]}
              >
                {a.isCorrect ? "○" : "×"}
              </Text>
              <Text style={[type.small, { flex: 1 }]}>
                {i + 1}. {a.item.topic}
              </Text>
            </View>
          ))}
        </Card>
      </View>

      {/* The one place an ad is allowed, along with the list screens. Never
          during listening practice. */}
      <AdSlot placement="session_result" enabled={!adFree} />

      <View style={{ gap: space.md }}>
        <Button label="ホームへ" onPress={() => router.replace("/")} />
        <Button
          label="まちがえた問題を見返す"
          tone="secondary"
          onPress={() => router.replace("/history")}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  hero: { flexDirection: "row", alignItems: "center", gap: space.lg },
  heroLabel: { color: colors.onAccentMuted, fontSize: 13, fontWeight: "700", letterSpacing: 0.6 },
  heroTitle: { color: colors.onAccent, fontSize: 26, fontWeight: "700", lineHeight: 36 },
  heroSub: { color: colors.onAccentMuted, fontSize: 13 },
  trapHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  row: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  rowMark: { width: 18, fontSize: 14, fontWeight: "700" },
});
