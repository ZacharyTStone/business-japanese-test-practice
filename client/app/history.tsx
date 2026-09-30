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
 *
 * An opened entry is the whole question, not just its last line: the document,
 * the conversation line by line with each line playable, the spoken options,
 * and the notes. 55 of the exam's 80 questions turn on a document or a
 * conversation, and reviewing one of those from its question line alone is
 * reviewing the half that was never the problem.
 *
 * And a line of the learner's own under it — 復習ノート. Reading why an answer
 * was wrong is the explanation's job; writing, in your own words, why you fell
 * for it is the part of a review that does the learning, and it is what you
 * want to read again the next time the same trap comes round in a new question.
 *
 * Opened with `?item=<id>` (from a word on the vocabulary screen) it shows that
 * one question's answers, opened, with a way back to the whole list.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../src/lib/auth";
import { clipUrl, fetchHistory, fetchNotes, fetchReviewDetail, saveNote } from "../src/lib/db";
import { useLang } from "../src/lib/i18n";
import { roleInfo } from "../src/lib/roles";
import { errorText, isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/supabase";
import type { HistoryEntry, ReviewDetail } from "../src/lib/types";
import { MiniPlay, Transcript } from "../src/ui/audio";
import { Button, Card, Chip, Loading, Notice, Tag } from "../src/ui/components";
import { DocumentView } from "../src/ui/document";
import { colors, radius, shadow, space, type } from "../src/ui/theme";

const NUMBERS = ["1", "2", "3", "4"];

export default function History() {
  // The list runs to the bottom of the screen, where the home indicator is.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // The result screen replaces itself with this one, which leaves nothing
  // underneath to go back to. Every way out goes through this, so none of
  // them is a dead end.
  const leave = () =>
    router.canGoBack() ? router.back() : router.replace("/progress");
  const { lang, t } = useLang();
  const { item: onlyItem } = useLocalSearchParams<{ item?: string }>();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wrongOnly, setWrongOnly] = useState(!onlyItem);
  const [open, setOpen] = useState<string | null>(null);
  /** The rest of each question opened so far, by item: loaded on first
   *  opening and kept, so closing and reopening one costs nothing. */
  const [details, setDetails] = useState<Record<string, ReviewDetail | "loading" | "error">>({});
  /** The learner's notes, as saved, by item. Furniture: the list works without. */
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    setEntries(null);
    fetchHistory(50, onlyItem || undefined)
      .then((rows) => {
        if (cancelled) return;
        setEntries(rows);
        fetchNotes([...new Set(rows.map((r) => r.item_id))])
          .then((n) => !cancelled && setNotes(n))
          .catch(() => {});
        // Arriving for one question: open it, rather than making them find it.
        if (onlyItem && rows[0]) {
          setWrongOnly(false);
          toggle(rows[0]);
        }
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [onlyItem]);

  const shown = useMemo(
    () => (entries ?? []).filter((e) => !wrongOnly || !e.is_correct),
    [entries, wrongOnly]
  );

  function toggle(entry: HistoryEntry) {
    const opening = open !== entry.attempt_id;
    setOpen(opening ? entry.attempt_id : null);
    if (!opening) return;
    const had = details[entry.item_id];
    // Loaded or on its way. A failure is tried again on the next opening.
    if (had && had !== "error") return;
    setDetails((d) => ({ ...d, [entry.item_id]: "loading" }));
    fetchReviewDetail(entry.item_id)
      .then((detail) => setDetails((d) => ({ ...d, [entry.item_id]: detail })))
      .catch(() => setDetails((d) => ({ ...d, [entry.item_id]: "error" })));
  }

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
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: space.xxl + insets.bottom }]}>
      <Card style={{ gap: space.sm }}>
        <Text style={type.small}>{t("hist_recent", { n: entries.length })}</Text>
        <Text style={type.h2}>{t("hist_wrong_n", { n: wrong })}</Text>
      </Card>

      {onlyItem ? (
        <View style={[styles.row, { alignItems: "center" }]}>
          <Text style={[type.small, { flex: 1 }]}>{t("hist_only_item")}</Text>
          <Chip label={t("hist_show_all")} selected={false} onPress={() => router.setParams({ item: "" })} />
        </View>
      ) : (
        <View style={styles.row}>
          <Chip label={t("hist_wrong_chip")} selected={wrongOnly} onPress={() => setWrongOnly(true)} />
          <Chip label={t("hist_all")} selected={!wrongOnly} onPress={() => setWrongOnly(false)} />
        </View>
      )}

      {shown.length === 0 ? (
        <Notice title={t("hist_none_wrong")} body={t("hist_keep")} />
      ) : null}

      {shown.map((entry) => {
        const expanded = open === entry.attempt_id;
        const detail = details[entry.item_id];
        const ready = detail && detail !== "loading" && detail !== "error" ? detail : null;
        // A heard question line is in the transcript below, with its play
        // button, so the copy up here stays two lines rather than saying it
        // twice in full.
        const heard = Boolean(ready?.narration_path);
        return (
          // Only the head opens and closes the entry: with a document in the
          // card, a tap to select a figure or scroll a table would otherwise
          // fold the question away mid-read.
          <View key={entry.attempt_id} style={styles.entry}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => toggle(entry)}
              style={({ pressed }) => [{ gap: space.sm }, pressed && { opacity: 0.85 }]}
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

              <Text style={type.body} numberOfLines={expanded && !heard ? undefined : 2}>
                {entry.stem}
              </Text>

              {!entry.is_correct && entry.chosen_role ? (
                <Text style={type.small}>{t("mistake_label", { label: roleInfo(entry.chosen_role, lang).label })}</Text>
              ) : null}

              {expanded ? null : <Text style={type.small}>{t("tap_explain")}</Text>}
            </Pressable>

            {expanded ? (
              <View style={{ gap: space.md, marginTop: space.sm }}>
                {detail === "loading" ? <Text style={type.small}>{t("loading")}</Text> : null}
                {detail === "error" ? <Text style={type.small}>{t("hist_detail_err")}</Text> : null}

                {/* The stimulus, in the order it was met: what was read, then
                    what was heard. For most of the paper this is the part the
                    question was actually about. */}
                {ready?.documents.map((doc, i) => (
                  <DocumentView key={`${entry.attempt_id}-doc-${i}`} doc={doc} />
                ))}
                {ready ? (
                  <Transcript
                    turns={ready.dialogue}
                    narration={
                      ready.narration_path
                        ? { text: entry.stem, url: clipUrl(ready.narration_path) }
                        : null
                    }
                  />
                ) : null}

                {entry.options.map((option, i) => {
                  const isAnswer = i === entry.correct_index;
                  const isChosen = i === entry.chosen_index;
                  const audio = clipUrl(ready?.option_audio[option.position] ?? null);
                  return (
                    <View
                      key={option.position}
                      style={[
                        styles.option,
                        isAnswer && styles.optionCorrect,
                        isChosen && !isAnswer && styles.optionWrong,
                      ]}
                    >
                      {audio ? (
                        <MiniPlay url={audio} label={t("play_option", { label: NUMBERS[i] })} />
                      ) : null}
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={type.small}>
                          {NUMBERS[i]}
                          {isAnswer ? ` · ${t("mark_correct")}` : ""}
                          {isChosen && !isAnswer ? ` · ${t("mark_chosen")}` : ""}
                        </Text>
                        <Text style={type.option}>{option.text}</Text>
                        <Text style={type.small}>{option.why}</Text>
                      </View>
                    </View>
                  );
                })}
                <Card style={{ gap: space.xs }}>
                  <Text style={type.small}>{t("explanation")}</Text>
                  <Text style={type.body}>
                    {lang === "en" && entry.explanation_en ? entry.explanation_en : entry.explanation_ja}
                  </Text>
                </Card>

                {ready?.vocab_notes.length ? (
                  <View style={{ gap: space.xs }}>
                    <Text style={type.small}>{t("vocab_label")}</Text>
                    {ready.vocab_notes.map((note) => (
                      <Text key={note.term} style={type.small}>
                        {note.term}（{note.reading}）— {note.meaning}
                      </Text>
                    ))}
                  </View>
                ) : null}

                <NoteEditor
                  key={`${entry.item_id}-note`}
                  itemId={entry.item_id}
                  saved={notes[entry.item_id] ?? ""}
                  onSaved={(text) => setNotes((n) => ({ ...n, [entry.item_id]: text }))}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * One line of the learner's own about a question: why it caught them. Saved on
 * the button rather than on every keystroke, so a half-written thought is not
 * a write, and emptied it is removed rather than kept as a blank.
 */
function NoteEditor({
  itemId,
  saved,
  onSaved,
}: {
  itemId: string;
  saved: string;
  onSaved: (text: string) => void;
}) {
  const { t } = useLang();
  const { session } = useAuth();
  const [text, setText] = useState(saved);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  useEffect(() => setText(saved), [saved]);
  const dirty = text.trim() !== saved.trim();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={type.small}>{t("note_label")}</Text>
      <TextInput
        value={text}
        onChangeText={(v) => {
          setText(v);
          setState("idle");
        }}
        placeholder={t("note_placeholder")}
        placeholderTextColor={colors.muted}
        accessibilityLabel={t("note_label")}
        multiline
        style={styles.note}
      />
      {dirty || state !== "idle" ? (
        <View style={[styles.row, { alignItems: "center" }]}>
          <Chip
            label={state === "saving" ? t("loading") : t("note_save")}
            selected={false}
            onPress={() => {
              if (state === "saving" || !dirty) return;
              const userId = session?.user.id;
              if (!userId) {
                setState("failed");
                return;
              }
              setState("saving");
              saveNote(userId, itemId, text)
                .then(() => {
                  onSaved(text.trim());
                  setState("saved");
                })
                .catch(() => setState("failed"));
            }}
          />
          {state === "saved" ? <Text style={type.small}>{t("note_saved")}</Text> : null}
          {state === "failed" ? <Text style={[type.small, { color: colors.wrong }]}>{t("note_failed")}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md },
  note: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 44,
    fontSize: 15,
    color: colors.text,
  },
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
  entryHead: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.md,
  },
  optionCorrect: { borderColor: colors.correct, backgroundColor: colors.correctSoft },
  optionWrong: { borderColor: colors.wrong, backgroundColor: colors.wrongSoft },
});
