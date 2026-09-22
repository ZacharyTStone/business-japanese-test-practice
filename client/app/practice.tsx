/**
 * The practice screen. Everything else in the app exists to get someone here.
 *
 * It takes no arguments. There is one kind of practice run — the set the
 * database built from this learner's record — because every parameter this
 * screen used to accept (a mode, a problem type, a level) was a way for somebody
 * to overrule the only thing the app is for.
 *
 * One question is four moments, met in order, and the screen shows one at a
 * time:
 *
 *   scene   — who you are, who you are talking to, where. A picture, a
 *             document if there is one. Nothing to answer yet.
 *   listen  — the audio plays, once, by itself. Nothing readable about the
 *             answers is on screen: the first listen is a listen, not a skim.
 *             When the options are spoken (発言聴解) they are on screen from
 *             here as letters with a play button, and can be pressed — a
 *             learner who knows the answer at the second turn should not have
 *             to wait for the fourth. Options that are text wait for the
 *             answer stage. The owner asked for this (2026-09-18).
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
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from "react-native";

import { useAuth } from "../src/lib/auth";
import {
  clipUrl,
  fetchDay,
  fetchOptionLetters,
  fetchPace,
  fetchProfile,
  fetchQueue,
  fetchSectionLevels,
  finishSession,
  mayVeto,
  recordAttempt,
  sceneUrl,
  startSession,
} from "../src/lib/db";
import { useLang, type Key } from "../src/lib/i18n";
import { budgetSeconds, type TypePace } from "../src/lib/pace";
import { verdictFor } from "../src/lib/roles";
import { setSummary } from "../src/lib/session";
import { errorText, isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/supabase";
import { NO_ANSWER, type AnsweredItem, type QueuedItem, type SectionLevel } from "../src/lib/types";
import { AutoPlaylist, DialoguePlayer, MiniPlay } from "../src/ui/audio";
import { QuestionClock } from "../src/ui/clock";
import { Button, Card, Loading, Notice, ProgressBar, Tag } from "../src/ui/components";
import { DayDone } from "../src/ui/done";
import { DocumentView } from "../src/ui/document";
import { Face, moodFor, moodLabel } from "../src/ui/face";
import { HAS_KEYBOARD, optionForKey, useKeys } from "../src/ui/keys";
import { RudenessMeter } from "../src/ui/meters";
import { FadeIn } from "../src/ui/motion";
import { ReportQuestion } from "../src/ui/report";
import { VetoQuestion } from "../src/ui/veto";
import { colors, radius, shadow, space, tabular, type } from "../src/ui/theme";

const LETTERS = ["A", "B", "C", "D"];

const CHANNEL_KEY: Record<string, Key> = {
  in_person: "ch_in_person",
  phone: "ch_phone",
  video: "ch_video",
  written: "ch_written",
};

/** How the words travel, as a picture. It is the one part of the scene that
 *  changes the right answer without being in the sentence — on the phone you
 *  name yourself and your company, face to face you do not — so it is worth
 *  being the thing the eye finds first in the strip. */
const CHANNEL_EMOJI: Record<string, string> = {
  in_person: "🤝",
  phone: "📞",
  video: "💻",
  written: "✉️",
};

/** What to tell the learner to do. The act is the same everywhere, but the
 *  instruction is not: "最も適切な言い方" makes no sense for a reading item. */
const PROMPT_KEY: Record<string, Key> = {
  hatsugen_choukai: "prompt_hatsugen_choukai",
  gazou_haaku: "prompt_gazou_haaku",
  hyougen: "prompt_hyougen",
  goi_bunpou: "prompt_goi_bunpou",
  bamen_haaku: "prompt_bamen_haaku",
  sougou_choukai: "prompt_sougou_choukai",
  joukyou_haaku: "prompt_joukyou_haaku",
  shiryou_choudokkai: "prompt_shiryou_choudokkai",
  sougou_choudokkai: "prompt_sougou_choudokkai",
  sougou_dokkai: "prompt_sougou_dokkai",
};

type Stage = "scene" | "listen" | "answer" | "reveal";

/** The types whose four options are heard rather than read — which on the exam
 *  is **all of 第1部 聴解**: the screen shows the picture and the bare numerals,
 *  the four candidates are read aloud, and in 総合聴解 there is nothing on the
 *  screen at all. Must agree with TYPE_AUDIO in bjt/tts/plan.py, which is where
 *  the clips come from; an item whose clips do not exist yet falls back to
 *  printed options on its own (see spokenOptionUrls). */
