/**
 * The practice screen. Everything else in the app exists to get someone here.
 *
 * One question is four moments, met in order, and the screen shows one at a
 * time:
 *
 *   scene   — who you are, who you are talking to, where. A picture, a
 *             document if there is one. Nothing to answer yet.
 *   listen  — the audio plays, once, by itself. No options on screen: the
 *             first listen is a listen, not a skim of the answers.
 *   answer  — the four options, and a button to hear it again.
 *   reveal  — the other person's face, one sentence about what happened, and
 *             the explanation folded under it for those who want it.
 *
 * Reading items have no audio and skip straight to the options, as they do in
 * the exam. Items whose audio has not been synthesised yet show the narration
 * as text — content ships before media, and a listening item with no clip is
 * still a usable reading item.
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
import { Image, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from "react-native";

import { useAuth } from "../src/lib/auth";
import {
  clipUrl,
  fetchProfile,
  fetchQueue,
  finishSession,
  recordAttempt,
  sceneUrl,
  startSession,
} from "../src/lib/db";
import { verdictFor } from "../src/lib/roles";
import { setSummary } from "../src/lib/session";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/supabase";
import type { AnsweredItem, Level, PracticeMode, QueuedItem } from "../src/lib/types";
import { AutoPlaylist, DialoguePlayer } from "../src/ui/audio";
import { Button, Card, Loading, Notice, Tag } from "../src/ui/components";
import { DocumentView } from "../src/ui/document";
import { Face, MOOD_LABEL, moodFor } from "../src/ui/face";
import { RudenessMeter } from "../src/ui/meters";
import { colors, radius, shadow, space, type } from "../src/ui/theme";

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

type Stage = "scene" | "listen" | "answer" | "reveal";

/** Every clip of an item, in the order it is heard: the conversation, then the
 *  question. Turns without a clip yet are skipped, not waited for. */
function playlistFor(item: QueuedItem): string[] {
  const turns = (item.dialogue ?? [])
    .map((t) => clipUrl(t.audio_path))
    .filter((u): u is string => Boolean(u));
  const narration = clipUrl(item.narration_path);
  return narration ? [...turns, narration] : turns;
}

/** A tap you can feel. Pattern durations are ignored on iOS, which is fine —
 *  the point is that something happened, not how long it lasted. */
function buzz(pattern: number | number[]) {
  try {
    Vibration.vibrate(pattern);
  } catch {
    // Web without vibration support, or a simulator. Silence is correct.
  }
}

