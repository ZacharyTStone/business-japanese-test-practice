/**
 * The account screen, which mostly exists to explain why there isn't one yet.
 *
 * Linking is framed as "keep your record", not "sign up", because that is
 * literally what it does: the anonymous session already holds everything, and
 * Google is attached to the same user so nothing moves. The honest risk is
 * stated plainly too — an unlinked record lives on one device and goes with it.
 *
 * The level is shown, not chosen. The database moves it on the evidence of the
 * answers (twenty at a level, sixteen right: up; eight or fewer: down), and the
 * one sentence here says so, because a number that moves by itself should say
 * why. The exam date is the only thing a person is asked for, and it is asked
 * here rather than on first launch: a countdown helps, a form on the first
 * screen does not.
 */
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../../src/lib/auth";
import { fetchProfile, updateProfile } from "../../src/lib/db";
import { countdownLine, daysUntil, formatExamDate, monthsFromNow } from "../../src/lib/exam";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../../src/lib/supabase";
import type { Profile } from "../../src/lib/types";
import {
  Button,
  Card,
  Chip,
  IconBadge,
  Loading,
  Notice,
  ScreenHeader,
  ScreenMessage,
  SectionLabel,
} from "../../src/ui/components";
import { colors, space, TAB_CLEARANCE, type } from "../../src/ui/theme";

const EXAM_PRESETS: { label: string; months: number }[] = [
  { label: "1か月後", months: 1 },
  { label: "3か月後", months: 3 },
  { label: "6か月後", months: 6 },
];

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
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!isConfigured || authLoading || authError) return;
    fetchProfile()
      .then(setProfile)
      .catch((e) => setProfileError(e instanceof Error ? e.message : String(e)));
  }, [isAnonymous, authLoading, authError, reloads]);

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

  async function setExamDate(date: string | null) {
    setProfile((p) => (p ? { ...p, exam_date: date } : p));
    try {
      await updateProfile({ exam_date: date });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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

  const days = daysUntil(profile.exam_date);
  const countdown = countdownLine(days);

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
        <SectionLabel>いまのレベル</SectionLabel>
        <Card style={{ gap: space.md }}>
          <View style={styles.head}>
            <IconBadge name="layers" tone="blue" />
            <View style={{ flex: 1 }}>
              <Text style={type.h1}>{profile.target_level}</Text>
              <Text style={type.small}>アプリが決めます。選ぶところはありません。</Text>
            </View>
          </View>
          <Text style={type.small}>
            直近20問のうち16問以上正解すると、次のレベルに上がります。8問以下なら、少しやさしくします。
            毎回の練習には、1問だけ上のレベルの問題が入っています。
          </Text>
        </Card>
      </View>

      <View style={{ gap: space.md }}>
        <SectionLabel>試験日</SectionLabel>
        <Card style={{ gap: space.md }}>
          <View style={styles.head}>
            <IconBadge name="clock" tone="amber" />
            <View style={{ flex: 1 }}>
              <Text style={type.h2}>
                {profile.exam_date ? formatExamDate(profile.exam_date) : "まだ決めていません"}
              </Text>
              <Text style={type.small}>
                {countdown ?? "決めると、ホームにカウントダウンが出ます。"}
              </Text>
            </View>
          </View>
          <View style={styles.chips}>
            {EXAM_PRESETS.map((preset) => (
              <Chip
                key={preset.label}
                label={preset.label}
                selected={false}
                onPress={() => setExamDate(monthsFromNow(preset.months))}
              />
            ))}
            {profile.exam_date ? (
              <Chip label="消す" selected={false} onPress={() => setExamDate(null)} />
            ) : null}
          </View>
        </Card>
      </View>

      {error ? <Text style={[type.small, { color: colors.wrong }]}>{error}</Text> : null}

      <Notice
        title="スコアを出さない理由"
        body={
          "このアプリは本番の点数を推定しません。生成した問題には本番と同じ尺度がないため、" +
          "「たぶん◯点」と出すと、当たっているように見えて計画を狂わせます。" +
          "上の「レベル」は点数の予測ではなく、いま出している問題の難しさです。"
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
