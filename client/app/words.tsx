/**
 * Every word the questions carry notes for, each with a sentence it is used in.
 *
 * The companion to ことばメモ: that screen keeps the words of the questions
 * that caught you; this one keeps the words of every question you have
 * answered, searchable, with a level and a section to narrow it by and
 * furigana to switch on. Nothing on it is written for it — the words, readings
 * and meanings are the notes each question shipped with, and the example is a
 * line of one of those questions (`words.ts`). Never a question not yet met:
 * its sentence could be its answer.
 *
 * A reference, not a drill, and not a choice about the questions: nothing here
 * is recorded, and what is served next is still next_items() alone.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchWordList } from "../src/lib/db";
import { useLang } from "../src/lib/i18n";
import { SECTION_ORDER, SECTION_SHORT } from "../src/lib/levels";
import { errorText, isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/supabase";
import type { Level, Section } from "../src/lib/types";
import { annotate, filterWords, furigana, type WordEntry } from "../src/lib/words";
import { Card, Chip, Loading, Notice, Tag } from "../src/ui/components";
import { ScreenCrash } from "../src/ui/crash";
import { RubyText } from "../src/ui/ruby";
import { colors, radius, shadow, space, type } from "../src/ui/theme";

const LEVELS: Level[] = ["J1", "J2", "J3"];
/** Drawn at a time. Furigana lays a sentence out a character to a cell, and a
 *  few hundred of those at once is a slow first paint on a phone. */
const PAGE = 40;

/** A throw while drawing stays on this screen (ui/crash.tsx). */
export const ErrorBoundary = ScreenCrash;

export default function Words() {
  // The list runs to the bottom of the screen, where the home indicator is.
  const insets = useSafeAreaInsets();
  const { t } = useLang();
  const [words, setWords] = useState<WordEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<Level | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [showFurigana, setShowFurigana] = useState(false);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    fetchWordList()
      .then((rows) => !cancelled && setWords(rows))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [reloads]);

  // A new search starts from the top of its results.
  useEffect(() => setShown(PAGE), [query, level, section]);

  const matches = useMemo(
    () => (words ? filterWords(words, { query, level, section }) : []),
    [words, query, level, section]
  );

  if (!isConfigured) {
    return (
      <View style={styles.page}>
        <Notice title={t("config_needed")} body={MISSING_CONFIG_MESSAGE} tone="warn" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.page}>
        <Notice
          title={t("cant_load")}
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
      </View>
    );
  }
  if (!words) return <Loading label={t("words_loading")} />;
  if (words.length === 0) {
    return (
      <View style={styles.page}>
        <Notice title={t("words_empty")} body={t("words_empty_body")} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: space.xxl + insets.bottom }]} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: space.md }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("words_search")}
          placeholderTextColor={colors.muted}
          accessibilityLabel={t("words_search")}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={styles.search}
        />
        <View style={styles.row}>
          <Chip label={t("words_all")} selected={level === null} onPress={() => setLevel(null)} />
          {LEVELS.map((l) => (
            <Chip key={l} label={l} selected={level === l} onPress={() => setLevel(level === l ? null : l)} />
          ))}
        </View>
        <View style={styles.row}>
          <Chip label={t("words_all")} selected={section === null} onPress={() => setSection(null)} />
          {SECTION_ORDER.map((s) => (
            <Chip
              key={s}
              label={t(SECTION_SHORT[s])}
              selected={section === s}
              onPress={() => setSection(section === s ? null : s)}
            />
          ))}
        </View>
        <View style={[styles.row, { alignItems: "center" }]}>
          <Chip
            label={t("words_furigana_on")}
            selected={showFurigana}
            onPress={() => setShowFurigana((on) => !on)}
          />
          <Text style={[type.small, { marginLeft: "auto" }]}>{t("words_count", { n: matches.length })}</Text>
        </View>
      </Card>

      {matches.length === 0 ? <Notice title={t("words_none_match")} body="" /> : null}

      {matches.slice(0, shown).map((w) => (
        <View key={w.term} style={styles.entry}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <RubyText segments={furigana(w.term, w.reading)} show={showFurigana} style={styles.term} />
            </View>
            {w.levels.map((l) => (
              <Tag key={l}>{l}</Tag>
            ))}
          </View>
          <Text style={type.small}>{w.meaning}</Text>
          <View style={styles.example}>
            <Text style={type.label}>{t("words_example")}</Text>
            {w.sentence ? (
              <RubyText segments={annotate(w.sentence, words)} show={showFurigana} style={type.body} />
            ) : (
              <Text style={type.small}>{t("words_no_example")}</Text>
            )}
          </View>
        </View>
      ))}

      {matches.length > shown ? (
        <View style={styles.row}>
          <Chip
            label={t("words_more", { n: matches.length - shown })}
            selected={false}
            onPress={() => setShown((n) => n + PAGE)}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  search: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.inputBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 44,
    fontSize: 15,
    color: colors.text,
  },
  entry: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: space.lg,
    gap: space.xs,
    ...shadow.card,
  },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  term: { fontSize: 20, fontWeight: "700", color: colors.text, lineHeight: 28 },
  example: {
    gap: space.xs,
    marginTop: space.xs,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: space.md,
  },
});