export default function Practice() {
  const router = useRouter();
  const { session, loading: authLoading, error: authError } = useAuth();
  const params = useLocalSearchParams<{ mode?: string; itemType?: string }>();
  const mode = (params.mode as PracticeMode) ?? "daily";
  // A manual run names a type. The daily set does not: the whole point of it is
  // that the app chooses, including the level.
  const itemType = params.itemType || null;

  const [items, setItems] = useState<QueuedItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [stageAt, setStageAt] = useState<{ index: number; stage: Stage } | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [graded, setGraded] = useState<{ isCorrect: boolean; chosenRole: string } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [answers, setAnswers] = useState<AnsweredItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startedAt = useRef(Date.now());
  const questionShownAt = useRef(Date.now());
  const levelBefore = useRef<Level | null>(null);

  useEffect(() => {
    if (!isConfigured || !session?.user) return;
    let cancelled = false;
    (async () => {
      try {
        const profile = await fetchProfile();
        levelBefore.current = profile?.target_level ?? null;
        const limit = mode === "mock" ? MOCK_LENGTH : (profile?.daily_goal ?? 5);
        const queue = await fetchQueue({ limit, mode, itemType });
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
  }, [session?.user?.id, mode, itemType]);

  const item = items?.[index];
  const options = useMemo(
    () => (item ? [...item.options].sort((a, b) => a.position - b.position) : []),
    [item]
  );
  const playlist = useMemo(() => (item ? playlistFor(item) : []), [item]);

  if (!isConfigured) {
    return (
      <View style={styles.page}>
        <Notice title="設定が必要です" body={MISSING_CONFIG_MESSAGE} tone="warn" />
      </View>
    );
  }
  if (authLoading) return <Loading label="問題を用意しています…" />;
  if (authError) {
    return (
      <View style={styles.page}>
        <Notice
          title="接続できません"
          body={authError}
          tone="warn"
          action={{ label: "戻る", onPress: () => router.back() }}
        />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.page}>
        <Notice
          title="問題を読み込めません"
          body={error}
          tone="warn"
          action={{ label: "戻る", onPress: () => router.back() }}
        />
      </View>
    );
  }
  if (!items) return <Loading label="問題を用意しています…" />;

  if (items.length === 0) {
    return (
      <View style={styles.page}>
        <Notice
          title="出せる問題がありません"
          body="いまのレベルの問題をすべて解いたか、まだ問題が公開されていません。"
          tone="warn"
          action={{ label: "戻る", onPress: () => router.back() }}
        />
      </View>
    );
  }
  if (!item) return <Loading />;

  const sceneImage = sceneUrl(item.scene_image_path);
  const listenable = playlist.length > 0;
  // A scene is worth a pause of its own when there is something to hear or
  // something to look at. A bare reading item goes straight to the question.
  const hasScene = listenable || Boolean(sceneImage);
  const stage: Stage =
    stageAt?.index === index ? stageAt.stage : hasScene ? "scene" : "answer";
  const go = (next: Stage) => setStageAt({ index, stage: next });

  // Narration that exists only as text — a listening type whose clip has not
  // been synthesised, or a reading type, where the stem *is* the question.
  const narrationUrl = clipUrl(item.narration_path);
  const stemAsText = !narrationUrl;
  const dialogueAsText = (item.dialogue?.length ?? 0) > 0 && !listenable;

  async function choose(position: number) {
    if (chosen !== null || busy || !item) return;
    buzz(12);
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
      buzz(result.isCorrect ? [0, 18, 60, 18] : 40);
    } catch (e) {
      // Let them see the answer even if recording failed; grading locally here
      // is a display fallback only, and nothing is written from it.
      const isCorrect = position === item.correct_index;
      setGraded({ isCorrect, chosenRole: options[position]?.role ?? "" });
      setAnswers((prev) => [...prev, { item, chosenIndex: position, isCorrect }]);
    } finally {
      setBusy(false);
      go("reveal");
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
        levelBefore: levelBefore.current,
      });
      router.replace("/result");
      return;
    }
    setIndex((i) => i + 1);
    setChosen(null);
    setGraded(null);
    setShowDetails(false);
    questionShownAt.current = Date.now();
  }

  const revealed = stage === "reveal" && graded !== null;
  const chosenOption = chosen !== null ? options[chosen] : null;
  const correctOption = options[item.correct_index];
  const role = graded?.chosenRole || chosenOption?.role || "";
  const mood = graded ? moodFor(role, graded.isCorrect) : "happy";

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.progressRow}>
        <Text style={type.small}>
          {index + 1} / {items.length}
        </Text>
        <View style={styles.bar}>
          <View
            style={[
              styles.barFill,
              { width: `${((index + (revealed ? 1 : 0)) / items.length) * 100}%` },
            ]}
          />
        </View>
        {item.times_seen > 0 ? <Tag tone="amber">もう一度</Tag> : null}
      </View>

      <SceneStrip item={item} big={stage === "scene"} />

      {stage === "scene" ? (
        <Card style={{ gap: space.lg }}>
          {sceneImage ? <SceneImage uri={sceneImage} /> : null}
          {item.documents?.map((doc, i) => (
            <DocumentView key={`${item.id}-doc-${i}`} doc={doc} />
          ))}
          <Text style={[type.small, styles.hint]}>
            {listenable ? "準備ができたら、聞いてください。一回だけ流れます。" : "準備ができたら、問題へ。"}
          </Text>
          <Button
            label={listenable ? "聞く" : "問題へ"}
            icon={listenable ? "headphones" : "chevron"}
            onPress={() => go(listenable ? "listen" : "answer")}
          />
        </Card>
      ) : (
        <Card style={{ gap: space.md }}>
          {sceneImage ? <SceneImage uri={sceneImage} small /> : null}

          {/* The stimulus, in the order it is met: what you read, then what you
              hear. A document comes first because the audio usually revises it —
              hearing the change before reading the original teaches nothing. */}
          {item.documents?.map((doc, i) => (
            <DocumentView key={`${item.id}-doc-${i}`} doc={doc} />
          ))}

          {dialogueAsText ? <DialoguePlayer turns={item.dialogue} /> : null}

          {listenable ? (
            <AutoPlaylist
              key={item.id}
              urls={playlist}
              autoplay={stage === "listen"}
              onFinished={() => go("answer")}
            />
          ) : null}

          {stemAsText ? <Text style={type.body}>{item.stem}</Text> : null}
        </Card>
      )}

      {stage === "listen" ? (
        <Text style={[type.small, styles.hint]}>聞き終わると、選択肢が出ます。</Text>
      ) : null}

      {stage === "answer" || stage === "reveal" ? (
        <>
          {!revealed ? (
            <Text style={[type.small, styles.hint]}>
              {PROMPT_BY_TYPE[item.item_type] ?? "最も適切なものを選んでください。"}
            </Text>
          ) : null}

          <View style={{ gap: space.md }}>
            {options.map((option, i) => {
              const isChosen = chosen === i;
              const isAnswer = i === item.correct_index;
              const show = revealed && (isChosen || isAnswer);
              const dim = revealed && !show;
              return (
                <Pressable
                  key={option.position}
                  accessibilityRole="button"
                  disabled={revealed || busy || chosen !== null}
                  onPress={() => choose(i)}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && !revealed && { opacity: 0.85 },
                    isChosen && !revealed && styles.optionPending,
                    show && (isAnswer ? styles.optionCorrect : styles.optionWrong),
                    dim && { opacity: 0.5 },
                  ]}
                >
                  <View style={styles.optionHeader}>
                    <View
                      style={[
                        styles.letterBadge,
                        show && (isAnswer ? styles.letterBadgeCorrect : styles.letterBadgeWrong),
                      ]}
                    >
                      <Text
                        style={[
                          styles.letter,
                          show && { color: isAnswer ? colors.correct : colors.wrong },
                        ]}
                      >
                        {LETTERS[i]}
                      </Text>
                    </View>
                    {show ? (
                      // A word as well as a colour: the marker has to survive being
                      // read by someone who cannot tell the green from the red.
                      <Text
                        style={[
                          type.small,
                          { color: isAnswer ? colors.correct : colors.wrong, fontWeight: "700" },
                        ]}
                      >
                        {isAnswer ? "○ 正解" : "× これを選びました"}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={type.option}>{option.text}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {revealed && graded ? (
        <View style={{ gap: space.lg }}>
          <Card
            style={{
              gap: space.md,
              backgroundColor: graded.isCorrect ? colors.correctSoft : colors.wrongSoft,
            }}
          >
            <View style={styles.verdictRow}>
              <Face mood={mood} size={68} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.h2, graded.isCorrect && { color: colors.correct }]}>
                  {graded.isCorrect ? "正解です" : verdictFor(role, item.listener_role)}
                </Text>
                <Text style={type.small}>
                  {graded.isCorrect ? correctOption?.why : MOOD_LABEL[mood]}
                </Text>
              </View>
            </View>
            {!graded.isCorrect ? <RudenessMeter role={role} showLabel={false} /> : null}
          </Card>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showDetails }}
            onPress={() => setShowDetails((v) => !v)}
            style={({ pressed }) => [pressed && { opacity: 0.85 }]}
          >
            <Text style={[type.small, styles.toggle]}>
              {showDetails ? "解説をとじる" : "解説をくわしく見る"}
            </Text>
          </Pressable>

          {showDetails ? (
            <Card style={{ gap: space.md }}>
              <Text style={type.body}>{item.explanation_ja}</Text>
              <View style={{ gap: space.sm }}>
                {options.map((option, i) => (
                  <View key={option.position} style={styles.why}>
                    <Text style={[type.small, { fontWeight: "700", color: colors.text }]}>
                      {LETTERS[i]}　{option.text}
                    </Text>
                    <Text style={type.small}>{option.why}</Text>
                  </View>
                ))}
              </View>
              {item.vocab_notes?.length ? (
                <View style={{ gap: space.xs }}>
                  {item.vocab_notes.map((note) => (
                    <Text key={note.term} style={type.small}>
                      {note.term}（{note.reading}）— {note.meaning}
                    </Text>
                  ))}
                </View>
              ) : null}
              {!stemAsText ? <Text style={type.small}>{item.stem}</Text> : null}
              {listenable && item.dialogue?.length ? (
                <View style={{ gap: space.xs }}>
                  {item.dialogue.map((turn, i) => (
                    <Text key={i} style={type.small}>
                      {turn.speaker_role}：{turn.text}
                    </Text>
                  ))}
                </View>
              ) : null}
            </Card>
          ) : null}

          <Button
            label={index + 1 >= items.length ? "結果を見る" : "次の問題へ"}
            icon="chevron"
            onPress={next}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

/** Who you are, who you are talking to, and how. Big while entering the scene,
 *  a quiet row once the question is on screen. */
function SceneStrip({ item, big }: { item: QueuedItem; big: boolean }) {
  const parts: { k: string; v: string }[] = [];
  if (item.speaker_role) parts.push({ k: "あなた", v: item.speaker_role });
  if (item.listener_role) parts.push({ k: "相手", v: item.listener_role });
  if (item.channel) parts.push({ k: "", v: CHANNEL_LABEL[item.channel] ?? item.channel });
  if (!parts.length) return null;
  return (
    <View style={styles.strip}>
      {parts.map((p) => (
        <View key={p.k + p.v} style={[styles.stripPill, big && styles.stripPillBig]}>
          {p.k ? <Text style={type.label}>{p.k}</Text> : null}
          <Text style={big ? styles.stripValueBig : styles.stripValue}>{p.v}</Text>
        </View>
      ))}
    </View>
  );
}

function SceneImage({ uri, small }: { uri: string; small?: boolean }) {
  return (
    // Decorative on purpose. The scene is one of sixteen shared drawings, so it
    // cannot contain the answer — describing it to a screen reader would be
    // describing a stock illustration, not the question.
    <Image
      source={{ uri }}
      style={[styles.scene, small && styles.sceneSmall]}
      resizeMode="cover"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  progressRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  bar: { flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: "hidden" },
  barFill: { height: 6, backgroundColor: colors.accent, borderRadius: 3 },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  stripPill: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 1,
    ...shadow.card,
  },
  stripPillBig: { paddingHorizontal: space.lg, paddingVertical: space.md },
  stripValue: { fontSize: 14, fontWeight: "700", color: colors.text },
  stripValueBig: { fontSize: 17, fontWeight: "700", color: colors.text, lineHeight: 24 },
  scene: {
    width: "100%",
    aspectRatio: 3 / 2,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
  },
  sceneSmall: { aspectRatio: 3 / 1 },
  option: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.xs,
    ...shadow.card,
  },
  optionHeader: { flexDirection: "row", alignItems: "center", gap: space.sm },
  optionPending: { borderColor: colors.accent },
  optionCorrect: { borderColor: colors.correct, backgroundColor: colors.correctSoft },
  optionWrong: { borderColor: colors.wrong, backgroundColor: colors.wrongSoft },
  letterBadge: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  letterBadgeCorrect: { backgroundColor: "rgba(14,159,110,0.16)" },
  letterBadgeWrong: { backgroundColor: "rgba(217,58,75,0.16)" },
  letter: { fontSize: 13, fontWeight: "700", color: colors.accent },
  verdictRow: { flexDirection: "row", alignItems: "center", gap: space.lg },
  why: { gap: 2 },
  hint: { textAlign: "center" },
  toggle: { textAlign: "center", textDecorationLine: "underline" },
});
