/**
 * Home. One decision: start today's set.
 *
 * The hero is the decision and nothing else. There is one button, because the
 * app already knows what to serve — the level, the weak spots, the items to
 * retry and the one stretch question are all decided in the database from the
 * record. A person who opens the app to practise should not first have to
 * choose a level, a type, or a mode, and in this app there is nowhere they
 * could: this button is the only way to a question.
 *
 * Under it, nothing. What the app has noticed is nothing to act on — the queue
 * already acts on it — so it is not narrated here. The statistics live on 記録;
 * the start screen explains the plan once. Home starts the set.
 */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  fetchDay,
  fetchPace,
  fetchProfile,
  fetchRecentPace,
  fetchReviewLoad,
  fetchSectionLevels,
  fetchStreak,
} from "../../src/lib/db";
import { minutesFor, secondsPerQuestion } from "../../src/lib/estimate";
import { countdownLine, daysUntil } from "../../src/lib/exam";
import { useLang } from "../../src/lib/i18n";
import { levelsAgree, placedLevels, SECTION_SHORT } from "../../src/lib/levels";
import type { DayStatus, Profile, SectionLevel } from "../../src/lib/types";
import {
  Button,
  GradientCard,
  Loading,
  LoadFailed,
  ProgressRing,
  ScreenHeader,
  ScreenMessage,
} from "../../src/ui/components";
import { ScreenGate } from "../../src/ui/screen";
import { DayDone } from "../../src/ui/done";
import { Icon } from "../../src/ui/icons";
import { useFreshToday } from "../../src/ui/fresh";
import { FadeIn } from "../../src/ui/motion";
import { useTabClearance } from "../../src/ui/tabbar";
import { colors, shadow, space, tabular, type } from "../../src/ui/theme";

/** Behind the setup notice when no project is configured (ui/screen.tsx). */
export default function HomeScreen() {
  return (
    <ScreenGate>
      <Home />
    </ScreenGate>
  );
}

