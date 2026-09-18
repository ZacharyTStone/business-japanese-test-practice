/**
 * What you have answered, newest first.
 *
 * `attempts` has no update or delete policy — an answer already given is
 * history, and rewriting it would quietly corrupt the weakness profile built
 * from it. This screen is the other side of that decision: if the record is
 * permanent, it should at least be *readable*, and the most useful thing to
 * reread is the question that caught you and the sentence explaining why.
 *
 * Wrong answers are the default view. Not as a judgement — as an admission that
 * nobody scrolls a list of things they already got right, and that the second
 * time you meet an item that caught you is when it teaches you something.
 */
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { fetchHistory } from "../src/lib/db";
import { useLang } from "../src/lib/i18n";
import { roleInfo } from "../src/lib/roles";
import { errorText, isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/supabase";
import type { HistoryEntry } from "../src/lib/types";
import { Button, Card, Chip, Loading, Notice, Tag } from "../src/ui/components";
import { colors, radius, shadow, space, type } from "../src/ui/theme";

const LETTERS = ["A", "B", "C", "D"];

export default function History() {
  const router = useRouter();
  // 記録 pushes this screen, but the result screen replaces itself with it, and
  // a replaced screen has nothing underneath to go back to. Every way out of
  // here goes through this, so none of them can be a dead end.
  const leave = () =>
    router.canGoBack() ? router.back() : router.replace("/progress");
  const { lang, t } = useLang();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrongOnly, setWrongOnly] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    fetchHistory()
      .then((rows) => !cancelled && setEntries(rows))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(
    () => (entries ?? []).filter((e) => !wrongOnly || !e.is_correct),
    [entries, wrongOnly]
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
          action={{ label: t("back"), onPress: leave }}
        />
      </View>
    );
  }
  if (!entries) return <Loading label={t("hist_loading")} />;

  if (entries.length === 0) {
    return (
      <View style={styles.page}>
        <Notice
          title={t("hist_empty_title")}
          body={t("hist_empty_body")}
          action={{ label: t("back"), onPress: leave }}
        />
      </View>
    );
  }

  const wrong = entries.filter((e) => !e.is_correct).length;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card style={{ gap: space.sm }}>
        <Text style={type.small}>{t("hist_recent", { n: entries.length })}</Text>
        <Text style={type.h2}>{t("hist_wrong_n", { n: wrong })}</Text>
      </Card>

      <View style={styles.row}>
        <Chip label={t("hist_wrong_chip")} selected={wrongOnly} onPress={() => setWrongOnly(true)} />
        <Chip label={t("hist_all")} selected={!wrongOnly} onPress={() => setWrongOnly(false)} />
      </View>

      {shown.length === 0 ? (
        <Notice title={t("hist_none_wrong")} body={t("hist_keep")} />
      ) : null}

      {shown.map((entry) => {
        const expanded = open === entry.attempt_id;
        return (
          <Pressable
            key={entry.attempt_id}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setOpen(expanded ? null : entry.attempt_id)}
            style={[styles.entry, !entry.is_correct && styles.entryWrong]}
          >
            <View style={styles.entryHead}>
              <Tag>{entry.label_ja}</Tag>
              {/* A word, not only a colour: roughly one man in twelve cannot
                  tell the green from the red. */}
              <Text
                style={[
                  type.small,
                  { color: entry.is_correct ? colors.correct : colors.wrong, fontWeight: "700" },
                ]}
              >
                {entry.is_correct ? t("mark_correct") : t("mark_wrong")}
              </Text>
            </View>

            <Text style={type.body} numberOfLines={expanded ? undefined : 2}>
              {entry.stem}
            </Text>

            {!entry.is_correct && entry.chosen_role ? (
              <Text style={type.small}>{t("mistake_label", { label: roleInfo(entry.chosen_role, lang).label })}</Text>
            ) : null}

            {expanded ? (
              <View style={{ gap: space.md, marginTop: space.sm }}>
                {entry.options.map((option, i) => {
                  const isAnswer = i === entry.correct_index;
                  const isChosen = i === entry.chosen_index;
                  return (
                    <View
                      key={option.position}
                      style={[
                        styles.option,
                        isAnswer && styles.optionCorrect,
                        isChosen && !isAnswer && styles.optionWrong,
                      ]}
                    >
                      <Text style={type.small}>
                        {LETTERS[i]}
                        {isAnswer ? ` · ${t("mark_correct")}` : ""}
                        {isChosen && !isAnswer ? ` · ${t("mark_chosen")}` : ""}
                      </Text>
                      <Text style={type.option}>{option.text}</Text>
                      <Text style={type.small}>{option.why}</Text>
                    </View>
                  );
                })}
                <Card style={{ gap: space.xs }}>
                  <Text style={type.small}>{t("explanation")}</Text>
                  <Text style={type.body}>
                    {lang === "en" && entry.explanation_en ? entry.explanation_en : entry.explanation_ja}
                  </Text>
                </Card>
              </View>
            ) : (
              <Text style={type.small}>{t("tap_explain")}</Text>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  row: { flexDirection: "row", gap: space.sm },
  entry: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: space.lg,
    gap: space.sm,
    ...shadow.card,
  },
  entryWrong: { backgroundColor: colors.surface },
  entryHead: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  option: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: 2,
  },
  optionCorrect: { borderColor: colors.correct, backgroundColor: colors.correctSoft },
  optionWrong: { borderColor: colors.wrong, backgroundColor: colors.wrongSoft },
});
