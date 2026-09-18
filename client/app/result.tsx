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

import { fetchSectionLevels, hasAdFree } from "../src/lib/db";
import { useLang } from "../src/lib/i18n";
import { levelMove, SECTION_NAME } from "../src/lib/levels";
import { roleInfo, worstTrap } from "../src/lib/roles";
import { clearSummary, takeSummary } from "../src/lib/session";
import type { SectionLevel } from "../src/lib/types";
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
import { FadeIn } from "../src/ui/motion";
import { colors, space, tabular, type } from "../src/ui/theme";

export default function Result() {
  const router = useRouter();
  const { lang, t } = useLang();
  const [summary] = useState(() => takeSummary());
  const [adFree, setAdFree] = useState(true); // assume paid until told otherwise
  const [levelsNow, setLevelsNow] = useState<SectionLevel[]>([]);

  useEffect(() => {
    hasAdFree().then(setAdFree);
    // The database may have moved a section's level on one of this set's
    // answers. That is the one thing worth a card of its own here, and it is
    // read back rather than computed, because the rule lives in the trigger and
    // nowhere else.
    fetchSectionLevels()
      .then(setLevelsNow)
      .catch(() => setLevelsNow([]));
    return () => clearSummary();
  }, []);

  if (!summary) {
    return (
      <View style={styles.page}>
        <Notice title={t("no_result_title")} body={t("no_result_body")} />
        <Button label={t("to_home")} onPress={() => router.replace("/")} />
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

  // Which SECTION moved, not merely that something did. "聴解のレベルが上がりま
  // した" is a fact somebody can act on; "レベルが上がりました" leaves them
  // guessing which third of the exam it was about.
  const move = levelsNow.length ? levelMove(summary.levelsBefore, levelsNow) : null;
  const sectionName = move ? t(SECTION_NAME[move.section]) : "";

  // The cards land one after another, top to bottom, a beat apart: the score
  // first, then what to take from it. A whole screen arriving at once is a
  // page load; a sequence is a result being read out.
  let beat = 0;
  const step = () => (beat += 70);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {move && move.direction > 0 ? (
        <Card style={{ backgroundColor: colors.correctSoft, gap: space.md }}>
          <View style={styles.trapHead}>
            <IconBadge name="spark" tone="teal" />
            <View style={{ flex: 1 }}>
              <Text style={[type.h2, { color: colors.correct }]}>
                {t("level_up_sec", { section: sectionName })}
              </Text>
              <Text style={type.small}>
                {t("level_up_sec_body", {
                  section: sectionName,
                  a: move.from,
                  b: move.to,
                })}
              </Text>
            </View>
          </View>
        </Card>
      ) : move ? (
        <Card style={{ gap: space.md }}>
          <View style={styles.trapHead}>
            <IconBadge name="layers" tone="blue" />
            <View style={{ flex: 1 }}>
              <Text style={type.h2}>{t("level_down_sec", { section: sectionName })}</Text>
              <Text style={type.small}>
                {t("level_down_sec_body", { section: sectionName, b: move.to })}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      <FadeIn delay={beat}>
        <GradientCard style={styles.hero}>
          <ProgressRing
            value={total > 0 ? correct / total : 0}
            size={96}
            label={`${correct}/${total}`}
            caption={t("ring_correct")}
          />
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={styles.heroLabel}>{t("mode_this")}</Text>
            <Text style={styles.heroTitle}>{t("n_correct", { n: correct })}</Text>
            <Text style={styles.heroSub}>{t("n_min", { total, min: minutes })}</Text>
          </View>
        </GradientCard>
      </FadeIn>

      {trap ? (
        <FadeIn delay={step()}>
          <Card style={{ gap: space.md }}>
            <View style={styles.trapHead}>
              <IconBadge name="alert" tone="pink" />
              <View style={{ flex: 1 }}>
                <Text style={type.small}>{t("top_mistake")}</Text>
                <Text style={type.h2}>{roleInfo(trap.role, lang).label}</Text>
              </View>
            </View>
            <Text style={type.small}>{roleInfo(trap.role, lang).advice}</Text>
          </Card>
        </FadeIn>
      ) : correct === total ? (
        <FadeIn delay={step()}>
          <Card style={{ backgroundColor: colors.correctSoft }}>
            <View style={styles.trapHead}>
              <IconBadge name="check" tone="teal" />
              <Text style={[type.h2, { color: colors.correct, flex: 1 }]}>{t("all_correct")}</Text>
            </View>
            <Text style={[type.small, { marginTop: space.sm }]}>{t("all_correct_body")}</Text>
          </Card>
        </FadeIn>
      ) : null}

      <FadeIn delay={step()} style={{ gap: space.sm }}>
        <SectionLabel>{t("breakdown")}</SectionLabel>
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
          {correct < total ? (
            // The promise the daily set keeps: a miss comes back after a night,
            // not immediately and not never. See next_items, bucket 0.
            <Text style={[type.small, { marginTop: space.xs }]}>{t("retry_promise")}</Text>
          ) : null}
        </Card>
      </FadeIn>

      {/* The one place an ad is allowed, along with the list screens. Never
          during listening practice. */}
      <AdSlot placement="session_result" enabled={!adFree} />

      <FadeIn delay={step()} style={{ gap: space.md }}>
        <Button label={t("to_home")} onPress={() => router.replace("/")} />
        <Button
          label={t("review_wrong")}
          tone="secondary"
          onPress={() => router.replace("/history")}
        />
      </FadeIn>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  hero: { flexDirection: "row", alignItems: "center", gap: space.lg },
  heroLabel: { color: colors.onAccentMuted, fontSize: 13, fontWeight: "700", letterSpacing: 0.6 },
  heroTitle: {
    color: colors.onAccent,
    fontSize: 26,
    fontWeight: "700",
    lineHeight: 36,
    letterSpacing: -0.3,
    ...tabular,
  },
  heroSub: { color: colors.onAccentMuted, fontSize: 13, ...tabular },
  trapHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  row: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  rowMark: { width: 18, fontSize: 14, fontWeight: "700" },
});
