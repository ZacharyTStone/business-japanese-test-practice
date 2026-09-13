/**
 * Home. One decision: start today's set.
 *
 * The weakness button is only offered once there is enough history for it to
 * mean anything. Before that it would just be a second button that does the same
 * thing, which teaches people to ignore both.
 */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../src/lib/auth";
import {
  fetchAnsweredToday,
  fetchProfile,
  fetchRoleTraps,
  fetchStreak,
} from "../src/lib/db";
import { roleInfo } from "../src/lib/roles";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/supabase";
import type { Profile, RoleTrap } from "../src/lib/types";
import { Button, Card, Loading, Notice } from "../src/ui/components";
import { colors, space, type } from "../src/ui/theme";

/** Below this, "your weakness" is noise rather than a signal. */
const MIN_ATTEMPTS_FOR_WEAKNESS = 10;

export default function Home() {
  const router = useRouter();
  const { loading: authLoading, isAnonymous, error: authError } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [streak, setStreak] = useState(0);
  const [today, setToday] = useState(0);
  const [traps, setTraps] = useState<RoleTrap[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!isConfigured || authLoading) return;
      let cancelled = false;
      (async () => {
        try {
          const [p, s, t, r] = await Promise.all([
            fetchProfile(),
            fetchStreak(),
            fetchAnsweredToday(),
            fetchRoleTraps(),
          ]);
          if (cancelled) return;
          setProfile(p);
          setStreak(s);
          setToday(t);
          setTraps(r);
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
      <View style={styles.page}>
        <Notice title="設定が必要です" body={MISSING_CONFIG_MESSAGE} />
      </View>
    );
  }
  if (authLoading || loading) return <Loading label="読み込み中…" />;
  if (authError) {
    return (
      <View style={styles.page}>
        <Notice title="接続できません" body={authError} />
      </View>
    );
  }

  const goal = profile?.daily_goal ?? 5;
  const done = Math.min(today, goal);
  const trapTotal = traps.reduce((n, t) => n + t.times_chosen, 0);
  const topTrap = traps[0];

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card style={styles.hero}>
        <Text style={type.small}>今日</Text>
        <Text style={type.h1}>
          {done} / {goal} 問
        </Text>
        <View style={styles.dots}>
          {Array.from({ length: goal }).map((_, i) => (
            <View key={i} style={[styles.dot, i < done && styles.dotDone]} />
          ))}
        </View>
        <Text style={type.small}>
          {streak > 0 ? `${streak}日つづいています` : "今日から始めましょう"}
        </Text>
      </Card>

      <Button
        label={done >= goal ? "もう一組やる" : "今日の練習をする"}
        sub={`${goal}問・約3分`}
        onPress={() => router.push({ pathname: "/practice", params: { mode: "daily" } })}
      />

      {trapTotal >= MIN_ATTEMPTS_FOR_WEAKNESS && topTrap ? (
        <Card style={{ gap: space.md }}>
          <Text style={type.small}>いま一番よく落ちる罠</Text>
          <Text style={type.h2}>{roleInfo(topTrap.role).label}</Text>
          <Text style={type.small}>
            これまでに{topTrap.times_chosen}回選んでいます。{roleInfo(topTrap.role).advice}
          </Text>
          <Button
            label="この弱点を1つ倒す"
            tone="secondary"
            sub="苦手なタグから5問"
            onPress={() => router.push({ pathname: "/practice", params: { mode: "weakness" } })}
          />
        </Card>
      ) : null}

      <View style={styles.links}>
        <Button label="記録を見る" tone="secondary" onPress={() => router.push("/progress")} />
        <Button
          label={isAnonymous ? "記録を引き継ぐ" : "アカウント"}
          tone="secondary"
          sub={isAnonymous ? "ログインなしで使えています" : undefined}
          onPress={() => router.push("/account")}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.lg },
  hero: { gap: space.sm },
  dots: { flexDirection: "row", gap: 6, marginVertical: space.xs },
  dot: { width: 22, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotDone: { backgroundColor: colors.accent },
  links: { gap: space.md },
});
