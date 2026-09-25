/**
 * The words that were in the way, in one list.
 *
 * Every question ships with notes — a reading and a meaning for the words it
 * turns on — and the practice screen shows them once, folded under the
 * explanation, and then never again. This keeps them: the notes of every
 * question answered wrong, one line per word, the most recently missed first.
 *
 * A record, not a drill. Nothing here decides what is served next — that is
 * next_items() and nothing else — and there is nothing to choose: it is the
 * same kind of screen as 解いた問題, reached from the same place.
 */
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { fetchVocab } from "../src/lib/db";
import { useLang } from "../src/lib/i18n";
import { errorText, isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/supabase";
import type { VocabEntry } from "../src/lib/types";
import { Card, Loading, Notice, Tag } from "../src/ui/components";
import { colors, radius, shadow, space, type } from "../src/ui/theme";

export default function Vocab() {
  const { t } = useLang();
  const [entries, setEntries] = useState<VocabEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    fetchVocab()
      .then((rows) => !cancelled && setEntries(rows))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [reloads]);

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
  if (!entries) return <Loading label={t("vocab_loading")} />;
  if (entries.length === 0) {
    return (
      <View style={styles.page}>
        <Notice title={t("vocab_empty_title")} body={t("vocab_empty_body")} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card style={{ gap: space.sm }}>
        <Text style={type.small}>{t("vocab_head")}</Text>
        <Text style={type.h2}>{t("vocab_count", { n: entries.length })}</Text>
      </Card>

      {entries.map((entry) => (
        <View key={entry.term} style={styles.entry}>
          <View style={styles.head}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.option}>{entry.term}</Text>
              <Text style={type.small}>{entry.reading}</Text>
            </View>
            {/* Only when it is a pattern: once is every word on this list. */}
            {entry.misses > 1 ? <Tag tone="pink">{t("times", { n: entry.misses })}</Tag> : null}
          </View>
          <Text style={type.body}>{entry.meaning}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
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
});
