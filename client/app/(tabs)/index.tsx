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
 * Under it, nothing. There used to be a card here narrating what the app had
 * noticed and what it was doing about it — the level rule, the tag it judged
 * weak, how many answers until it would have an opinion. None of it was
 * anything to act on: the queue already puts those items first, and a person
 * who came to answer five questions does not need the machinery described to
 * them on the way past. The statistics live on 記録; the start screen explains
 * the plan once. Home starts the set.
 */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../../src/lib/auth";
import {
  fetchAnsweredToday,
  fetchProfile,
  fetchSectionLevels,
  fetchStreak,
} from "../../src/lib/db";
import { countdownLine, daysUntil } from "../../src/lib/exam";
import { useLang } from "../../src/lib/i18n";
import { levelsAgree, placedLevels, SECTION_SHORT } from "../../src/lib/levels";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../../src/lib/supabase";
import type { Profile, SectionLevel } from "../../src/lib/types";
import {
  Button,
  GradientCard,
  Loading,
  Notice,
  ProgressRing,
  ScreenHeader,
  ScreenMessage,
} from "../../src/ui/components";
import { Icon } from "../../src/ui/icons";
import { colors, space, TAB_CLEARANCE, type } from "../../src/ui/theme";

export default function Home() {
  const router = useRouter();
  const { lang, t } = useLang();
  const { loading: authLoading, error: authError } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState(0);
  const [today, setToday] = useState(0);
  const [levels, setLevels] = useState<SectionLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!isConfigured || authLoading) return;
      let cancelled = false;
      (async () => {
        try {
          const [p, s, t, lv] = await Promise.all([
            fetchProfile(),
            fetchStreak(),
            fetchAnsweredToday(),
            fetchSectionLevels(),
          ]);
          if (cancelled) return;
          setProfile(p);
          setStreak(s);
          setToday(t);
          setLevels(lv);
        } catch (e) {
          // Without this the screen sat on its spinner for ever when the record
          // failed to load, which looks exactly like an app that has hung.
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [authLoading, reloads])
  );

  function retry() {
    setError(null);
    setLoading(true);
    setReloads((n) => n + 1);
  }

  if (!isConfigured) {
    return (
      <ScreenMessage>
        <Notice title={t("config_needed")} body={MISSING_CONFIG_MESSAGE} tone="warn" />
      </ScreenMessage>
    );
  }
  if (authLoading || loading) return <Loading label={t("loading")} />;
  if (authError) {
    return (
      <ScreenMessage>
        <Notice title={t("cant_connect")} body={authError} tone="warn" />
      </ScreenMessage>
    );
  }
  if (error) {
    return (
      <ScreenMessage>
        <Notice
          title={t("cant_load")}
          body={error}
          tone="warn"
          action={{ label: t("retry"), onPress: retry }}
        />
      </ScreenMessage>
    );
  }

  const goal = profile?.daily_goal ?? 5;
  const done = Math.min(today, goal);
  const countdown = countdownLine(daysUntil(profile?.exam_date), lang);

  // Only sections the database has placed get named. A new account has none,
  // so this line is simply absent rather than announcing a level nobody has
  // earned — and it fills in section by section as the evidence arrives.
  // One number while the placed sections agree; the three the moment they
  // diverge, because by then the split IS the news.
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
    <ScrollView contentContainerStyle={styles.page}>
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

      {/* Two cards, not one card with a full ring in it. A day's work that is
          finished is a different thing from a day's work in progress, and a
          counter reading 5 / 5 beside a circle filled to the brim is the app
          still asking to be read as a target when there is nothing left to
          aim at. Done says done, and the extra set is offered quietly, which
          is the weight it deserves: it is a bonus, not the job. */}
      {done >= goal ? (
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
            tone="secondary"
            icon="play"
            onPress={() => router.push("/practice")}
          />
        </GradientCard>
      ) : (
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

          <Button
            label={t("btn_today")}
            sub={t("btn_today_sub", { goal })}
            tone="onAccent"
            icon="play"
            onPress={() => router.push("/practice")}
          />
        </GradientCard>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.lg, paddingBottom: TAB_CLEARANCE, gap: space.lg },
  heroRow: { flexDirection: "row", alignItems: "center", gap: space.lg },
  heroLabel: { color: colors.onAccentMuted, fontSize: 13, fontWeight: "700", letterSpacing: 0.6 },
  heroTitle: { color: colors.onAccent, fontSize: 30, fontWeight: "700", lineHeight: 40 },
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
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  streakText: { fontSize: 13, fontWeight: "700", color: colors.text },
});