const SPOKEN_OPTION_TYPES = new Set([
  "bamen_haaku",
  "gazou_haaku",
  "hatsugen_choukai",
  "sougou_choukai",
]);

/**
 * The four spoken options of an item, when every one of them has a clip.
 *
 * In the exam these are heard, never read: the answer sheet has four numbers
 * and nothing else. So when the audio exists the options are played after the
 * narration and shown as letters with a replay button, and the text stays
 * hidden until the answer is in. All four or none — a set where three are
 * spoken and one is printed would mark the odd one out, and the type table in
 * bjt/tts/plan.py is the only reason any other type would have option clips.
 */
function spokenOptionUrls(item: QueuedItem): string[] | null {
  if (!SPOKEN_OPTION_TYPES.has(item.item_type)) return null;
  const urls = [...item.options]
    .sort((a, b) => a.position - b.position)
    .map((o) => clipUrl(o.audio_path));
  return urls.every((u): u is string => Boolean(u)) ? (urls as string[]) : null;
}

/** Every clip of an item, in the order it is heard: the conversation, then the
 *  question, then — for 発言聴解 — the four things one might say, each behind
 *  the letter that names it. Turns without a clip yet are skipped, not waited
 *  for, and so are the letters: they are four clips for the whole library
 *  (fetchOptionLetters), so before they are synthesised this is exactly the
 *  run it always was. */
