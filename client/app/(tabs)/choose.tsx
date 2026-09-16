/**
 * The manual review mode.
 *
 * Home offers one button, because most days the right answer is "the set the
 * app picked". This screen is for the other days — the week before the exam,
 * when somebody knows perfectly well that their 聴読解 is the problem and does
 * not want five items of anything else.
 *
 * There is no level to choose. The level is the one the app is serving right
 * now, which it moved there on the evidence of the answers; a picker would ask
 * a person to second-guess that with a letter they cannot judge.
 *
 * Two things it refuses to do:
 *
 * **It does not hide the empty types.** A type with no published items is shown
 * as 近日公開 and is not selectable. Hiding it would leave someone wondering
 * why 総合読解 never appears; saying so is honest and costs a line.
 *
 * **It does not estimate a score.** A mock run reports a count, like every other
 * run. There is no IRT calibration behind these items, and a number invented for
 * a mock exam is the one people would plan around.
 */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { fetchItemTypes, fetchProfile } from "../../src/lib/db";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../../src/lib/supabase";
import type { ItemType, Level, Section } from "../../src/lib/types";
import {
  Button,
  IconBadge,
  Loading,
  Notice,
  ScreenHeader,
  ScreenMessage,
  SectionLabel,
  Tag,
} from "../../src/ui/components";
import type { IconName } from "../../src/ui/icons";
import type { BadgeTone } from "../../src/ui/theme";
import { colors, radius, shadow, space, TAB_CLEARANCE, type } from "../../src/ui/theme";

const SECTION_LABEL: Record<Section, string> = {
  choukai: "聴解",
  choudokkai: "聴読解",
  dokkai: "読解",
};

/** One tint and one drawing per section, so the three stay apart at a glance:
 *  what you hear, what you hear *and* read, and what you only read. */
const SECTION_LOOK: Record<Section, { icon: IconName; tone: BadgeTone }> = {
  choukai: { icon: "headphones", tone: "violet" },
  choudokkai: { icon: "layers", tone: "teal" },
  dokkai: { icon: "doc", tone: "blue" },
};

export default function Choose() {
  const router = useRouter();
  const [level, setLevel] = useState<Level | null>(null);
  const [types, setTypes] = useState<ItemType[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  // On focus rather than on mount: the level can move while a set is being
  // answered, and the counts here should be for the level they are at now.
  useFocusEffect(
    useCallback(() => {
      if (!isConfigured) return;
      let cancelled = false;
      (async () => {
        try {
          const profile = await fetchProfile();
          const current = profile?.target_level ?? "J2";
          const rows = await fetchItemTypes(current);
          if (cancelled) return;
          setLevel(current);
          setTypes(rows);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [reloads])
  );

  function retry() {
    setError(null);
    setReloads((n) => n + 1);
  }

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
          title="読み込めません"
          body={error}
          tone="warn"
          action={{ label: "もう一度読み込む", onPress: retry }}
        />
      </ScreenMessage>
    );
  }
  if (!level || types === null) return <Loading />;

  const sections: Section[] = ["choukai", "choudokkai", "dokkai"];
  const total = types.reduce((n, t) => n + t.available, 0);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenHeader
        title="自分で選ぶ"
        subtitle={`ふだんは「今日の練習」で十分です。種類をしぼりたいときに。いまのレベル ${level}`}
      />

      {sections.map((section) => {
        const inSection = types.filter((t) => t.section === section);
        if (!inSection.length) return null;
        const look = SECTION_LOOK[section];
        return (
          <View key={section} style={{ gap: space.sm }}>
            <SectionLabel>{SECTION_LABEL[section]}</SectionLabel>
            {inSection.map((itemType) => {
              const empty = itemType.available === 0;
              const on = selected === itemType.id;
              return (
                <Pressable
                  key={itemType.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: empty }}
                  disabled={empty}
                  onPress={() => setSelected(on ? null : itemType.id)}
                  style={({ pressed }) => [
                    styles.typeRow,
                    on && styles.typeRowOn,
                    empty && styles.typeRowEmpty,
                    pressed && !empty && { opacity: 0.9 },
                  ]}
                >
                  <IconBadge name={look.icon} tone={empty ? "violet" : look.tone} />
                  <View style={{ flex: 1 }}>
                    <Text style={type.body}>{itemType.label_ja}</Text>
                    <Text style={type.small}>{itemType.label_en}</Text>
                  </View>
                  <Tag tone={empty ? undefined : look.tone}>
                    {empty ? "近日公開" : `${itemType.available}問`}
                  </Tag>
                </Pressable>
              );
            })}
          </View>
        );
      })}

      {total === 0 ? (
        <Notice
          title="いまのレベルの問題はまだありません"
          body="公開されるのをお待ちください。「今日の練習」は隣のレベルからも出します。"
          tone="warn"
        />
      ) : null}

      <View style={{ gap: space.md }}>
        <Button
          label="この種類で練習する"
          icon="play"
          sub={selected ? undefined : "種類を選ばない場合は、すべての種類から出します"}
          disabled={total === 0}
          onPress={() =>
            router.push({
              pathname: "/practice",
              params: { mode: "free", ...(selected ? { itemType: selected } : {}) },
            })
          }
        />
        <Button
          label="模試をやる"
          tone="secondary"
          sub="20問・途中でやめずに最後まで"
          disabled={total === 0}
          onPress={() =>
            router.push({
              pathname: "/practice",
              params: { mode: "mock", ...(selected ? { itemType: selected } : {}) },
            })
          }
        />
        <Text style={[type.small, styles.footnote]}>
          模試でも点数の予測は出しません。生成した問題に対する換算の根拠がないからです。
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.lg, paddingBottom: TAB_CLEARANCE, gap: space.lg },
  typeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    ...shadow.card,
  },
  typeRowOn: { backgroundColor: colors.accentSoft },
  typeRowEmpty: { opacity: 0.5 },
  footnote: { textAlign: "center" },
});
