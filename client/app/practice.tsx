/**
 * The practice screen. Everything else in the app exists to get someone here.
 *
 * Three decisions worth stating:
 *
 * **The whole set is fetched up front.** Five items in one request, then no
 * network until the first answer. Someone practising on the Yamanote line should
 * not lose their set in a tunnel.
 *
 * **Correctness comes back from the insert.** The item carries `correct_index`,
 * so the screen could grade locally and feel a few hundred milliseconds faster —
 * but then the app's opinion and the database's could drift apart, and the
 * database's is the one the weakness profile is built on. The round trip is the
 * price of those two never disagreeing.
 *
 * **No ads here, ever.** Not in a break, not between the narration and the
 * options. See AdSlot: the placement type has no member for this screen.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../src/lib/auth";
import { fetchProfile, fetchQueue, finishSession, recordAttempt, startSession } from "../src/lib/db";
import { setSummary } from "../src/lib/session";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/supabase";
import type { AnsweredItem, PracticeMode, QueuedItem } from "../src/lib/types";
import { ClipButton } from "../src/ui/audio";
import { Button, Card, Loading, Notice, Tag } from "../src/ui/components";
import { RudenessMeter } from "../src/ui/meters";
import { colors, radius, space, type } from "../src/ui/theme";

const LETTERS = ["A", "B", "C", "D"];

const CHANNEL_LABEL: Record<string, string> = {
  in_person: "対面",
  phone: "電話",
  video: "オンライン",
};

export default function Practice() {
  const router = useRouter();
  const { session, loading: authLoading, error: authError } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode = (params.mode as PracticeMode) ?? "daily";

  const [items, setItems] = useState<QueuedItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [graded, setGraded] = useState<{ isCorrect: boolean; chosenRole: string } | null>(null);
  const [answers, setAnswers] = useState<AnsweredItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startedAt = useRef(Date.now());
  const questionShownAt = useRef(Date.now());

  useEffect(() => {
    if (!isConfigured || !session?.user) return;
    let cancelled = false;
    (async () => {
      try {
        const profile = await fetchProfile();
        const queue = await fetchQueue({ limit: profile?.daily_goal ?? 5, mode });
        if (cancelled) return;
        setItems(queue);
        setSessionId(await startSession(mode, session.user.id));
        questionShownAt.current = Date.now();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, mode]);

  const item = items?.[index];
  const options = useMemo(
    () => (item ? [...item.options].sort((a, b) => a.position - b.position) : []),
    [item]
  );

  if (!isConfigured) {
    return (
      <View style={styles.page}>
        <Notice title="設定が必要です" body={MISSING_CONFIG_MESSAGE} />
        <Button label="戻る" tone="secondary" onPress={() => router.back()} />
      </View>
    );
  }
  if (authLoading) return <Loading label="問題を用意しています…" />;
  if (authError) {
    return (
      <View style={styles.page}>
        <Notice title="接続できません" body={authError} />
        <Button label="戻る" tone="secondary" onPress={() => router.back()} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.page}>
        <Notice title="問題を読み込めません" body={error} />
        <Button label="戻る" tone="secondary" onPress={() => router.back()} />
      </View>
    );
  }
  if (!items) return <Loading label="問題を用意しています…" />;

  if (items.length === 0) {
    return (
      <View style={styles.page}>
        <Notice
          title="出せる問題がありません"
          body="このレベルの問題をすべて解いたか、まだ問題が公開されていません。"
        />
        <Button label="戻る" tone="secondary" onPress={() => router.back()} />
      </View>
    );
  }
  if (!item) return <Loading />;

  async function choose(position: number) {
    if (chosen !== null || busy || !item) return;
    setBusy(true);
    setChosen(position);
    try {
      const result = await recordAttempt({
        itemId: item.id,
        chosenIndex: position,
        sessionId,
        elapsedMs: Date.now() - questionShownAt.current,
      });
      setGraded(result);
      setAnswers((prev) => [...prev, { item, chosenIndex: position, isCorrect: result.isCorrect }]);
    } catch (e) {
      // Let them see the answer even if recording failed; grading locally here
      // is a display fallback only, and nothing is written from it.
      const isCorrect = position === item.correct_index;
      setGraded({ isCorrect, chosenRole: options[position]?.role ?? "" });
      setAnswers((prev) => [...prev, { item, chosenIndex: position, isCorrect }]);
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    const last = index + 1 >= items!.length;
    if (last) {
      if (sessionId) await finishSession(sessionId);
      setSummary({
        mode,
        answers,
        startedAt: startedAt.current,
        finishedAt: Date.now(),
      });
      router.replace("/result");
      return;
    }
    setIndex((i) => i + 1);
    setChosen(null);
    setGraded(null);
    questionShownAt.current = Date.now();
  }

  const revealed = graded !== null;
  const chosenOption = chosen !== null ? options[chosen] : null;
  const correctOption = options[item.correct_index];

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.progressRow}>
        <Text style={type.small}>
          {index + 1} / {items.length}
        </Text>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${((index + (revealed ? 1 : 0)) / items.length) * 100}%` }]} />
        </View>
        {item.times_seen > 0 ? <Tag>{item.times_seen + 1}回目</Tag> : null}
      </View>

      <Card style={{ gap: space.md }}>
        <View style={styles.metaRow}>
          {item.channel ? <Tag>{CHANNEL_LABEL[item.channel] ?? item.channel}</Tag> : null}
          {item.speaker_role && item.listener_role ? (
            <Text style={type.small}>
              {item.speaker_role} → {item.listener_role}
            </Text>
          ) : null}
        </View>

        <ClipButton path={item.narration_path} text={item.stem} label="場面を聞く" />
      </Card>

      <View style={{ gap: space.md }}>
        {options.map((option, i) => {
          const isChosen = chosen === i;
          const isAnswer = i === item.correct_index;
          const show = revealed && (isChosen || isAnswer);
          return (
            <Pressable
              key={option.position}
              accessibilityRole="button"
              disabled={revealed || busy}
              onPress={() => choose(i)}
              style={({ pressed }) => [
                styles.option,
                pressed && !revealed && { opacity: 0.85 },
                show && (isAnswer ? styles.optionCorrect : styles.optionWrong),
              ]}
            >
              <View style={styles.optionHeader}>
                <Text style={styles.letter}>{LETTERS[i]}</Text>
                {show ? (
                  // A word as well as a colour: the marker has to survive being
                  // read by someone who cannot tell the green from the red.
                  <Text style={[type.small, { color: isAnswer ? colors.correct : colors.wrong }]}>
                    {isAnswer ? "○ 正解" : "× これを選びました"}
                  </Text>
                ) : null}
              </View>
              <Text style={type.option}>{option.text}</Text>
              {revealed ? <Text style={[type.small, styles.why]}>{option.why}</Text> : null}
            </Pressable>
          );
        })}
      </View>

      {revealed ? (
        <View style={{ gap: space.lg }}>
          {graded.isCorrect ? (
            <Card style={{ backgroundColor: colors.correctSoft, borderColor: colors.correctSoft }}>
              <Text style={[type.h2, { color: colors.correct }]}>正解です</Text>
              <Text style={[type.small, { marginTop: space.xs }]}>{correctOption?.why}</Text>
            </Card>
          ) : (
            <RudenessMeter role={graded.chosenRole || chosenOption?.role || ""} />
          )}

          <Card style={{ gap: space.sm }}>
            <Text style={type.small}>解説</Text>
            <Text style={type.body}>{item.explanation_ja}</Text>
            {item.vocab_notes?.length ? (
              <View style={{ gap: space.xs, marginTop: space.sm }}>
                {item.vocab_notes.map((note) => (
                  <Text key={note.term} style={type.small}>
                    {note.term}（{note.reading}）— {note.meaning}
                  </Text>
                ))}
              </View>
            ) : null}
          </Card>

          <Button
            label={index + 1 >= items.length ? "結果を見る" : "次の問題へ"}
            onPress={next}
          />
        </View>
      ) : (
        <Text style={[type.small, styles.hint]}>この場面で最も適切な言い方を選んでください。</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  progressRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  bar: { flex: 1, height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden" },
  barFill: { height: 4, backgroundColor: colors.accent },
  metaRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  option: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.xs,
  },
  optionHeader: { flexDirection: "row", alignItems: "center", gap: space.sm },
  optionCorrect: { borderColor: colors.correct, backgroundColor: colors.correctSoft },
  optionWrong: { borderColor: colors.wrong, backgroundColor: colors.wrongSoft },
  letter: { fontSize: 13, fontWeight: "700", color: colors.muted },
  why: { marginTop: space.xs },
  hint: { textAlign: "center" },
});
