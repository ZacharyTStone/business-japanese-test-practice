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
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../src/lib/auth";
import { fetchProfile, updateProfile } from "../src/lib/db";
import type { Level, Profile } from "../src/lib/types";
import { Button, Card, Loading, Notice } from "../src/ui/components";
import { colors, radius, space, type } from "../src/ui/theme";

const LEVELS: Level[] = ["J3", "J2", "J1"];
const LEVEL_HINT: Record<Level, string> = {
  J3: "決まった場面の、型どおりのやりとり",
  J2: "ふつうの業務。相手や立場で敬語が変わる",
  J1: "遠回しな言い方や、例外的な場面まで",
};

export default function Account() {
  const router = useRouter();
  const { isAnonymous, email, linkGoogle, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile().then(setProfile).catch(() => setProfile(null));
  }, [isAnonymous]);

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

  if (!profile) return <Loading />;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {isAnonymous ? (
        <Card style={{ gap: space.md }}>
          <Text style={type.h2}>記録はこの端末にだけあります</Text>
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
        <Card style={{ gap: space.sm }}>
          <Text style={type.h2}>ログイン中</Text>
          <Text style={type.small}>{email ?? "Googleアカウント"}</Text>
          <Text style={type.small}>記録はどの端末からでも見られます。</Text>
        </Card>
      )}

      <Card style={{ gap: space.md }}>
        <Text style={type.h2}>目標レベル</Text>
        <Text style={type.small}>出題の難しさが変わります。</Text>
        <View style={{ gap: space.sm }}>
          {LEVELS.map((level) => {
            const active = profile.target_level === level;
            return (
              <View key={level} style={[styles.level, active && styles.levelActive]}>
                <Button
                  label={level}
                  sub={LEVEL_HINT[level]}
                  tone={active ? "primary" : "secondary"}
                  onPress={() => setLevel(level)}
                />
              </View>
            );
          })}
        </View>
      </Card>

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
  page: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  level: { borderRadius: radius.md },
  levelActive: { borderRadius: radius.md },
});
