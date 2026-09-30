/**
 * The words that were in the way, in one list — and a way to check yourself on
 * them.
 *
 * Every question ships with notes — a reading and a meaning for the words it
 * turns on — and the practice screen shows them once, folded under the
 * explanation, and then never again. This keeps them: the notes of every
 * question answered wrong, one line per word, the most recently missed first.
 *
 * A list read top to bottom is recognition, and recognition is not what the
 * exam asks for: it says the word once, in a sentence, at speed. So the list
 * can hide what each word means until it is tapped — a check on yourself, with
 * nothing recorded and nothing served — and an opened word shows the sentence it
 * was met in, with its clip where there is one, and the question it came from.
 *
 * Still a record, not a drill. Nothing here decides what is served next — that
 * is next_items() and nothing else — and there is nothing to choose about the
 * questions: it is the same kind of screen as 解いた問題, reached from the same
 * place.
 */
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchTermSentence, fetchVocab } from "../src/lib/db";
import { useLang } from "../src/lib/i18n";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/supabase";
import type { TermSentence, VocabEntry } from "../src/lib/types";
import { MiniPlay } from "../src/ui/audio";
import { Card, Chip, Loading, LoadFailed, Notice, Tag } from "../src/ui/components";
import { ScreenCrash } from "../src/ui/crash";
import { colors, radius, shadow, space, type } from "../src/ui/theme";

/** A throw while drawing stays on this screen (ui/crash.tsx). */
export const ErrorBoundary = ScreenCrash;

export default function Vocab() {
  // The list runs to the bottom of the screen, where the home indicator is.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLang();
  const [entries, setEntries] = useState<VocabEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloads, setReloads] = useState(0);
  /** Readings and meanings hidden until a word is opened: checking yourself. */
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  /** Each opened word's sentence, loaded on first opening and kept. */
  const [sentences, setSentences] = useState<Record<string, TermSentence | null | "loading" | "error">>({});

  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    fetchVocab()
      .then((rows) => !cancelled && setEntries(rows))
      .catch((e) => !cancelled && setError(e ?? "error"));
    return () => {
      cancelled = true;
    };
  }, [reloads]);

  function toggle(entry: VocabEntry) {
    const opening = open !== entry.term;
    setOpen(opening ? entry.term : null);
    if (!opening) return;
    const had = sentences[entry.term];
    if (had !== undefined && had !== "error") return;
    setSentences((s) => ({ ...s, [entry.term]: "loading" }));
    fetchTermSentence(entry.item_id, entry.term)
      .then((sentence) => setSentences((s) => ({ ...s, [entry.term]: sentence })))
      .catch(() => setSentences((s) => ({ ...s, [entry.term]: "error" })));
  }

  if (!isConfigured) {
    return (
      <View style={styles.page}>
        <Notice title={t("config_needed")} body={MISSING_CONFIG_MESSAGE} tone="warn" />
      </View>
    );
  }
  if (error != null) {
    return (
      <View style={styles.page}>
        <LoadFailed
          error={error}
          onRetry={() => {
            setError(null);
            setReloads((n) => n + 1);
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
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: space.xxl + insets.bottom }]}>
      <Card style={{ gap: space.sm }}>
        <Text style={type.small}>{t("vocab_head")}</Text>
        <Text style={type.h2}>{t("vocab_count", { n: entries.length })}</Text>
        {hidden ? <Text style={type.small}>{t("vocab_tap")}</Text> : null}
      </Card>

      <View style={styles.row}>
        <Chip
          label={hidden ? t("vocab_show") : t("vocab_hide")}
          selected={hidden}
          onPress={() => {
            setHidden((h) => !h);
            setOpen(null);
          }}
        />
      </View>

      {entries.map((entry) => {
        const expanded = open === entry.term;
        const sentence = sentences[entry.term];
        return (
          <View key={entry.term} style={styles.entry}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => toggle(entry)}
              style={({ pressed }) => [{ gap: space.xs }, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.head}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={type.option}>{entry.term}</Text>
                  {!hidden || expanded ? <Text style={type.small}>{entry.reading}</Text> : null}
                </View>
                {/* Only when it is a pattern: once is every word on this list. */}
                {entry.misses > 1 ? <Tag tone="pink">{t("times", { n: entry.misses })}</Tag> : null}
              </View>
              {!hidden || expanded ? <Text style={type.body}>{entry.meaning}</Text> : null}
            </Pressable>

            {expanded ? (
              <View style={{ gap: space.sm, marginTop: space.xs }}>
                <Text style={type.label}>{t("vocab_sentence")}</Text>
                {sentence === "loading" ? <Text style={type.small}>{t("loading")}</Text> : null}
                {sentence === "error" ? <Text style={type.small}>{t("vocab_sentence_err")}</Text> : null}
                {sentence === null ? <Text style={type.small}>{t("vocab_no_sentence")}</Text> : null}
                {sentence && sentence !== "loading" && sentence !== "error" ? (
                  <View style={styles.sentence}>
                    {sentence.url ? <MiniPlay url={sentence.url} label={t("vocab_sentence")} /> : null}
                    <Text style={[type.body, { flex: 1 }]}>{sentence.text}</Text>
                  </View>
                ) : null}
                <Chip
                  label={t("vocab_in_context")}
                  selected={false}
                  onPress={() => router.push({ pathname: "/history", params: { item: entry.item_id } })}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md },
  row: { flexDirection: "row", gap: space.sm },
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
  sentence: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: space.md,
  },
});
