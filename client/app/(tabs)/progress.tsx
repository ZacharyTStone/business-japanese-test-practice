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

import { fetchRoleTraps, fetchTagStats, fetchTypeStats, hasAdFree } from "../../src/lib/db";
import { roleInfo } from "../../src/lib/roles";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../../src/lib/supabase";
import type { RoleTrap, TagStat, TypeStat } from "../../src/lib/types";
import {
  AdSlot,
  Button,
  Card,
  IconBadge,
  Loading,
  Notice,
  ScreenHeader,
  ScreenMessage,
  SectionLabel,
  StatCard,
  Tag,
} from "../../src/ui/components";
import { TypeRadar } from "../../src/ui/radar";
import { colors, space, TAB_CLEARANCE, type } from "../../src/ui/theme";

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
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!isConfigured) return;
      let cancelled = false;
      (async () => {
        try {
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
        } catch (e) {
          // Without this the screen sat on its spinner for ever when the record
          // failed to load, which looks exactly like an app that has hung.
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [reloads])
  );

  if (!isConfigured) {
    return (
      <ScreenMessage>
        <Notice title="設定が必要です" body={MISSING_CONFIG_MESSAGE} tone="warn" />
      </ScreenMessage>
    );
  }
  if (error) {
    return (
      <ScreenMessage>
        <Notice
          title="記録を読み込めません"
          body={error}
          tone="warn"
          action={{
            label: "もう一度読み込む",
            onPress: () => {
              setError(null);
              setReloads((n) => n + 1);
            },
          }}
        />
      </ScreenMessage>
    );
  }
  if (!types) return <Loading />;

  const weakTags = tags
    .filter((t) => t.answered >= MIN_ANSWERS_PER_TAG)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 6);

  const answered = types.reduce((n, t) => n + t.answered, 0);
  const correct = types.reduce((n, t) => n + t.correct, 0);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenHeader title="記録" subtitle="9種類のバランスと、よく落ちる罠" />

      <View style={styles.grid}>
        <StatCard name="book" tone="blue" label="解いた問題" value={`${answered}問`} />
        <StatCard
          name="target"
          tone="teal"
          label="全体の正答率"
          // 「—」 and not 0%: a type nobody has opened has no accuracy, and
          // printing zero there is the lie that sends people off to drill it.
          value={answered > 0 ? `${Math.round((correct / answered) * 100)}%` : "—"}
        />
      </View>

      <Card style={{ gap: space.md }}>
        <Text style={type.h2}>9種類のバランス</Text>
        <TypeRadar stats={types} />
      </Card>

      {traps.length > 0 ? (
        <Card style={{ gap: space.lg }}>
          <Text style={type.h2}>よく落ちる罠</Text>
          {traps.slice(0, 5).map((t) => (
            <View key={t.role} style={styles.trapRow}>
              <IconBadge name="alert" tone="pink" size={30} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.body}>{roleInfo(t.role).label}</Text>
                <Text style={type.small}>{roleInfo(t.role).advice}</Text>
              </View>
              <Tag tone="pink">{t.times_chosen}回</Tag>
            </View>
          ))}
        </Card>
      ) : null}

      {weakTags.length > 0 ? (
        <Card style={{ gap: space.lg }}>
          <Text style={type.h2}>苦手な場面</Text>
          {weakTags.map((t) => (
            <View key={`${t.axis}:${t.tag}`} style={{ gap: 6 }}>
              <View style={styles.row}>
                <Text style={[type.small, { flex: 1 }]}>
                  {AXIS_LABEL[t.axis]} · {t.tag}
                </Text>
                <Text style={[type.small, { fontWeight: "700", color: colors.text }]}>
                  {Math.round(t.accuracy * 100)}%（{t.answered}問）
                </Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(t.accuracy * 100)}%` }]} />
              </View>
            </View>
          ))}
          <Text style={type.small}>{MIN_ANSWERS_PER_TAG}問以上解いた場面だけを出しています。</Text>
        </Card>
      ) : (
        <Card>
          <Text style={type.small}>もう少し解くと、場面ごとの得意・不得意が出てきます。</Text>
        </Card>
      )}

      <View style={{ gap: space.md }}>
        <SectionLabel>見返す</SectionLabel>
        {/* Right where a wrong answer is most likely to be on somebody's mind. */}
        <Button
          label="解いた問題を見返す"
          tone="secondary"
          sub="まちがえた問題と、その解説"
          onPress={() => router.push("/history")}
        />
      </View>

      <AdSlot placement="list_screen" enabled={!adFree} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.lg, paddingBottom: TAB_CLEARANCE, gap: space.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  trapRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  track: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, backgroundColor: colors.accent, borderRadius: 4 },
});
