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
 * Under it is one sentence: what the app noticed, and what it is doing about
 * it. The statistics live on the 記録 tab; home is not a dashboard.
 */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../../src/lib/auth";
import {
  fetchAnsweredToday,
  fetchProfile,
  fetchReviewLoad,
  fetchSectionLevels,
  fetchRoleTraps,
  fetchStreak,
  fetchTagStats,
  fetchTypeStats,
} from "../../src/lib/db";
import { countdownLine, daysUntil } from "../../src/lib/exam";
import { useLang, type Key, type Lang } from "../../src/lib/i18n";
import { levelsAgree, SECTION_SHORT, sortLevels } from "../../src/lib/levels";
import { roleInfo } from "../../src/lib/roles";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../../src/lib/supabase";
import type {
  Profile,
  ReviewLoad,
  RoleTrap,
  SectionLevel,
  TagStat,
  TypeStat,
} from "../../src/lib/types";
import {
  Button,
  Card,
  GradientCard,
  IconBadge,
  Loading,
  Notice,
  ProgressRing,
  ScreenHeader,
  ScreenMessage,
  SectionLabel,
} from "../../src/ui/components";
import { Icon } from "../../src/ui/icons";
import { colors, space, TAB_CLEARANCE, type } from "../../src/ui/theme";

/** Below this, "your weakness" is noise rather than a signal. */
const MIN_ATTEMPTS_FOR_WEAKNESS = 10;
/** A tag needs this many answers before it is called weak. */
const MIN_ANSWERS_PER_TAG = 4;

/**
 * The one sentence the app says about its plan.
 *
 * All the thinking happens in the database — the level, the retries, the
 * weakest tag, the stretch item — and none of it needs a dashboard. What a
 * person needs is to know that it happened. So: one line, in their words, that
 * says what the app noticed and what it is doing about it. Nothing here is a
 * number to plan around; it is the app explaining itself.
 */
function plan(
  lang: Lang,
  t: (key: Key, vars?: Record<string, string | number>) => string,
  answered: number,
  due: number,
  tags: TagStat[],
  traps: RoleTrap[],
  onStretch: boolean
): string {
  if (answered === 0) return t("plan_first");
  // Above the weakness lines on purpose: due reviews are a fact about today,
  // and "three are waiting" beats "eight more answers and I will have an
  // opinion" for somebody deciding whether to open the app now.
  if (due > 0) return t("plan_due", { n: due });
  if (answered < MIN_ATTEMPTS_FOR_WEAKNESS) {
    return t("plan_watching", { n: MIN_ATTEMPTS_FOR_WEAKNESS - answered });
  }
  const weak = tags
    .filter((x) => x.answered >= MIN_ANSWERS_PER_TAG && x.accuracy < 0.7)
    .sort((a, b) => a.accuracy - b.accuracy)[0];
  if (weak) return t("plan_weak", { tag: weak.tag, pct: Math.round(weak.accuracy * 100) });
  const trap = traps[0];
  if (trap && trap.times_chosen >= 3) {
    return t("plan_trap", { label: roleInfo(trap.role, lang).label });
  }
  return t(onStretch ? "plan_stretch" : "plan_good");
}

export default function Home() {
  const router = useRouter();
  const { lang, t } = useLang();
  const { loading: authLoading, error: authError } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState(0);
  const [today, setToday] = useState(0);
  const [traps, setTraps] = useState<RoleTrap[]>([]);
  const [tags, setTags] = useState<TagStat[]>([]);
  const [types, setTypes] = useState<TypeStat[]>([]);
  const [review, setReview] = useState<ReviewLoad>({ due_now: 0, tracked: 0, next_due_at: null });
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
          const [p, s, t, r, tg, ty, rv, lv] = await Promise.all([
            fetchProfile(),
            fetchStreak(),
            fetchAnsweredToday(),
            fetchRoleTraps(),
            fetchTagStats(),
            fetchTypeStats(),
            fetchReviewLoad(),
            fetchSectionLevels(),
          ]);
          if (cancelled) return;
          setProfile(p);
          setStreak(s);
          setToday(t);
          setTraps(r);
          setTags(tg);
          setTypes(ty);
          setReview(rv);
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
  const answered = types.reduce((n, t) => n + t.answered, 0);
  const level = profile?.target_level ?? "J2";
  // One number while the three agree, which is how everybody starts; the three
  // the moment they diverge, because by then the split IS the news — "聴解 J3 ・
  // 読解 J1" is the single most useful sentence the app can put on this screen.
  const levelLine =
    levels.length === 3 && !levelsAgree(levels)
      ? t("level_split", {
          levels: sortLevels(levels)
            .map((l) => `${t(SECTION_SHORT[l.section])} ${l.level}`)
            .join("・"),
        })
      : t("level_line", { level });

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

      <GradientCard style={{ gap: space.lg }}>
        <View style={styles.heroRow}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={styles.heroLabel}>{countdown ?? t("today")}</Text>
            <Text style={styles.heroTitle}>
              {done} / {goal}
            </Text>
            <Text style={styles.heroSub}>
              {done >= goal
                ? t("today_done")
                : streak > 0
                  ? t("streak_going", { n: streak })
                  : t("start_today")}
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
          label={done >= goal ? t("btn_more") : t("btn_today")}
          sub={t("btn_today_sub", { goal })}
          tone="onAccent"
          icon="play"
          onPress={() => router.push("/practice")}
        />
      </GradientCard>

      <View style={{ gap: space.md }}>
        <SectionLabel>{t("thinking")}</SectionLabel>
        <Card style={{ gap: space.md }}>
          <View style={styles.trapHead}>
            <IconBadge name="spark" tone="violet" />
            <Text style={[type.body, { flex: 1 }]}>
              {plan(lang, t, answered, review.due_now, tags, traps, level !== "J1")}
            </Text>
          </View>
        </Card>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.lg, paddingBottom: TAB_CLEARANCE, gap: space.lg },
  heroRow: { flexDirection: "row", alignItems: "center", gap: space.lg },
  heroLabel: { color: colors.onAccentMuted, fontSize: 13, fontWeight: "700", letterSpacing: 0.6 },
  heroTitle: { color: colors.onAccent, fontSize: 30, fontWeight: "700", lineHeight: 40 },
  heroSub: { color: colors.onAccentMuted, fontSize: 13, lineHeight: 21 },
  trapHead: { flexDirection: "row", alignItems: "center", gap: space.md },
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