function playlistFor(item: QueuedItem, letters: string[] | null): string[] {
  const turns = (item.dialogue ?? [])
    .map((t) => clipUrl(t.audio_path))
    .filter((u): u is string => Boolean(u));
  const narration = clipUrl(item.narration_path);
  const spoken = spokenOptionUrls(item) ?? [];
  const options = spoken.flatMap((url, i) =>
    letters?.[i] ? [letters[i], url] : [url]
  );
  return [...turns, ...(narration ? [narration] : []), ...options];
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
  const { lang, t } = useLang();
  const { session, loading: authLoading, error: authError } = useAuth();
  // A direct load of /practice — a deep link, a refresh — has nothing behind
  // it to go back to; history.tsx hit the same thing first. "Back" from here
  // always has to land somewhere.
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const [items, setItems] = useState<QueuedItem[] | null>(null);
  // Asked once per screen. False for every tester but the owner, and the
  // server re-checks it, so this only decides whether a button is drawn.
  const [canVeto, setCanVeto] = useState(false);
  const [index, setIndex] = useState(0);
  const [stageAt, setStageAt] = useState<{ index: number; stage: Stage } | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [graded, setGraded] = useState<{ isCorrect: boolean; chosenRole: string } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  // The learner asked to see spoken options as text before answering. Practice
  // is not the exam, and the fourth listen sometimes needs the page; but it is
  // off by default and resets with every item, so the listen comes first.
  const [optionsAsText, setOptionsAsText] = useState(false);
  /** The option under a pointer, on a machine that has one. */
  const [hovered, setHovered] = useState<number | null>(null);
  const [answers, setAnswers] = useState<AnsweredItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Today's count when the day's ceiling has been reached; null otherwise. */
  const [blocked, setBlocked] = useState<number | null>(null);
  /** What the exam affords each self-paced type, and whether this learner wants
   *  it counted. Both are furniture: if either fails to load the set is
   *  practised without a clock rather than not at all. */
  const [pace, setPace] = useState<Record<string, TypePace>>({});
  const [timed, setTimed] = useState(false);
  /** 「エー」「ビー」「シー」「ディー」, or null until all four are synthesised.
   *  Furniture too: an item whose options are spoken is still practisable with
   *  nothing but the options, which is how it worked before they existed. */
  const [letters, setLetters] = useState<string[] | null>(null);

  const startedAt = useRef(Date.now());
  const questionShownAt = useRef(Date.now());
  const levelsBefore = useRef<SectionLevel[]>([]);
  // Answering a question near the bottom of a long item used to change nothing
  // a phone could see: the option turned green under the thumb and the verdict
  // appeared below the fold. This puts it on screen.
  const scroller = useRef<ScrollView>(null);
  // Which question has already been scrolled to its verdict. onLayout fires
  // again when the explanation is unfolded, and without this the screen would
  // snap back to the top just as somebody started reading it.
  const scrolledFor = useRef<number | null>(null);
  // One press, one move. `chosen` and `index` are state, and state does not
  // change until the next render, so two presses landing in the same tick both
  // read the old value and both go through: a browser that delivers a tap as
  // touch *and* click, or a key the focused control handled before this screen
  // saw it. Answering twice wrote two attempts for one question; advancing
  // twice stepped over a question without asking it, which is why the counter
  // went 1 / 5 to 3 / 5 and never showed 2 / 5. A ref is written immediately,
  // so the second press finds the door already shut.
  const answeredFor = useRef<number | null>(null);
  const advancedFrom = useRef<number | null>(null);

  useEffect(() => {
    if (!isConfigured || !session?.user) return;
    let cancelled = false;
    (async () => {
      try {
        const [day, levels, profile, paces, spokenLetters] = await Promise.all([
          fetchDay(),
          fetchSectionLevels(),
          // The clock is furniture. A set that cannot be timed is still a set,
          // so neither of these is allowed to fail the screen. Nor are the
          // spoken letters, which are the same four clips for every item.
          fetchProfile().catch(() => null),
          fetchPace().catch(() => ({}) as Record<string, TypePace>),
          fetchOptionLetters().catch(() => null),
        ]);
        // Read before the first answer, so the result screen can name the
        // section whose level moved rather than just that something did.
        levelsBefore.current = levels;
        setPace(paces);
        setTimed(profile?.timed_reading ?? false);
        setLetters(spokenLetters);
        // The size is what the day has left of its set, or the bonus set once
        // the set is done: the rest of the allowance, or a full set for an
        // account whose ceiling is lifted. Zero means the day is over, and the
        // database would serve nothing anyway — the screen below says so.
        const remaining =
          day.answered_today < day.goal
            ? day.goal - day.answered_today
            : day.unlimited
              ? day.goal
              : (day.left_today ?? 0);
        setBlocked(remaining <= 0 ? day.answered_today : null);
        const queue = remaining > 0 ? await fetchQueue(remaining) : [];
        if (cancelled) return;
        setItems(queue);
        mayVeto().then(setCanVeto).catch(() => setCanVeto(false));
        setSessionId(await startSession(session.user.id));
        questionShownAt.current = Date.now();
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const item = items?.[index];
  const options = useMemo(
    () => (item ? [...item.options].sort((a, b) => a.position - b.position) : []),
    [item]
  );
  const playlist = useMemo(() => (item ? playlistFor(item, letters) : []), [item, letters]);
  const spokenOptions = useMemo(() => (item ? spokenOptionUrls(item) : null), [item]);

  if (!isConfigured) {
    return (
      <View style={styles.page}>
        <Notice title={t("config_needed")} body={MISSING_CONFIG_MESSAGE} tone="warn" />
      </View>
    );
  }
  if (authLoading) return <Loading label={t("preparing")} />;
  if (authError) {
    return (
      <View style={styles.page}>
        <Notice
          title={t("cant_connect")}
          body={authError}
          tone="warn"
          action={{ label: t("back"), onPress: leave }}
        />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.page}>
        <Notice
          title={t("q_load_err")}
          body={error}
          tone="warn"
          action={{ label: t("back"), onPress: leave }}
        />
      </View>
    );
  }
  if (!items) return <Loading label={t("preparing")} />;

  if (blocked !== null) {
    // The door, from this side: a deep link or a stale tab past the ceiling.
    return (
      <View style={styles.page}>
        <DayDone answered={blocked} streak={0} onHome={() => router.replace("/")} />
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <View style={styles.page}>
        <Notice
          title={t("no_q_title")}
          body={t("no_q_body")}
          tone="warn"
          action={{ label: t("back"), onPress: leave }}
        />
      </View>
    );
  }
  if (!item) return <Loading />;

  const sceneImage = sceneUrl(item.scene_image_path);
  // How long this question gets, from the exam's budget for its type and the
  // amount there is to read in this particular one. Zero means no clock — see
  // budgetSeconds — and the learner's switch is the only part of it that is
  // about the learner rather than about the question.
  const clockSeconds = timed ? budgetSeconds(item, pace) : 0;
  const listenable = playlist.length > 0;
  // A scene is worth a pause of its own when there is something to hear or
  // something to look at. A bare reading item goes straight to the question.
  const hasScene = listenable || Boolean(sceneImage);
  const stage: Stage =
    stageAt?.index === index ? stageAt.stage : hasScene ? "scene" : "answer";
  // Never back out of a reveal: an answer given while the clips were still
  // playing must not be undone by the playlist finishing and asking for the
  // answer stage. Read from the setter so the check sees the latest state,
  // not the render the playlist's callback was created in.
  const go = (next: Stage) =>
    setStageAt((prev) =>
      prev?.index === index && prev.stage === "reveal" && next !== "reveal" ? prev : { index, stage: next }
    );

  // Narration that exists only as text — a listening type whose clip has not
  // been synthesised, or a reading type, where the stem *is* the question.
  const narrationUrl = clipUrl(item.narration_path);
  const stemAsText = !narrationUrl;
  const dialogueAsText = (item.dialogue?.length ?? 0) > 0 && !listenable;

  /**
   * Answer the question — or, with `NO_ANSWER`, record that the clock took it.
   *
   * The two paths are deliberately the same path. A question the clock took is
   * a question that was got wrong, and it belongs in the record on exactly the
   * same terms as any other: it counts against the day, it drops to the bottom
   * of the spacing ladder, and `adjust_level()` weighs it. The only difference
   * is that the database grades it from `chosen_index = -1` rather than from an
   * option, and hands back the role `timed_out`.
   */
  async function choose(position: number) {
    if (chosen !== null || busy || !item) return;
    if (answeredFor.current === index) return;
    answeredFor.current = index;
    const ranOut = position === NO_ANSWER;
    // A longer single buzz for the clock: it is the one verdict that arrives
    // without anybody having pressed anything, so it announces itself.
    buzz(ranOut ? 60 : 12);
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
      setAnswers((prev) => [
        ...prev,
        { item, chosenIndex: position, isCorrect: result.isCorrect, role: result.chosenRole },
      ]);
      buzz(result.isCorrect ? [0, 18, 60, 18] : 40);
    } catch (e) {
      // Let them see the answer even if recording failed; grading locally here
      // is a display fallback only, and nothing is written from it.
      const isCorrect = !ranOut && position === item.correct_index;
      const role = ranOut ? "timed_out" : (options[position]?.role ?? "");
      setGraded({ isCorrect, chosenRole: role });
      setAnswers((prev) => [...prev, { item, chosenIndex: position, isCorrect, role }]);
    } finally {
      setBusy(false);
      go("reveal");
    }
  }

  /**
   * The question is out of the bank; take it out of this set too.
   *
   * No attempt is written, so nothing is graded, nothing is scheduled for
   * review and the day's count does not move — vetoing is instead of
   * answering. The set simply gets one shorter: the item is spliced out and
   * `index` stays put, which lands on what was the next question. If it was
   * the last one, the set is over and the result screen is where we were
   * going anyway.
   */
  function vetoed() {
    const rest = items!.filter((_, i) => i !== index);
    // The bookkeeping is keyed by index, and every index at or after this one
    // now names a different question. Clearing it is what stops the next
    // question inheriting this one's "already answered".
    answeredFor.current = null;
    advancedFrom.current = null;
    scrolledFor.current = null;
    if (index >= rest.length) {
      if (rest.length === 0) {
        router.replace("/");
        return;
      }
      setItems(rest);
      if (sessionId) void finishSession(sessionId);
      setSummary({
        answers,
        startedAt: startedAt.current,
        finishedAt: Date.now(),
        levelsBefore: levelsBefore.current,
      });
      router.replace("/result");
      return;
    }
    setItems(rest);
    setChosen(null);
    setGraded(null);
    setShowDetails(false);
    setOptionsAsText(false);
    setHovered(null);
    questionShownAt.current = Date.now();
  }

  async function next() {
    if (advancedFrom.current === index) return;
    advancedFrom.current = index;
    const last = index + 1 >= items!.length;
    if (last) {
      if (sessionId) await finishSession(sessionId);
      setSummary({
        answers,
        startedAt: startedAt.current,
        finishedAt: Date.now(),
        levelsBefore: levelsBefore.current,
      });
      router.replace("/result");
      return;
    }
    setIndex((i) => i + 1);
    setChosen(null);
    setGraded(null);
    setShowDetails(false);
    setOptionsAsText(false);
    setHovered(null);
    scrolledFor.current = null;
    questionShownAt.current = Date.now();
  }

  const revealed = stage === "reveal" && graded !== null;
  // Spoken options are letters until the answer is in, unless asked for.
  const optionTextHidden = spokenOptions !== null && !revealed && !optionsAsText;
  // Options can be answered while the clips still play, but only when they
  // show no text: letters and play buttons give nothing away, a printed
  // sentence does.
  const optionsShown = stage === "answer" || stage === "reveal" || (stage === "listen" && optionTextHidden);
  const chosenOption = chosen !== null ? options[chosen] : null;
  const correctOption = options[item.correct_index];
  const role = graded?.chosenRole || chosenOption?.role || "";
  // The clock took it. Not a wrong answer about the Japanese, so the screen says
  // something different and the 失礼度メーター stays out of it: nobody was
  // offended, because nobody said anything.
  const ranOut = role === "timed_out";
  const mood = graded ? moodFor(role, graded.isCorrect) : "happy";
  const explanation = lang === "en" && item.explanation_en ? item.explanation_en : item.explanation_ja;
  // The one line under the verdict. For a right answer it is why that option
  // fits — and the per-option `why` is written in Japanese only, so in English
  // the item's own gloss is the sentence that exists. Wrong answers get the
  // listener's reaction instead, which is already translated.
  const verdictSub = graded
    ? graded.isCorrect
      ? lang === "en" && item.explanation_en
        ? item.explanation_en
        : correctOption?.why
      : ranOut
        ? t("time_up_sub")
        : moodLabel(mood, lang)
    : "";

  /** The four keys that matter, and nothing else. See src/ui/keys.ts. */
  function onKey(key: string): boolean | void {
    if (!revealed && optionsShown && chosen === null && !busy) {
      const pick = optionForKey(key, options.length);
      if (pick >= 0) {
        void choose(pick);
        return;
      }
    }
    if (key === "Enter" || key === " ") {
      if (revealed) {
        void next();
        return;
      }
      if (stage === "scene") {
        go(listenable ? "listen" : "answer");
        return;
      }
    }
    return false;
  }

  return (
    <ScrollView
      ref={scroller}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <Keys onKey={onKey} />
      <View
        style={styles.progressRow}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t("q_of_n", { i: index + 1, n: items.length })}
      >
        <Text style={[type.small, tabular]}>
          {index + 1} / {items.length}
        </Text>
        <ProgressBar
          value={(index + (revealed ? 1 : 0)) / items.length}
          height={6}
          style={{ flex: 1 }}
        />
        {item.times_seen > 0 ? <Tag tone="amber">{t("again_tag")}</Tag> : null}
      </View>

      {/* The clock, on the reading questions only, directly under the counter:
          both of them answer "where am I", and a learner scrolling a long
          passage scrolls back to one place rather than two. It keeps running
          until the answer is in and then freezes at what was left, which is the
          number worth seeing on the way to the next question. */}
      {clockSeconds > 0 ? (
        <QuestionClock
          seconds={clockSeconds}
          running={stage === "answer" && chosen === null && !busy}
          runKey={item.id}
          onExpire={() => void choose(NO_ANSWER)}
        />
      ) : null}

      <SceneStrip item={item} big={stage === "scene"} />

      {/* Each stage of a question arrives rather than snaps: the scene card,
          then the question card in its place. The key is what makes the
          second one arrive too — same component, new content. */}
      {stage === "scene" ? (
        <FadeIn key={`${item.id}-scene`}>
          <Card style={{ gap: space.lg }}>
            {sceneImage ? <SceneImage uri={sceneImage} /> : null}
            {item.documents?.map((doc, i) => (
              <DocumentView key={`${item.id}-doc-${i}`} doc={doc} />
            ))}
            <Text style={[type.small, styles.hint]}>
              {listenable ? t("scene_hint_listen") : t("scene_hint_read")}
            </Text>
            <Button
              label={listenable ? t("btn_listen") : t("btn_to_q")}
              icon={listenable ? "headphones" : "chevron"}
              onPress={() => go(listenable ? "listen" : "answer")}
            />
          </Card>
        </FadeIn>
      ) : (
        <FadeIn key={`${item.id}-question`}>
          <Card style={{ gap: space.md }}>
            {/* The same picture at the same size as on the scene card. It used
                to shrink to a strip once the audio started, which cropped the
                drawing to a band of ceiling; the owner asked for it whole
                (2026-09-18). */}
            {sceneImage ? <SceneImage uri={sceneImage} /> : null}

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
        </FadeIn>
      )}

      {stage === "listen" ? (
        <Text style={[type.small, styles.hint]}>{t("listen_hint")}</Text>
      ) : null}

      {optionsShown ? (
        <>
          {stage === "answer" ? (
            <Text style={[type.small, styles.hint]}>
              {t(PROMPT_KEY[item.item_type] ?? "prompt_default")}
            </Text>
          ) : null}

          {/* A shortcut nobody is told about is a shortcut nobody uses. One
              quiet line, only where there is a keyboard to press, and naming the
              key that works at this moment rather than both. */}
          {HAS_KEYBOARD && !revealed ? (
            <Text style={[type.mono, styles.hint]}>{t("key_hint_answer")}</Text>
          ) : null}

          {spokenOptions !== null && stage === "answer" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setOptionsAsText((v) => !v)}
              style={({ pressed }) => [pressed && { opacity: 0.85 }]}
            >
              <Text style={[type.small, styles.toggle]}>
                {optionsAsText ? t("hide_options_text") : t("show_options_text")}
              </Text>
            </Pressable>
          ) : null}

          <FadeIn key={`${item.id}-options`} style={{ gap: space.md }}>
            {options.map((option, i) => {
              const isChosen = chosen === i;
              const isAnswer = i === item.correct_index;
              const show = revealed && (isChosen || isAnswer);
              const dim = revealed && !show;
              const open = !revealed && !busy && chosen === null;
              return (
                <Pressable
                  key={option.position}
                  accessibilityRole="button"
                  // One label for the whole option, so a screen reader says
                  // "A. 承知いたしました" rather than reading a lone letter and
                  // then a sentence with nothing tying them together — and, once
                  // answered, says which one this was.
                  accessibilityLabel={
                    (optionTextHidden
                      ? t("option_spoken", { letter: LETTERS[i] })
                      : `${LETTERS[i]}. ${option.text}`) +
                    (show ? ` — ${isAnswer ? t("mark_correct") : t("mark_chosen")}` : "")
                  }
                  accessibilityState={{ disabled: revealed || busy || chosen !== null }}
                  disabled={revealed || busy || chosen !== null}
                  onPress={() => choose(i)}
                  onHoverIn={() => setHovered(i)}
                  onHoverOut={() => setHovered((h) => (h === i ? null : h))}
                  style={({ pressed }) => [
                    styles.option,
                    open && hovered === i && styles.optionHover,
                    pressed && !revealed && { opacity: 0.85 },
                    isChosen && !revealed && styles.optionPending,
                    show && (isAnswer ? styles.optionCorrect : styles.optionWrong),
                    // Set aside, not faded. After the answer these two are
                    // neither the choice nor the key, and they step back by
                    // going flat and grey — which leaves them legible, since
                    // "what were the other two?" is a question worth being
                    // able to answer.
                    dim && styles.optionAside,
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
                    {spokenOptions !== null && !revealed ? (
                      <MiniPlay
                        url={spokenOptions[i]}
                        label={t("play_option", { letter: LETTERS[i] })}
                      />
                    ) : null}
                    {show ? (
                      // A word as well as a colour: the marker has to survive being
                      // read by someone who cannot tell the green from the red.
                      <Text
                        style={[
                          type.small,
                          { color: isAnswer ? colors.correct : colors.wrong, fontWeight: "700" },
                        ]}
                      >
                        {isAnswer ? t("mark_correct") : t("mark_chosen")}
                      </Text>
                    ) : null}
                  </View>
                  {optionTextHidden ? null : (
                    <Text style={[type.option, dim && { color: colors.muted }]}>{option.text}</Text>
                  )}
                </Pressable>
              );
            })}
          </FadeIn>

          {/* Before the answer, not after — the opposite of the report button
              and for the same reason. A report is about a question you engaged
              with; a veto is about one you have decided not to. */}
          {canVeto && !revealed ? (
            <VetoQuestion key={`${item.id}-veto`} itemId={item.id} onVetoed={vetoed} />
          ) : null}
        </>
      ) : null}

      {revealed && graded ? (
        <FadeIn
          key={`${item.id}-verdict`}
          style={{ gap: space.lg }}
          // Put the verdict at the top of the screen rather than wherever the
          // option happened to be. onLayout fires with the y it lands at, which
          // is the only number that is right on every item length.
          onLayout={(e) => {
            if (scrolledFor.current === index) return;
            scrolledFor.current = index;
            const y = e.nativeEvent.layout.y;
            scroller.current?.scrollTo({ y: Math.max(0, y - space.lg), animated: true });
          }}
        >
          <Card
            // Said out loud the moment it appears: without this, answering with
            // a screen reader on changes the colours and announces nothing.
            accessibilityLiveRegion="polite"
            style={{
              gap: space.md,
              backgroundColor: graded.isCorrect ? colors.correctSoft : colors.wrongSoft,
            }}
          >
            <View style={styles.verdictRow}>
              <Face mood={mood} size={68} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.h2, graded.isCorrect && { color: colors.correct }]}>
                  {graded.isCorrect
                    ? t("correct_title")
                    : ranOut
                      ? t("time_up")
                      : verdictFor(role, item.listener_role, lang)}
                </Text>
                <Text style={type.small}>{verdictSub}</Text>
              </View>
            </View>
            {!graded.isCorrect && !ranOut ? <RudenessMeter role={role} showLabel={false} /> : null}
          </Card>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showDetails }}
            onPress={() => setShowDetails((v) => !v)}
            style={({ pressed }) => [pressed && { opacity: 0.85 }]}
          >
            <Text style={[type.small, styles.toggle]}>
              {showDetails ? t("details_close") : t("details_open")}
            </Text>
          </Pressable>

          {showDetails ? (
            <Card style={{ gap: space.md }}>
              {/* Skipped when the verdict line above already is it, which is the
                  English case for a right answer. */}
              {explanation === verdictSub ? null : <Text style={type.body}>{explanation}</Text>}
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

          {/* Every question gets one, and it is the last thing above the button
              to leave: a report is worth making at the moment the oddness is
              still in view, and worth nobody's attention before then. */}
          <ReportQuestion key={`${item.id}-report`} itemId={item.id} />

          <Button
            label={index + 1 >= items.length ? t("btn_result") : t("btn_next")}
            // The other half of the keyboard hint, where the key it names is
            // the one that does something.
            sub={HAS_KEYBOARD ? t("key_hint_next") : undefined}
            icon="chevron"
            onPress={next}
          />
        </FadeIn>
      ) : null}
    </ScrollView>
  );
}