function Home() {
  const clearance = useTabClearance();
  const router = useRouter();
  const { lang, t } = useLang();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState(0);
  const [day, setDay] = useState<DayStatus | null>(null);
  const [levels, setLevels] = useState<SectionLevel[]>([]);
  // Lessons due for a 類題. Furniture: the button works without it.
  const [due, setDue] = useState(0);
  // Seconds a question takes this learner (lib/estimate.ts). Furniture too:
  // without it the button says the exam's reading pace.
  const [perQuestion, setPerQuestion] = useState(() => secondsPerQuestion([], []));
  const [loading, setLoading] = useState(true);
  /** A load that failed, kept whole so it is said in the learner's words and
   *  language at render time (LoadFailed), not frozen as technical text. */
  const [error, setError] = useState<unknown>(null);
  const [reloads, setReloads] = useState(0);
  /** When today's numbers were read: what decides whether coming back to the
   *  app should read them again (ui/fresh.ts). */
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const [p, s, d, lv, load, recent, pace] = await Promise.all([
            fetchProfile(),
            fetchStreak(),
            fetchDay(),
            fetchSectionLevels(),
            fetchReviewLoad().catch(() => null),
            fetchRecentPace().catch(() => []),
            fetchPace().catch(() => ({})),
          ]);
          if (cancelled) return;
          setProfile(p);
          setStreak(s);
          setDay(d);
          setLevels(lv);
          setDue(load?.due_now ?? 0);
          setPerQuestion(
            secondsPerQuestion(
              recent,
              Object.values(pace).map((budget) => budget.seconds)
            )
          );
          setLoadedAt(Date.now());
        } catch (e) {
          // A spinner that never ends looks exactly like an app that has hung.
          if (!cancelled) setError(e ?? "error");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [reloads])
  );

  function retry() {
    setError(null);
    setLoading(true);
    setReloads((n) => n + 1);
  }

  // Past midnight in Japan the day's count starts again. Read quietly, with
  // what is on screen left there until the new numbers arrive.
  useFreshToday(loadedAt, () => setReloads((n) => n + 1));

  if (loading) return <Loading label={t("loading")} />;
  if (error != null) {
    return (
      <ScreenMessage>
        <LoadFailed error={error} onRetry={retry} />
      </ScreenMessage>
    );
  }

  // Three states, decided by the database's own count of today (v_my_day):
  // the day's set still open; the set done and a bonus set on offer; and the
  // ceiling reached, which is a full stop rather than a dimmer button. An
  // account with the ceiling lifted never reaches the third.
  const goal = day?.goal ?? profile?.daily_goal ?? 10;
  const answered = day?.answered_today ?? 0;
  const done = Math.min(answered, goal);
  const blocked = day != null && !day.unlimited && (day.left_today ?? 0) <= 0;
  const bonus = day?.unlimited ? goal : (day?.left_today ?? 0);
  const countdown = countdownLine(daysUntil(profile?.exam_date), lang);

  // Only sections the database has placed get named, so a new account has no
  // line here rather than a level nobody has earned. One number while the
  // placed sections agree; each of them the moment they diverge, because by
  // then the split IS the news.
  const placed = placedLevels(levels);
  const levelLine =
    placed.length === 0
      ? undefined
      : levelsAgree(placed)
        ? t("level_line", { level: placed[0].level })
        : t("level_split", {
            levels: placed.map((l) => `${t(SECTION_SHORT[l.section])} ${l.level}`).join("・"),
          });

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: clearance }]}>
      <ScreenHeader
        title={t("tab_home")}
        subtitle={levelLine}
        right={
          streak > 0 ? (
            <View style={styles.streakPill}>
              <Icon name="flame" size={16} color={colors.warn} strokeWidth={2} />
              <Text style={styles.streakText}>{t("streak_days", { n: streak })}</Text>
            </View>
          ) : undefined
        }
      />

      {/* Two cards, not one card with a full ring in it: a counter at its goal
          beside a filled circle still reads as a target when there is nothing
          left to aim at. Done says done, and the extra set is offered quietly,
          because it is a bonus, not the job. */}
      {blocked ? (
        <FadeIn>
          <DayDone
            answered={answered}
            streak={streak}
            countdown={countdown ?? undefined}
            action={{ label: t("review_btn"), onPress: () => router.push("/history") }}
          />
        </FadeIn>
      ) : done >= goal ? (
        <FadeIn>
          <GradientCard style={{ gap: space.lg }}>
            <View style={styles.heroRow}>
              <View style={styles.doneMark}>
                <Icon name="check" size={30} color={colors.onAccent} strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text style={styles.heroLabel}>{countdown ?? t("today")}</Text>
                <Text style={styles.heroTitle}>{t("today_done")}</Text>
                {streak > 0 ? (
                  <Text style={styles.heroSub}>{t("streak_going", { n: streak })}</Text>
                ) : null}
              </View>
            </View>

            <Button
              label={t("btn_more")}
              sub={t("btn_more_sub", { n: bonus })}
              tone="secondary"
              icon="play"
              onPress={() => router.push("/practice")}
            />
          </GradientCard>
        </FadeIn>
      ) : (
        <FadeIn>
          <GradientCard style={{ gap: space.lg }}>
            <View style={styles.heroRow}>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text style={styles.heroLabel}>{countdown ?? t("today")}</Text>
                <Text style={styles.heroTitle}>
                  {done} / {goal}
                </Text>
                <Text style={styles.heroSub}>
                  {streak > 0 ? t("streak_going", { n: streak }) : t("start_today")}
                </Text>
              </View>
              <ProgressRing
                value={goal > 0 ? done / goal : 0}
                label={`${Math.round((goal > 0 ? done / goal : 0) * 100)}%`}
                caption={t("today")}
                accessibilityLabel={t("goal_ring", { done, goal })}
              />
            </View>

            {/* Not a narration of the machinery — one number, because "ten
                questions, some of them on traps that caught you" is what the
                set is. The queue serves at most two fifths of a set as 類題. */}
            <Button
              label={t("btn_today")}
              sub={
                due > 0
                  ? t("btn_today_sub_due", { n: goal - done, min: minutesFor(goal - done, perQuestion), due })
                  : t("btn_today_sub", { n: goal - done, min: minutesFor(goal - done, perQuestion) })
              }
              tone="onAccent"
              icon="play"
              onPress={() => router.push("/practice")}
            />
          </GradientCard>
        </FadeIn>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.lg, gap: space.lg },
  heroRow: { flexDirection: "row", alignItems: "center", gap: space.lg },
  heroLabel: { color: colors.onAccentMuted, fontSize: 13, fontWeight: "700", letterSpacing: 0.6 },
  heroTitle: {
    color: colors.onAccent,
    fontSize: 30,
    fontWeight: "700",
    lineHeight: 40,
    letterSpacing: -0.4,
    ...tabular,
  },
  heroSub: { color: colors.onAccentMuted, fontSize: 13, lineHeight: 21 },
  doneMark: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  streakPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    ...shadow.card,
  },
  streakText: { fontSize: 13, fontWeight: "700", color: colors.text, ...tabular },
});
