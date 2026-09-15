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
 *
 * **One screen for all nine types.** The stimulus differs — an utterance, a
 * narrated scene, a conversation, a document, or some combination — but the act
 * does not: read or listen, choose one of four, find out why. Nine screens would
 * have drifted into nine slightly different ways of showing a wrong answer.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../src/lib/auth";
import {
  fetchProfile,
  fetchQueue,
  finishSession,
  recordAttempt,
  sceneUrl,
  startSession,
} from "../src/lib/db";
import { setSummary } from "../src/lib/session";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/supabase";
import type { AnsweredItem, Level, PracticeMode, QueuedItem } from "../src/lib/types";
import { ClipButton, DialoguePlayer } from "../src/ui/audio";
import { Button, Card, Loading, Notice, Tag } from "../src/ui/components";
import { DocumentView } from "../src/ui/document";
import { RudenessMeter } from "../src/ui/meters";
import { colors, radius, space, type } from "../src/ui/theme";

const LETTERS = ["A", "B", "C", "D"];

/** A mock run is longer than a daily set on purpose: the thing it simulates is
 *  sitting still and concentrating, which five questions cannot rehearse. */
const MOCK_LENGTH = 20;

const CHANNEL_LABEL: Record<string, string> = {
  in_person: "対面",
  phone: "電話",
  video: "オンライン",
  written: "文書",
};

/** What to tell the learner to do. The act is the same everywhere, but the
 *  instruction is not: "最も適切な言い方" makes no sense for a reading item. */
const PROMPT_BY_TYPE: Record<string, string> = {
  hatsugen_choukai: "この場面で最も適切な言い方を選んでください。",
  hyougen: "この場面で最も適切な表現を選んでください。",
  goi_bunpou: "空欄に入る最も適切なものを選んでください。",
  bamen_haaku: "聞いた内容に合うものを選んでください。",
  sougou_choukai: "会話の内容に合うものを選んでください。",
  joukyou_haaku: "掲示と依頼の両方をふまえて選んでください。",
  shiryou_choudokkai: "資料と音声の両方をふまえて選んでください。",
  sougou_choudokkai: "会話と資料の両方をふまえて選んでください。",
  sougou_dokkai: "文書から読み取れることを選んでください。",
};

export default function Practice() {
  const router = useRouter();
  const { session, loading: authLoading, error: authError } = useAuth();
  const params = useLocalSearchParams<{ mode?: string; itemType?: string; level?: string }>();
  const mode = (params.mode as PracticeMode) ?? "daily";
  // Free and mock runs come from the picker, which names what to practise.
  // Daily and weakness do not: the whole point of those is that the app chooses.
  const itemType = params.itemType || null;
  const level = (params.level as Level) || null;

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
        const limit = mode === "mock" ? MOCK_LENGTH : (profile?.daily_goal ?? 5);
        const queue = await fetchQueue({ limit, mode, itemType, level });
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
  }, [session?.user?.id, mode, itemType, level]);

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
  const sceneImage = sceneUrl(item.scene_image_path);
  // A clip id means this type narrates; a null path means it has not been
  // synthesised yet. Either way there is something to show — the difference is
  // whether it is a play button or the text of it.
  const hasNarration = Boolean(item.narration_clip_id);

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

        {sceneImage ? (
          // Decorative on purpose. The scene is one of sixteen shared drawings,
          // so it cannot contain the answer — describing it to a screen reader
          // would be describing a stock illustration, not the question.
          <Image
            source={{ uri: sceneImage }}
            style={styles.scene}
            resizeMode="cover"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}

        {/* The stimulus, in the order it is met: what you read, then what you
            hear. A document comes first because the audio usually revises it —
            hearing the change before reading the original teaches nothing. */}
        {item.documents?.map((doc, i) => (
          <DocumentView key={`${item.id}-doc-${i}`} doc={doc} />
        ))}

        {item.dialogue?.length ? <DialoguePlayer turns={item.dialogue} /> : null}

        {hasNarration ? (
          <ClipButton
            path={item.narration_path}
            text={item.stem}
            label={item.dialogue?.length ? "質問を聞く" : "場面を聞く"}
          />
        ) : (
          // Nothing is spoken for this type. The stem is the question, read.
          <Text style={type.body}>{item.stem}</Text>
        )}
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
        <Text style={[type.small, styles.hint]}>
          {PROMPT_BY_TYPE[item.item_type] ?? "最も適切なものを選んでください。"}
        </Text>
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
  scene: { width: "100%", aspectRatio: 3 / 2, borderRadius: radius.sm, backgroundColor: colors.accentSoft },
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
