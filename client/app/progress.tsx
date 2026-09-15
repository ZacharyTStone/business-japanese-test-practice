/**
 * The record: the nine-type radar, the traps that keep catching you, and the
 * finer tags underneath.
 *
 * The tag list is the part that earns its place. Knowing you are at 62% on
 * 発言聴解 is a grade; knowing you are at 30% on the telephone and 85% face to
 * face is a plan for the evening.
 */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { fetchRoleTraps, fetchTagStats, fetchTypeStats, hasAdFree } from "../src/lib/db";
import { roleInfo } from "../src/lib/roles";
import { isConfigured } from "../src/lib/supabase";
import type { RoleTrap, TagStat, TypeStat } from "../src/lib/types";
import { AdSlot, Button, Card, Loading, Notice } from "../src/ui/components";
import { TypeRadar } from "../src/ui/radar";
import { colors, space, type } from "../src/ui/theme";

const AXIS_LABEL: Record<TagStat["axis"], string> = {
  function: "何をする場面か",
  relation: "誰に言うか",
  setting: "どこでの話か",
  channel: "どう伝わるか",
};

/** Tags seen fewer times than this are not shown: three answers is a mood, not
 *  a weakness, and presenting it as one sends people off to drill noise. */
const MIN_ANSWERS_PER_TAG = 4;

export default function Progress() {
  const router = useRouter();
  const [types, setTypes] = useState<TypeStat[] | null>(null);
  const [tags, setTags] = useState<TagStat[]>([]);
  const [traps, setTraps] = useState<RoleTrap[]>([]);
  const [adFree, setAdFree] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!isConfigured) return;
      let cancelled = false;
      (async () => {
        const [ty, tg, tr, ad] = await Promise.all([
          fetchTypeStats(),
          fetchTagStats(),
          fetchRoleTraps(),
          hasAdFree(),
        ]);
        if (cancelled) return;
        setTypes(ty);
        setTags(tg);
        setTraps(tr);
        setAdFree(ad);
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (!isConfigured) {
    return (
      <View style={styles.page}>
        <Notice title="設定が必要です" body="Supabase の接続先が設定されていません。" />
      </View>
    );
  }
  if (!types) return <Loading />;

  const weakTags = tags
    .filter((t) => t.answered >= MIN_ANSWERS_PER_TAG)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 6);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card>
        <Text style={type.h2}>9種類のバランス</Text>
        <View style={{ marginTop: space.md }}>
          <TypeRadar stats={types} />
        </View>
      </Card>

      {traps.length > 0 ? (
        <Card style={{ gap: space.md }}>
          <Text style={type.h2}>よく落ちる罠</Text>
          {traps.slice(0, 5).map((t) => (
            <View key={t.role} style={{ gap: 2 }}>
              <View style={styles.row}>
                <Text style={[type.body, { flex: 1 }]}>{roleInfo(t.role).label}</Text>
                <Text style={type.small}>{t.times_chosen}回</Text>
              </View>
              <Text style={type.small}>{roleInfo(t.role).advice}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {weakTags.length > 0 ? (
        <Card style={{ gap: space.md }}>
          <Text style={type.h2}>苦手な場面</Text>
          {weakTags.map((t) => (
            <View key={`${t.axis}:${t.tag}`} style={{ gap: 4 }}>
              <View style={styles.row}>
                <Text style={[type.small, { flex: 1 }]}>
                  {AXIS_LABEL[t.axis]} · {t.tag}
                </Text>
                <Text style={type.small}>
                  {Math.round(t.accuracy * 100)}%（{t.answered}問）
                </Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(t.accuracy * 100)}%` }]} />
              </View>
            </View>
          ))}
          <Text style={type.small}>
            {MIN_ANSWERS_PER_TAG}問以上解いた場面だけを出しています。
          </Text>
        </Card>
      ) : (
        <Card>
          <Text style={type.small}>
            もう少し解くと、場面ごとの得意・不得意が出てきます。
          </Text>
        </Card>
      )}

      {/* Right where a wrong answer is most likely to be on somebody's mind. */}
      <Button
        label="解いた問題を見返す"
        tone="secondary"
        sub="まちがえた問題と、その解説"
        onPress={() => router.push("/history")}
      />

      <AdSlot placement="list_screen" enabled={!adFree} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  track: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, backgroundColor: colors.accent },
});
