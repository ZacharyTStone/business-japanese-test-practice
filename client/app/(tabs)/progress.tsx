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
 * last 30 days, so those two rank on the same window — otherwise a person
 * could be told they are weak somewhere the queue has stopped aiming at. The
 * ranking, its thresholds and its fallback are lib/ranking.ts.
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
import { TAG_LABELS } from "../../src/lib/generated";
import { useLang, type Key } from "../../src/lib/i18n";
import { placedLevel } from "../../src/lib/levels";
import { rankTraps, rankWeakTags } from "../../src/lib/ranking";
import { roleInfo } from "../../src/lib/roles";
import type { RoleTrap, Section, SectionLevel, TagStat, TypeStat } from "../../src/lib/types";
import {
  AdSlot,
  Button,
  Card,
  IconBadge,
  Loading,
  LoadFailed,
  ProgressBar,
  ScreenHeader,
  ScreenMessage,
  SectionLabel,
  Tag,
} from "../../src/ui/components";
import { ScreenGate } from "../../src/ui/screen";
import type { IconName } from "../../src/ui/icons";
import { FadeIn } from "../../src/ui/motion";
import { useTabClearance } from "../../src/ui/tabbar";
import { TypeRadar } from "../../src/ui/radar";
import type { BadgeTone } from "../../src/ui/theme";
import { colors, space, tabular, type } from "../../src/ui/theme";

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

const CHANNEL_LABEL: Record<string, Key> = {
  in_person: "ch_in_person",
  phone: "ch_phone",
  video: "ch_video",
  written: "ch_written",
};

/** A tag as a person would say it: 「不在を伝える」, not `phone_absence`. The
 *  seed tables name every tag (client/src/lib/generated.ts); the four channels
 *  are words the app already translates. */
function tagLabel(axis: TagStat["axis"], tag: string, t: (key: Key) => string): string {
  if (axis === "channel") return CHANNEL_LABEL[tag] ? t(CHANNEL_LABEL[tag]) : tag;
  return TAG_LABELS[axis]?.[tag] ?? tag;
}

/** Behind the setup notice when no project is configured (ui/screen.tsx). */
export default function ProgressScreen() {
  return (
    <ScreenGate>
      <Progress />
    </ScreenGate>
  );
}

function Progress() {
  const clearance = useTabClearance();
  const router = useRouter();
  const { lang, t } = useLang();
  const [types, setTypes] = useState<TypeStat[] | null>(null);
  const [tags, setTags] = useState<TagStat[]>([]);
  const [traps, setTraps] = useState<RoleTrap[]>([]);
  const [levels, setLevels] = useState<SectionLevel[]>([]);
  const [adFree, setAdFree] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloads, setReloads] = useState(0);

  useFocusEffect(
    useCallback(() => {
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
          // A spinner that never ends looks exactly like an app that has hung.
          if (!cancelled) setError(e ?? "error");
        }
      })();
      return () => {
        cancelled = true;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `reloads` is the retry: bumping it is what reads again
    }, [reloads])
  );

  if (error != null) {
    return (
      <ScreenMessage>
        <LoadFailed
          error={error}
          title={t("prog_load_err")}
          onRetry={() => {
            setError(null);
            setReloads((n) => n + 1);
          }}
        />
      </ScreenMessage>
    );
  }
  if (!types) return <Loading />;

  // The queue's window, falling back to the record as a whole when nothing
  // is recent; the clock's timeouts on a line of their own (lib/ranking.ts).
  const { recent: tagsRecent, rows: weakTags } = rankWeakTags(tags);
  const { recent: trapsRecent, top: topTraps, timeouts } = rankTraps(traps);

  const answered = types.reduce((n, t) => n + t.answered, 0);

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: clearance }]}>
      <ScreenHeader title={t("tab_progress")} />

      <FadeIn>
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
                  <Text style={[type.small, tabular, { fontWeight: "700", color: colors.text }]}>
                    {pct === null ? "—" : t("pct_n", { pct, n })}
                  </Text>
                </View>
                <ProgressBar value={(pct ?? 0) / 100} />
              </View>
            );
          })}
          {answered === 0 ? <Text style={type.small}>{t("prog_first")}</Text> : null}
        </Card>
      </FadeIn>

      <FadeIn delay={70}>
        <Card style={{ gap: space.md }}>
          <TypeRadar stats={types} />
        </Card>
      </FadeIn>

      {topTraps.length > 0 || timeouts ? (
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
              <Tag tone="pink">{t("trap_rate", { c: trap.n, m: trap.met })}</Tag>
            </View>
          ))}
          {timeouts ? (
            <View style={styles.trapRow}>
              <IconBadge name="alert" tone="amber" size={30} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.body}>{roleInfo("timed_out", lang).label}</Text>
                <Text style={type.small}>{roleInfo("timed_out", lang).advice}</Text>
              </View>
              <Tag tone="amber">{t("times", { n: timeouts.n })}</Tag>
            </View>
          ) : null}
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
                  {t(AXIS_KEY[tag.axis])} · {tagLabel(tag.axis, tag.tag, t)}
                </Text>
                <Text style={[type.small, tabular, { fontWeight: "700", color: colors.text }]}>
                  {t("pct_n", { pct: Math.round(tag.acc * 100), n: tag.n })}
                </Text>
              </View>
              <ProgressBar value={tag.acc} />
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
        <Button
          label={t("vocab_btn")}
          tone="secondary"
          sub={t("vocab_sub")}
          onPress={() => router.push("/vocab")}
        />
        <Button
          label={t("words_btn")}
          tone="secondary"
          sub={t("words_sub")}
          onPress={() => router.push("/words")}
        />
      </View>

      <AdSlot placement="list_screen" enabled={!adFree} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.lg, gap: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  trapRow: { flexDirection: "row", alignItems: "center", gap: space.md },
});
