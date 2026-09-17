/**
 * The record, cut the way the exam's own score report cuts it.
 *
 * Three sections first — 聴解, 聴読解, 読解 — because that is what a person
 * gets back from the real thing, and it is the shape their study plan has to
 * take. All nine types are drawn under it, unfolded: this is the screen
 * somebody opens *to* see where they stand, and a chart behind a "show me"
 * link is a chart most people never see. The tag list earns its place beneath
 * that — knowing you are at 62% on 発言聴解 is a grade; knowing you are at 30%
 * on the telephone and 85% face to face is a plan for the evening.
 *
 * Two windows on one screen, deliberately. The bars and the radar are the
 * record, all-time. The two cards under them — the traps, the weak tags — are
 * what the queue is about to do something about, and the queue weighs the
 * last 30 days, so those two rank on the same window. Before this they were
 * all-time too, and a person could be told they were weak somewhere the queue
 * had long since stopped aiming at.
 *
 * A section's level is printed only once the database has placed it. Before
 * that the app is serving a neutral starting level, and a "J2" beside a section
 * with two answers in it reads as a verdict on the learner rather than as the
 * placeholder it is.
 */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  fetchRoleTraps,
  fetchSectionLevels,
  fetchTagStats,
  fetchTypeStats,
  hasAdFree,
} from "../../src/lib/db";
import { useLang, type Key } from "../../src/lib/i18n";
import { placedLevel } from "../../src/lib/levels";
import { roleInfo } from "../../src/lib/roles";
import { errorText, isConfigured, MISSING_CONFIG_MESSAGE } from "../../src/lib/supabase";
import type { RoleTrap, Section, SectionLevel, TagStat, TypeStat } from "../../src/lib/types";
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
  Tag,
} from "../../src/ui/components";
import type { IconName } from "../../src/ui/icons";
import { TypeRadar } from "../../src/ui/radar";
import type { BadgeTone } from "../../src/ui/theme";
import { colors, space, TAB_CLEARANCE, type } from "../../src/ui/theme";

const AXIS_KEY: Record<TagStat["axis"], Key> = {
  function: "axis_function",
  relation: "axis_relation",
  setting: "axis_setting",
  channel: "axis_channel",
};

const SECTIONS: { id: Section; key: Key; icon: IconName; tone: BadgeTone }[] = [
  { id: "choukai", key: "sec_choukai", icon: "headphones", tone: "violet" },
  { id: "choudokkai", key: "sec_choudokkai", icon: "layers", tone: "teal" },
  { id: "dokkai", key: "sec_dokkai", icon: "doc", tone: "blue" },
];

/** Tags seen fewer times than this are not shown: three answers is a mood, not
 *  a weakness, and presenting it as one sends people off to drill noise.
 *  Counted over the last 30 days, the window the queue weighs. */
const MIN_ANSWERS_PER_TAG = 4;

