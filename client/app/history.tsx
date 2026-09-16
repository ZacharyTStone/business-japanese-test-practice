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
import { roleInfo } from "../src/lib/roles";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/supabase";
import type { HistoryEntry } from "../src/lib/types";
import { Button, Card, Chip, Loading, Notice, Tag } from "../src/ui/components";
import { colors, radius, shadow, space, type } from "../src/ui/theme";

const LETTERS = ["A", "B", "C", "D"];

export default function History() {
  const router = useRouter();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrongOnly, setWrongOnly] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    fetchHistory()
      .then((rows) => !cancelled && setEntries(rows))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
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
        <Notice title="設定が必要です" body={MISSING_CONFIG_MESSAGE} tone="warn" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.page}>
        <Notice
          title="読み込めません"
          body={error}
          tone="warn"
          action={{ label: "戻る", onPress: () => router.back() }}
        />
      </View>
    );
  }
  if (!entries) return <Loading label="記録を読み込んでいます…" />;

  if (entries.length === 0) {
    return (
      <View style={styles.page}>
        <Notice
          title="まだ記録がありません"
          body="一組やってみると、ここに残ります。"
          action={{ label: "戻る", onPress: () => router.back() }}
        />
      </View>
    );
  }

  const wrong = entries.filter((e) => !e.is_correct).length;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card style={{ gap: space.sm }}>
        <Text style={type.small}>直近 {entries.length} 問</Text>
        <Text style={type.h2}>まちがえたのは {wrong} 問</Text>
      </Card>

      <View style={styles.row}>
        <Chip label="まちがえた問題" selected={wrongOnly} onPress={() => setWrongOnly(true)} />
        <Chip label="すべて" selected={!wrongOnly} onPress={() => setWrongOnly(false)} />
      </View>

      {shown.length === 0 ? (
        <Notice title="まちがえた問題はありません" body="この調子で続けましょう。" />
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
                {entry.is_correct ? "○ 正解" : "× 不正解"}
              </Text>
            </View>

            <Text style={type.body} numberOfLines={expanded ? undefined : 2}>
              {entry.stem}
            </Text>

            {!entry.is_correct && entry.chosen_role ? (
              <Text style={type.small}>落ちた罠：{roleInfo(entry.chosen_role).label}</Text>
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
                        {isAnswer ? " · ○ 正解" : ""}
                        {isChosen && !isAnswer ? " · × これを選びました" : ""}
                      </Text>
                      <Text style={type.option}>{option.text}</Text>
                      <Text style={type.small}>{option.why}</Text>
                    </View>
                  );
                })}
                <Card style={{ gap: space.xs }}>
                  <Text style={type.small}>解説</Text>
                  <Text style={type.body}>{entry.explanation_ja}</Text>
                </Card>
              </View>
            ) : (
              <Text style={type.small}>タップすると解説を見られます</Text>
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