/**
 * The keyboard listener, as a component that renders nothing.
 *
 * It exists so the hook can live below this screen's early returns — a loading
 * state, a missing setting, an empty queue — without breaking the rule that
 * hooks run in the same order every render. The parent builds the handler where
 * everything is in scope; this puts it on the document.
 */
function Keys({ onKey }: { onKey: (key: string) => boolean | void }) {
  useKeys(onKey);
  return null;
}

/** Who you are, who you are talking to, and how. Big while entering the scene,
 *  a quiet row once the question is on screen. */
function SceneStrip({ item, big }: { item: QueuedItem; big: boolean }) {
  const { t } = useLang();
  const parts: { k: string; v: string }[] = [];
  if (item.speaker_role) parts.push({ k: t("you"), v: item.speaker_role });
  if (item.listener_role) parts.push({ k: t("other"), v: item.listener_role });
  if (item.channel) {
    const key = CHANNEL_KEY[item.channel];
    const emoji = CHANNEL_EMOJI[item.channel];
    const name = key ? t(key) : item.channel;
    parts.push({ k: "", v: emoji ? `${emoji} ${name}` : name });
  }
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

function SceneImage({ uri }: { uri: string }) {
  return (
    // Not described to a screen reader on purpose. For most types the scene is
    // one of sixteen shared drawings that cannot contain the answer, so a
    // description would be of a stock illustration; for 画像把握 the picture IS
    // the question, and a description would be the answer.
    <Image
      source={{ uri }}
      style={styles.scene}
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
  strip: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  stripPill: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 1,
    // The channel pill carries no label above its value, so on its own it would
    // sit its one line against the top of a row whose other pills are two lines
    // tall. Centring holds the three of them on one line.
    justifyContent: "center",
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
  // A pointer over an option that can still be chosen: the card lifts and its
  // edge takes the soft accent, which is "this one, if you press" without
  // the full border that means "this one, pressed".
  optionAside: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
  optionHover: { borderColor: colors.accentSoft, ...shadow.cardRaised },
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
