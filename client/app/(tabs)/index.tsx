/**
 * Home. One decision: start today's set.
 *
 * The hero is the decision and nothing else. There is one button, because the
 * app already knows what to serve — the level, the weak spots, the items to
 * retry and the one stretch question are all decided in the database from the
 * record. A person who opens the app to practise should not first have to
 * choose a level, a type, or a mode. The 選ぶ tab is there for the week before
 * the exam; most days it is not needed.
 *
 * Under it is a record of what has already happened, which is the right way
 * round. Accuracy is shown as 「—」 until something has been answered: a zero
 * there would be a lie about a person who has not been asked yet.
 */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../../src/lib/auth";
import {
  fetchAnsweredToday,
  fetchProfile,
  fetchRoleTraps,
  fetchStreak,
  fetchTypeStats,
} from "../../src/lib/db";
import { countdownLine, daysUntil } from "../../src/lib/exam";
import { roleInfo } from "../../src/lib/roles";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../../src/lib/supabase";
import type { Profile, RoleTrap, TypeStat } from "../../src/lib/types";
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
  StatCard,
  Tag,
} from "../../src/ui/components";
import { Icon } from "../../src/ui/icons";
import { colors, space, TAB_CLEARANCE, type } from "../../src/ui/theme";

/** Below this, "your weakness" is noise rather than a signal. */
const MIN_ATTEMPTS_FOR_WEAKNESS = 10;

export default function Home() {
  const router = useRouter();
  const { loading: authLoading, isAnonymous, error: authError } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState(0);
  const [today, setToday] = useState(0);
  const [traps, setTraps] = useState<RoleTrap[]>([]);
  const [types, setTypes] = useState<TypeStat[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!isConfigured || authLoading) return;
      let cancelled = false;
      (async () => {
        try {
          const [p, s, t, r, ty] = await Promise.all([
            fetchProfile(),
            fetchStreak(),
            fetchAnsweredToday(),
            fetchRoleTraps(),
            fetchTypeStats(),
          ]);
          if (cancelled) return;
          setProfile(p);
          setStreak(s);
          setToday(t);
          setTraps(r);
          setTypes(ty);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [authLoading])
  );

  if (!isConfigured) {
    return (
      <ScreenMessage>
        <Notice title="設定が必要です" body={MISSING_CONFIG_MESSAGE} tone="warn" />
      </ScreenMessage>
    );
  }
  if (authLoading || loading) return <Loading label="読み込み中…" />;
  if (authError) {
    return (
      <ScreenMessage>
        <Notice title="接続できません" body={authError} tone="warn" />
      </ScreenMessage>
    );
  }

  const goal = profile?.daily_goal ?? 5;
  const done = Math.min(today, goal);
  const trapTotal = traps.reduce((n, t) => n + t.times_chosen, 0);
  const topTrap = traps[0];
  const countdown = countdownLine(daysUntil(profile?.exam_date));

  const answered = types.reduce((n, t) => n + t.answered, 0);
  const correct = types.reduce((n, t) => n + t.correct, 0);
  const started = types.filter((t) => t.answered > 0).length;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenHeader
        title="ホーム"
        subtitle={`いまのレベル ${profile?.target_level ?? "J2"}・正解が続くと上がります`}
        right={
          streak > 0 ? (
            <View style={styles.streakPill}>
              <Icon name="flame" size={16} color={colors.warn} strokeWidth={2} />
              <Text style={styles.streakText}>{streak}日</Text>
            </View>
          ) : undefined
        }
      />

      <GradientCard style={{ gap: space.lg }}>
        <View style={styles.heroRow}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={styles.heroLabel}>{countdown ?? "今日"}</Text>
            <Text style={styles.heroTitle}>
              {done} / {goal} 問
            </Text>
            <Text style={styles.heroSub}>
              {done >= goal
                ? "今日のぶんは終わりました"
                : streak > 0
                  ? `${streak}日つづいています`
                  : "今日から始めましょう"}
            </Text>
          </View>
          <ProgressRing
            value={goal > 0 ? done / goal : 0}
            label={`${Math.round((goal > 0 ? done / goal : 0) * 100)}%`}
            caption="今日"
          />
        </View>

        <Button
          label={done >= goal ? "もう一組やる" : "今日の練習をする"}
          sub={`${goal}問・約3分・レベルも弱点もおまかせ`}
          tone="onAccent"
          icon="play"
          onPress={() => router.push({ pathname: "/practice", params: { mode: "daily" } })}
        />
      </GradientCard>

      <View style={{ gap: space.md }}>
        <SectionLabel>これまでの記録</SectionLabel>
        {answered === 0 ? (
          <Card style={{ gap: space.xs }}>
            <Text style={type.body}>まだ記録がありません。</Text>
            <Text style={type.small}>
              一組やってみると、正答率も、よく落ちるミスも、ここに出てきます。
            </Text>
          </Card>
        ) : (
          <View style={styles.grid}>
            <StatCard name="flame" tone="amber" label="連続日数" value={`${streak}日`} />
            <StatCard name="book" tone="blue" label="解いた問題" value={`${answered}問`} />
            <StatCard
              name="target"
              tone="teal"
              label="全体の正答率"
              value={`${Math.round((correct / answered) * 100)}%`}
            />
            <StatCard name="grid" tone="pink" label="取り組んだ種類" value={`${started} / 9`} />
          </View>
        )}
      </View>

      {trapTotal >= MIN_ATTEMPTS_FOR_WEAKNESS && topTrap ? (
        <Card style={{ gap: space.md }}>
          <View style={styles.trapHead}>
            <IconBadge name="alert" tone="pink" />
            <View style={{ flex: 1 }}>
              <Text style={type.small}>いま一番多いミス</Text>
              <Text style={type.h2}>{roleInfo(topTrap.role).label}</Text>
            </View>
            <Tag tone="pink">{topTrap.times_chosen}回</Tag>
          </View>
          <Text style={type.small}>
            {roleInfo(topTrap.role).advice} 今日の練習に、自動で入ります。
          </Text>
        </Card>
      ) : null}

      {isAnonymous ? (
        <Card style={{ gap: space.md }}>
          <View style={styles.trapHead}>
            <IconBadge name="user" tone="violet" />
            <View style={{ flex: 1 }}>
              <Text style={type.h2}>記録はこの端末だけ</Text>
              <Text style={type.small}>ログインなしで使えています。</Text>
            </View>
          </View>
          <Button label="記録を引き継ぐ" tone="secondary" onPress={() => router.push("/account")} />
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.lg, paddingBottom: TAB_CLEARANCE, gap: space.lg },
  heroRow: { flexDirection: "row", alignItems: "center", gap: space.lg },
  heroLabel: { color: colors.onAccentMuted, fontSize: 13, fontWeight: "700", letterSpacing: 0.6 },
  heroTitle: { color: colors.onAccent, fontSize: 30, fontWeight: "700", lineHeight: 40 },
  heroSub: { color: colors.onAccentMuted, fontSize: 13, lineHeight: 21 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
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