export default function Progress() {
  const router = useRouter();
  const { lang, t } = useLang();
  const [types, setTypes] = useState<TypeStat[] | null>(null);
  const [tags, setTags] = useState<TagStat[]>([]);
  const [traps, setTraps] = useState<RoleTrap[]>([]);
  const [levels, setLevels] = useState<SectionLevel[]>([]);
  const [adFree, setAdFree] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!isConfigured) return;
      let cancelled = false;
      (async () => {
        try {
          const [ty, tg, tr, ad, lv] = await Promise.all([
            fetchTypeStats(),
            fetchTagStats(),
            fetchRoleTraps(),
            hasAdFree(),
            fetchSectionLevels(),
          ]);
          if (cancelled) return;
          setTypes(ty);
          setTags(tg);
          setTraps(tr);
          setAdFree(ad);
          setLevels(lv);
        } catch (e) {
          // Without this the screen sat on its spinner for ever when the record
          // failed to load, which looks exactly like an app that has hung.
          if (!cancelled) setError(errorText(e));
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
        <Notice title={t("config_needed")} body={MISSING_CONFIG_MESSAGE} tone="warn" />
      </ScreenMessage>
    );
  }
  if (error) {
    return (
      <ScreenMessage>
        <Notice
          title={t("prog_load_err")}
          body={error}
          tone="warn"
          action={{
            label: t("retry"),
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

  // The queue's window, unless there is nothing in it. Somebody back from a
  // month away has answered nothing in 30 days, and an empty card there says
  // less than the record does, so the whole list falls back to all-time and
  // drops the "last 30 days" label. It is the whole list or none of it: a
  // per-tag fallback would rank a tag last touched in spring against one
  // answered yesterday on two different scales, which is not a ranking.
  const tagsRecent = tags.some((t) => t.recent_answered > 0);
  const weakTags = (
    tagsRecent
      ? tags
          .filter((t) => t.recent_answered >= MIN_ANSWERS_PER_TAG && t.recent_accuracy !== null)
          .map((t) => ({ ...t, n: t.recent_answered, acc: t.recent_accuracy ?? 0 }))
      : tags
          .filter((t) => t.answered >= MIN_ANSWERS_PER_TAG)
          .map((t) => ({ ...t, n: t.answered, acc: t.accuracy }))
  )
    .sort((a, b) => a.acc - b.acc)
    .slice(0, 6);

  // Same rule for the traps: the ones that caught them in the last 30 days,
  // ranked by how often, or the all-time list when none did.
  const trapsRecent = traps.some((t) => t.recent_times > 0);
  const topTraps = (
    trapsRecent
      ? traps.filter((t) => t.recent_times > 0).map((t) => ({ ...t, n: t.recent_times }))
      : traps.map((t) => ({ ...t, n: t.times_chosen }))
  )
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

  const answered = types.reduce((n, t) => n + t.answered, 0);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenHeader title={t("tab_progress")} />

      <Card style={{ gap: space.lg }}>
        {SECTIONS.map((section) => {
          const inSection = types.filter((t) => t.section === section.id);
          const n = inSection.reduce((a, t) => a + t.answered, 0);
          const c = inSection.reduce((a, t) => a + t.correct, 0);
          // 「—」 and not 0%: a section nobody has opened has no accuracy, and
          // printing zero there is the lie that sends people off to drill it.
          const pct = n > 0 ? Math.round((c / n) * 100) : null;
          // The level being served here, beside the accuracy that earned it.
          // This is the whole per-section design in one glance: 読解 J1 next to
          // 聴解 J3 says more than either number does alone.
          const level = placedLevel(levels, section.id);
          return (
            <View key={section.id} style={{ gap: 6 }}>
              <View style={styles.row}>
                <IconBadge name={section.icon} tone={section.tone} size={28} />
                <Text style={[type.body, { flex: 1, fontWeight: "700" }]}>{t(section.key)}</Text>
                {level ? <Tag tone={section.tone}>{level}</Tag> : null}
                <Text style={[type.small, { fontWeight: "700", color: colors.text }]}>
                  {pct === null ? "—" : t("pct_n", { pct, n })}
                </Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${pct ?? 0}%` }]} />
              </View>
            </View>
          );
        })}
        {answered === 0 ? <Text style={type.small}>{t("prog_first")}</Text> : null}
      </Card>

      <Card style={{ gap: space.md }}>
        <TypeRadar stats={types} />
      </Card>

      {topTraps.length > 0 ? (
        <Card style={{ gap: space.lg }}>
          <View style={styles.row}>
            <Text style={[type.h2, { flex: 1 }]}>{t("prog_mistakes")}</Text>
            {trapsRecent ? <Text style={type.small}>{t("prog_recent")}</Text> : null}
          </View>
          {topTraps.map((trap) => (
            <View key={trap.role} style={styles.trapRow}>
              <IconBadge name="alert" tone="pink" size={30} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.body}>{roleInfo(trap.role, lang).label}</Text>
                <Text style={type.small}>{roleInfo(trap.role, lang).advice}</Text>
              </View>
              <Tag tone="pink">{t("times", { n: trap.n })}</Tag>
            </View>
          ))}
        </Card>
      ) : null}

      {weakTags.length > 0 ? (
        <Card style={{ gap: space.lg }}>
          <View style={styles.row}>
            <Text style={[type.h2, { flex: 1 }]}>{t("prog_weak")}</Text>
            {tagsRecent ? <Text style={type.small}>{t("prog_recent")}</Text> : null}
          </View>
          {weakTags.map((tag) => (
            <View key={`${tag.axis}:${tag.tag}`} style={{ gap: 6 }}>
              <View style={styles.row}>
                <Text style={[type.small, { flex: 1 }]}>
                  {t(AXIS_KEY[tag.axis])} · {tag.tag}
                </Text>
                <Text style={[type.small, { fontWeight: "700", color: colors.text }]}>
                  {t("pct_n", { pct: Math.round(tag.acc * 100), n: tag.n })}
                </Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(tag.acc * 100)}%` }]} />
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      <View style={{ gap: space.md }}>
        <SectionLabel>{t("review")}</SectionLabel>
        {/* Right where a wrong answer is most likely to be on somebody's mind. */}
        <Button
          label={t("review_btn")}
          tone="secondary"
          sub={t("review_sub")}
          onPress={() => router.push("/history")}
        />
      </View>

      <AdSlot placement="list_screen" enabled={!adFree} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.lg, paddingBottom: TAB_CLEARANCE, gap: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  trapRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  track: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, backgroundColor: colors.accent, borderRadius: 4 },
});
