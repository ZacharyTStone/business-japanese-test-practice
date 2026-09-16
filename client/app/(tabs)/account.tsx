/**
 * The account screen, which mostly exists to explain why there isn't one yet.
 *
 * Linking is framed as "keep your record", not "sign up", because that is
 * literally what it does: the anonymous session already holds everything, and
 * Google is attached to the same user so nothing moves. The honest risk is
 * stated plainly too — an unlinked record lives on one device and goes with it.
 */
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../../src/lib/auth";
import { fetchItemTypes, fetchProfile, updateProfile } from "../../src/lib/db";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../../src/lib/supabase";
import type { Level, Profile } from "../../src/lib/types";
import {
  Button,
  Card,
  IconBadge,
  Loading,
  Notice,
  ScreenHeader,
  ScreenMessage,
  SectionLabel,
  Tag,
} from "../../src/ui/components";
import { Icon } from "../../src/ui/icons";
import { colors, radius, shadow, space, TAB_CLEARANCE, type } from "../../src/ui/theme";

const LEVELS: Level[] = ["J3", "J2", "J1"];
const LEVEL_HINT: Record<Level, string> = {
  J3: "決まった場面の、型どおりのやりとり",
  J2: "ふつうの業務。相手や立場で敬語が変わる",
  J1: "遠回しな言い方や、例外的な場面まで",
};

type Coverage = { types: number; total: number };

export default function Account() {
  const router = useRouter();
  const {
    isAnonymous,
    email,
    linkGoogle,
    signOut,
    loading: authLoading,
    error: authError,
  } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Record<Level, Coverage> | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!isConfigured || authLoading || authError) return;
    fetchProfile()
      .then(setProfile)
      .catch((e) => setProfileError(e instanceof Error ? e.message : String(e)));
  }, [isAnonymous, authLoading, authError, reloads]);

  // Coverage is shown, not hidden, for the same reason the type picker shows
  // "0問": a level with content in one of nine types should say so before
  // somebody sets it as their target and wonders why daily practice went quiet.
  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await Promise.all(LEVELS.map((level) => fetchItemTypes(level)));
        if (cancelled) return;
        const next = {} as Record<Level, Coverage>;
        LEVELS.forEach((level, i) => {
          const types = rows[i];
          next[level] = {
            types: types.filter((t) => t.available > 0).length,
            total: types.reduce((n, t) => n + t.available, 0),
          };
        });
        setCoverage(next);
      } catch {
        // A missing count is not worth an error screen: the picker still works,
        // it just says less. The profile load above is the one that matters.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloads]);

  async function onLink() {
    setBusy(true);
    setError(null);
    try {
      await linkGoogle();
      setProfile(await fetchProfile());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function setLevel(level: Level) {
    setProfile((p) => (p ? { ...p, target_level: level } : p));
    await updateProfile({ target_level: level });
  }

  function retry() {
    setProfileError(null);
    setReloads((n) => n + 1);
  }

  if (!isConfigured) {
    return (
      <ScreenMessage>
        <Notice title="設定が必要です" body={MISSING_CONFIG_MESSAGE} tone="warn" />
      </ScreenMessage>
    );
  }
  if (authLoading) return <Loading />;
  if (authError) {
    return (
      <ScreenMessage>
        <Notice title="接続できません" body={authError} tone="warn" />
      </ScreenMessage>
    );
  }
  if (profileError) {
    return (
      <ScreenMessage>
        <Notice
          title="読み込めません"
          body={profileError}
          tone="warn"
          action={{ label: "もう一度読み込む", onPress: retry }}
        />
      </ScreenMessage>
    );
  }
  if (!profile) return <Loading />;

  const here = coverage?.[profile.target_level];

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenHeader title="アカウント" subtitle={isAnonymous ? "ログインなしで使えています" : email ?? undefined} />

      {isAnonymous ? (
        <Card style={{ gap: space.md }}>
          <View style={styles.head}>
            <IconBadge name="user" tone="violet" />
            <Text style={[type.h2, { flex: 1 }]}>記録はこの端末にだけあります</Text>
          </View>
          <Text style={type.small}>
            ログインしなくても使えます。ただし、いまの記録はこの端末のアプリの中にある鍵で
            つながっています。アプリを消したり端末を変えたりすると、戻せません。
          </Text>
          <Text style={type.small}>
            Googleとつなぐと、これまでの解答も連続日数も弱点もそのまま引き継がれます。
            作り直しにはなりません。
          </Text>
          <Button
            label={busy ? "つないでいます…" : "Googleで記録を引き継ぐ"}
            onPress={onLink}
            disabled={busy}
          />
          {error ? <Text style={[type.small, { color: colors.wrong }]}>{error}</Text> : null}
        </Card>
      ) : (
        <Card style={{ gap: space.md }}>
          <View style={styles.head}>
            <IconBadge name="check" tone="teal" />
            <View style={{ flex: 1 }}>
              <Text style={type.h2}>ログイン中</Text>
              <Text style={type.small}>{email ?? "Googleアカウント"}</Text>
            </View>
          </View>
          <Text style={type.small}>記録はどの端末からでも見られます。</Text>
        </Card>
      )}

      <View style={{ gap: space.md }}>
        <SectionLabel>目標レベル</SectionLabel>
        {LEVELS.map((level) => {
          const active = profile.target_level === level;
          const cov = coverage?.[level];
          return (
            <Pressable
              key={level}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setLevel(level)}
              style={({ pressed }) => [
                styles.levelRow,
                active && styles.levelRowOn,
                pressed && { opacity: 0.9 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={type.h2}>{level}</Text>
                <Text style={type.small}>{LEVEL_HINT[level]}</Text>
              </View>
              {cov ? <Tag tone={cov.types === 9 ? "teal" : "amber"}>{`${cov.types}/9種類`}</Tag> : null}
              {active ? <Icon name="check" size={20} color={colors.accent} strokeWidth={2.4} /> : null}
            </Pressable>
          );
        })}
        {here && here.types < 9 ? (
          <Notice
            tone="warn"
            title="このレベルはまだ種類がそろっていません"
            body={`目標レベル「${profile.target_level}」には現在9種類中${here.types}種類・${here.total}問しかありません。今日の練習はその範囲から出ます。`}
          />
        ) : null}
      </View>

      <Notice
        title="スコアを出さない理由"
        body={
          "このアプリは本番の点数を推定しません。生成した問題には本番と同じ尺度がないため、" +
          "「たぶん◯点」と出すと、当たっているように見えて計画を狂わせます。" +
          "代わりに、種類ごとの正答率と、よく落ちる罠だけを出しています。"
        }
      />

      <Notice
        title="この試験について"
        body={
          "このアプリはBJTビジネス日本語能力テストの形式に合わせた練習問題を出します。" +
          "問題はすべて独自に作ったもので、過去問は使っていません。試験の運営とは関係ありません。"
        }
      />

      {!isAnonymous ? (
        <Button
          label="ログアウト"
          tone="secondary"
          onPress={async () => {
            await signOut();
            router.replace("/");
          }}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.lg, paddingBottom: TAB_CLEARANCE, gap: space.lg },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  levelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    ...shadow.card,
  },
  levelRowOn: { backgroundColor: colors.accentSoft },
});
