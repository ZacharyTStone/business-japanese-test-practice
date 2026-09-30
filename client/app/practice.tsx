/**
 * The practice screen. Everything else in the app exists to get someone here.
 *
 * It takes no arguments. There is one kind of practice run — the set the
 * database built from this learner's record — because any parameter (a mode, a
 * problem type, a level) would be a way to overrule the only thing the app is
 * for.
 *
 * One question is four moments, met in order, and the screen shows one at a
 * time:
 *
 *   scene   — who you are, who you are talking to, where. A picture, a
 *             document if there is one. Nothing to answer yet.
 *   listen  — the audio plays, once, by itself. Nothing readable about the
 *             answers is on screen: the first listen is a listen, not a skim.
 *             When the options are spoken (第1部 聴解) they are on screen from
 *             here as numbers with a play button, and can be pressed — a
 *             learner who knows the answer at the second option should not
 *             have to wait for the fourth. Options that are text wait for the
 *             answer stage.
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
 * **The whole set is fetched up front.** One request, then no network until the
 * first answer. Someone practising on the Yamanote line should not lose their
 * set in a tunnel.
 *
 * **Correctness comes back from the insert.** The item carries `correct_index`,
 * so the screen could grade locally and feel a few hundred milliseconds faster —
 * but then the app's opinion and the database's could drift apart, and the
 * database's is the one the weakness profile is built on. The round trip is the
 * price of those two never disagreeing. When it cannot be made, the card shows
 * the phone's reading of the key marked unsent, and the insert itself — never a
 * grade — waits in the outbox (src/lib/outbox.ts) until it can be.
 *
 * **No ads here, ever.** Not in a break, not between the narration and the
 * options. See AdSlot: the placement type has no member for this screen.
 */
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AppState, Image, Platform, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from "react-native";

import { flushAnswers, flushAnswersWithin, sendAnswer, type AttemptArgs, type FlushResult, type SendOutcome } from "../src/lib/answers";
import { useAuth } from "../src/lib/auth";
import {
  clipUrl,
  fetchDay,
  fetchOptionLabels,
  fetchPace,
  fetchProfile,
  fetchQueue,
  fetchSectionLevels,
  finishSession,
  mayVeto,
  sceneUrl,
  startSession,
} from "../src/lib/db";
import { friendlyError } from "../src/lib/errors";
import { examIsNear } from "../src/lib/exam";
import { useLang, type Key } from "../src/lib/i18n";
import { budgetSeconds, type TypePace } from "../src/lib/pace";
import { initialPractice, practiceReducer, settleAnswers, thinkTime, type Stage } from "../src/lib/practice";
import { roleInfo, verdictFor } from "../src/lib/roles";
import { setSummary } from "../src/lib/session";
import { errorText, isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/supabase";
import { NO_ANSWER, type QueuedItem, type SectionLevel } from "../src/lib/types";
import { AutoPlaylist, DialoguePlayer, MiniPlay, Transcript } from "../src/ui/audio";
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

const NUMBERS = ["1", "2", "3", "4"];

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
 * narration and shown as numbers with a replay button, and the text stays
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
 *  question, then — where the options are spoken — the four options, each
 *  behind the number that names it. Turns without a clip yet are skipped, not
 *  waited for, and so are the numbers, which are four clips for the whole
 *  library (fetchOptionLabels). */
function playlistFor(item: QueuedItem, labels: string[] | null): string[] {
  const turns = (item.dialogue ?? [])
    .map((t) => clipUrl(t.audio_path))
    .filter((u): u is string => Boolean(u));
  const narration = clipUrl(item.narration_path);
  const spoken = spokenOptionUrls(item) ?? [];
  const options = spoken.flatMap((url, i) =>
    labels?.[i] ? [labels[i], url] : [url]
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
  // The navigator admits nobody to this screen until the session has loaded
  // and the database has said they are a tester, so there is no loading or
  // refused state to draw here.
  const { session } = useAuth();
  // A direct load of /practice — a deep link, a refresh — has nothing behind
  // it to go back to, and "back" from here always has to land somewhere.
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

  // The set and everything about the question on screen: one reducer, whose
  // transitions are pure and tested (src/lib/practice.ts). What follows it here
  // is only what the screen needs besides — what was loaded alongside the set,
  // and the furniture of drawing it.
  const [state, dispatch] = useReducer(practiceReducer, Date.now(), initialPractice);
  const [loaded, setLoaded] = useState(false);
  // Asked once per screen. False for every tester but the owner, and the
  // server re-checks it, so this only decides whether a button is drawn.
  const [canVeto, setCanVeto] = useState(false);
  /** The option under a pointer, on a machine that has one. */
  const [hovered, setHovered] = useState<number | null>(null);
  /** The practice session this set's answers are filed under: a grouping
   *  label, started with the set so that the first answer already carries it,
   *  and only when there is a set to file. Null when it could not be made — a
   *  set without a label is still a set (see startSession). */
  const sessionReady = useRef<Promise<string | null> | null>(null);
  /** Whether the session has been closed, and how many answers it holds, for
   *  closing it when the screen is left part-way through a set. */
  const sessionClosed = useRef(false);
  const answeredCount = useRef(0);
  answeredCount.current = state.answers.length;
  const [error, setError] = useState<string | null>(null);
  /** Today's count when the day's ceiling has been reached; null otherwise. */
  const [blocked, setBlocked] = useState<number | null>(null);
  /** What the exam affords each self-paced type, and whether this learner wants
   *  it counted. Both are furniture: if either fails to load the set is
   *  practised without a clock rather than not at all. */
  const [pace, setPace] = useState<Record<string, TypePace>>({});
  const [timed, setTimed] = useState(false);
  /** 「いち」「に」「さん」「よん」, or null until all four are synthesised.
   *  Furniture too: without them the spoken options play unnumbered. */
  const [labels, setLabels] = useState<string[] | null>(null);
  /** An answer the database answered with an error — not a lost connection,
   *  which the outbox deals with by itself. Kept with the insert, so the card
   *  can offer to send exactly that again. */
  const [sendError, setSendError] = useState<{
    itemId: string;
    args: AttemptArgs;
    message: string;
    detail: string;
    busy: boolean;
  } | null>(null);
  const userId = session?.user?.id ?? null;
  /** Today's count as the day stood when the set was built, for the day's done
   *  screen if the database closes the day part-way through. */
  const answeredAtLoad = useRef(0);

  const startedAt = useRef(Date.now());
  const levelsBefore = useRef<SectionLevel[]>([]);
  // Brings the verdict on screen: on a long item it would otherwise appear
  // below the fold of a phone, under the option that was just pressed.
  const scroller = useRef<ScrollView>(null);
  // Which question has already been scrolled to its verdict, by id. onLayout
  // fires again when the explanation is unfolded, and without this the screen
  // would snap back to the top just as somebody started reading it.
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isConfigured || !session?.user) return;
    let cancelled = false;
    (async () => {
      try {
        // Anything a previous set could not send goes first, so the day's count
        // read next already includes it.
        await flushAnswers(session.user.id);
        const [day, levels, profile, paces, spokenLabels] = await Promise.all([
          fetchDay(),
          fetchSectionLevels(),
          // The clock is furniture. A set that cannot be timed is still a set,
          // so neither of these is allowed to fail the screen. Nor are the
          // spoken numbers, which are the same four clips for every item.
          fetchProfile().catch(() => null),
          fetchPace().catch(() => ({}) as Record<string, TypePace>),
          fetchOptionLabels().catch(() => null),
        ]);
        // Read before the first answer, so the result screen can name the
        // section whose level moved rather than just that something did.
        levelsBefore.current = levels;
        setPace(paces);
        // In the last two weeks before the exam date the reading clock runs
        // whatever the setting says: that is when exam pace is the thing left
        // to practise. The account screen says so beside the switch.
        setTimed((profile?.timed_reading ?? false) || examIsNear(profile?.exam_date));
        setLabels(spokenLabels);
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
        answeredAtLoad.current = day.answered_today;
        setBlocked(remaining <= 0 ? day.answered_today : null);
        const queue = remaining > 0 ? await fetchQueue(remaining) : [];
        if (cancelled) return;
        // Started now rather than after the set is on screen, so an answer
        // given at once still has it to carry; the answer waits for it. None
        // for a set with nothing in it — there is nothing to group.
        if (queue.length > 0) {
          sessionReady.current = startSession(session.user.id).catch(() => null);
        }
        dispatch({ type: "loaded", items: queue, now: Date.now() });
        setLoaded(true);
        mayVeto().then(setCanVeto).catch(() => setCanVeto(false));
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  /** An outbox flush, told to the reducer: an answer that waited and has now
   *  landed takes the database's verdict, one it refused is no longer counted. */
  function applyFlush(result: FlushResult) {
    for (const s of result.saved) dispatch({ type: "synced", itemId: s.itemId, verdict: s.graded });
    for (const d of result.dropped) dispatch({ type: "dropped", itemId: d.itemId });
  }

  /** Close the session, once, if it holds anything. */
  function closeSession() {
    if (sessionClosed.current || answeredCount.current === 0) return;
    sessionClosed.current = true;
    void sessionReady.current?.then((id) => (id ? finishSession(id) : undefined)).catch(() => undefined);
  }

  // Left part-way through — the back button, a tab closed — is still a sitting
  // that happened, and it ends when the screen does.
  useEffect(() => () => closeSession(), []);

  // The connection is likelier to be back when the app is: send what waited.
  // On the web the browser also says so outright.
  useEffect(() => {
    if (!userId) return;
    const retry = () => void flushAnswers(userId).then(applyFlush);
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") retry();
    });
    const web = Platform.OS === "web" && typeof window !== "undefined" ? window : null;
    web?.addEventListener("online", retry);
    return () => {
      sub.remove();
      web?.removeEventListener("online", retry);
    };
  }, [userId]);

  /**
   * What became of an answer, on the screen. The database's verdict when it
   * landed. When it did not, the phone reads the answer key for the card —
   * drawn, marked unsent, and never written anywhere — and the insert itself
   * waits in the outbox (a lost connection) or behind a button (an error).
   * The database's two refusals change the set instead of the card.
   */
  function settle(outcome: SendOutcome, it: QueuedItem, args: AttemptArgs) {
    const ranOut = args.chosenIndex === NO_ANSWER;
    const local = () => {
      const option = it.options.find((o) => o.position === args.chosenIndex);
      return {
        isCorrect: !ranOut && args.chosenIndex === it.correct_index,
        chosenRole: ranOut ? "timed_out" : (option?.role ?? ""),
        saved: false,
      };
    };
    switch (outcome.kind) {
      case "saved":
        dispatch({ type: "graded", verdict: { ...outcome.graded, saved: true } });
        buzz(outcome.graded.isCorrect ? [0, 18, 60, 18] : 40);
        return;
      case "queued":
        dispatch({ type: "graded", verdict: local() });
        return;
      case "failed": {
        dispatch({ type: "graded", verdict: local() });
        const said = friendlyError(outcome.error, t);
        setSendError({ itemId: it.id, args, ...said, busy: false });
        return;
      }
      case "day_over":
        dispatch({ type: "dayOver" });
        return;
      case "unavailable":
        dispatch({ type: "unavailable", now: Date.now() });
        return;
    }
  }

  // An answer, posted once. The reducer accepts one `choose` per question, so
  // however many presses arrived there is one pending answer, and this runs
  // once for it. The database grades it; see `settle` for when it cannot.
  useEffect(() => {
    const pending = state.pending;
    if (!pending || !userId) return;
    const it = state.items[pending.index];
    if (!it) return;
    const ranOut = pending.position === NO_ANSWER;
    // A longer single buzz for the clock: it is the one verdict that arrives
    // without anybody having pressed anything, so it announces itself.
    buzz(ranOut ? 60 : 12);
    const args: AttemptArgs = {
      itemId: it.id,
      chosenIndex: pending.position,
      sessionId: null,
      elapsedMs: pending.at - state.shownAt,
      thinkMs: thinkTime(state, pending, {
        selfPaced: Boolean(pace[it.item_type]),
        listenable: playlistFor(it, labels).length > 0,
      }),
      replays: state.replays,
      peeked: state.peeked,
      standsFor: it.stands_for ?? null,
    };
    (async () => {
      const sessionId = (await sessionReady.current) ?? null;
      // What waited goes first, in the order it was given.
      applyFlush(await flushAnswers(userId));
      const sent = { ...args, sessionId };
      settle(await sendAnswer(userId, sent), it, sent);
    })();
  }, [state.pending]);

  /** "Send again", after an error the database gave rather than a lost line. */
  async function resend() {
    if (!sendError || sendError.busy || !userId) return;
    const { itemId, args } = sendError;
    setSendError({ ...sendError, busy: true });
    applyFlush(await flushAnswers(userId));
    const outcome = await sendAnswer(userId, args);
    switch (outcome.kind) {
      case "saved":
        dispatch({ type: "synced", itemId, verdict: outcome.graded });
        setSendError(null);
        return;
      case "queued":
        setSendError(null);
        return;
      case "failed":
        setSendError({ itemId, args, ...friendlyError(outcome.error, t), busy: false });
        return;
      case "day_over":
        dispatch({ type: "dropped", itemId });
        dispatch({ type: "dayOver" });
        setSendError(null);
        return;
      case "unavailable":
        dispatch({ type: "dropped", itemId });
        setSendError(null);
        return;
    }
  }

  // The end of the set: the result screen, or home when a veto left nothing.
  // The day's done screen, when the database closed the day before anything
  // was answered, is drawn below rather than navigated to.
  useEffect(() => {
    if (!state.done || state.done === "day") return;
    if (state.done === "home") {
      router.replace("/");
      return;
    }
    closeSession();
    const finishedAt = Date.now();
    (async () => {
      // One more try for anything still waiting, so the result lists what the
      // database has — but not a long one: a connection that is not back in a
      // few seconds is not worth holding the result for, and the outbox keeps
      // what it has either way.
      const flushed = userId ? await flushAnswersWithin(userId, 3000) : null;
      setSummary({
        answers: flushed ? settleAnswers(state.answers, flushed) : state.answers,
        startedAt: startedAt.current,
        finishedAt,
        levelsBefore: levelsBefore.current,
      });
      router.replace("/result");
    })();
  }, [state.done]);

  const index = state.index;
  const items = state.items;
  const item = items[index];
  const { chosen, graded, showDetails, optionsAsText } = state;
  const busy = state.pending !== null;
  // A new question starts with nothing under the pointer, and at the top: the
  // verdict scrolled the last one down to its explanation, and the next
  // question opening there would open on its options with its scene above the
  // fold.
  useEffect(() => {
    setHovered(null);
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, [item?.id]);
  const options = useMemo(
    () => (item ? [...item.options].sort((a, b) => a.position - b.position) : []),
    [item]
  );
  const playlist = useMemo(() => (item ? playlistFor(item, labels) : []), [item, labels]);
  const spokenOptions = useMemo(() => (item ? spokenOptionUrls(item) : null), [item]);

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
          title={t("q_load_err")}
          body={error}
          tone="warn"
          action={{ label: t("back"), onPress: leave }}
        />
      </View>
    );
  }
  if (!loaded && blocked === null) return <Loading label={t("preparing")} />;

  if (blocked !== null || state.done === "day") {
    // The door, from this side: a deep link or a stale tab past the ceiling —
    // or the database closing the day under a set that had not started.
    return (
      <View style={styles.page}>
        <DayDone answered={blocked ?? answeredAtLoad.current} streak={0} onHome={() => router.replace("/")} />
      </View>
    );
  }
  // On the way out: the effect above is navigating.
  if (state.done) return <Loading />;
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
  const recorded: Stage = state.stage ?? (hasScene ? "scene" : "answer");
  // The only way out of "listen" is the playlist finishing, and with nothing
  // to play there is no playlist: the screen would wait for ever on a hint
  // about audio that does not exist, with no options and no button.
  const stage: Stage = recorded === "listen" && !listenable ? "answer" : recorded;
  const go = (next: Stage) => dispatch({ type: "stage", stage: next, now: Date.now() });

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
  function choose(position: number) {
    dispatch({ type: "choose", position, stage, now: Date.now() });
  }

  /**
   * The question is out of the bank; take it out of this set too. No attempt
   * is written, so nothing is graded, nothing is scheduled for review and the
   * day's count does not move — vetoing is instead of answering. The reducer
   * splices it out and starts the next question from its first stage.
   */
  function vetoed() {
    dispatch({ type: "vetoed", now: Date.now() });
  }

  function next() {
    dispatch({ type: "next", now: Date.now() });
  }

  const revealed = stage === "reveal" && graded !== null;
  // Spoken options are numbers until the answer is in, unless asked for.
  const optionTextHidden = spokenOptions !== null && !revealed && !optionsAsText;
  // Options can be answered while the clips still play, but only when they
  // show no text: numbers and play buttons give nothing away, a printed
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
        {item.stands_for ? (
          <Tag tone="violet">{t("retest_tag")}</Tag>
        ) : item.times_seen > 0 ? (
          <Tag tone="amber">{t("again_tag")}</Tag>
        ) : null}
      </View>

      {/* The clock, on the reading questions only, directly under the counter:
          both of them answer "where am I", and a learner scrolling a long
          passage scrolls back to one place rather than two. It keeps running
          until the answer is in and then freezes at what was left, which is the
          number worth seeing on the way to the next question. */}
      {clockSeconds > 0 ? (
        <QuestionClock
          // A new question is a new clock, not the last one's leftovers.
          key={item.id}
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
            {/* The same picture at the same size as on the scene card: a strip
                would crop the drawing to a band of ceiling. */}
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
                onReplay={() => dispatch({ type: "replayed" })}
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
              // Reading the spoken options is help the exam does not give, and
              // the reducer notes it (`peeked`) when it is turned on.
              onPress={() => dispatch({ type: "toggleOptionsText" })}
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
                  // "1. 承知いたしました" rather than reading a lone number and
                  // then a sentence with nothing tying them together — and, once
                  // answered, says which one this was.
                  accessibilityLabel={
                    (optionTextHidden
                      ? t("option_spoken", { label: NUMBERS[i] })
                      : `${NUMBERS[i]}. ${option.text}`) +
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
                        styles.numberBadge,
                        show && (isAnswer ? styles.numberBadgeCorrect : styles.numberBadgeWrong),
                      ]}
                    >
                      <Text
                        style={[
                          styles.number,
                          show && { color: isAnswer ? colors.correct : colors.wrong },
                        ]}
                      >
                        {NUMBERS[i]}
                      </Text>
                    </View>
                    {spokenOptions !== null && !revealed ? (
                      <MiniPlay
                        url={spokenOptions[i]}
                        label={t("play_option", { label: NUMBERS[i] })}
                        onPlay={() => dispatch({ type: "replayed" })}
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
          {canVeto && !revealed && chosen === null ? (
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
            if (scrolledFor.current === item.id) return;
            scrolledFor.current = item.id;
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
            {/* Not yet in the record. Said on the card, because the verdict above
                is the phone's reading of the key until the database has it. */}
            {!graded.saved && sendError?.itemId === item.id ? (
              <View style={{ gap: space.xs }}>
                <Text style={[type.small, { color: colors.wrong, fontWeight: "700" }]}>{t("send_failed")}</Text>
                <Text style={type.small}>{sendError.message}</Text>
                {sendError.detail ? <Text style={type.mono}>{sendError.detail}</Text> : null}
                <Button
                  label={t("send_retry")}
                  tone="secondary"
                  disabled={sendError.busy}
                  onPress={() => void resend()}
                />
              </View>
            ) : !graded.saved ? (
              <Text style={[type.small, { fontWeight: "700" }]}>{t("unsent_offline")}</Text>
            ) : null}
            {/* Why this question was here, said once it can no longer be a
                hint: a 類題 re-tests a trap that caught them before. */}
            {item.stands_for ? (
              <Text style={type.small}>
                {item.lesson_trap
                  ? t("retest_note_trap", { trap: roleInfo(item.lesson_trap, lang).label })
                  : t("retest_note")}
              </Text>
            ) : null}
          </Card>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showDetails }}
            onPress={() => dispatch({ type: "toggleDetails" })}
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
                  <View key={option.position} style={styles.whyRow}>
                    {/* A spoken option can be heard again beside its text: the
                        right one is the sentence worth saying out loud. */}
                    {spokenOptions ? (
                      <MiniPlay
                        url={spokenOptions[i]}
                        label={t("play_option", { label: NUMBERS[i] })}
                      />
                    ) : null}
                    <View style={[styles.why, { flex: 1 }]}>
                      <Text style={[type.small, { fontWeight: "700", color: colors.text }]}>
                        {NUMBERS[i]}　{option.text}
                      </Text>
                      <Text style={type.small}>{option.why}</Text>
                    </View>
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
              {/* What was heard, a line at a time. Text-only narration is already
                  on the card above, and a dialogue with no clips is already
                  there as a script, so neither is repeated here. */}
              <Transcript
                turns={listenable ? (item.dialogue ?? []) : []}
                narration={stemAsText ? null : { text: item.stem, url: narrationUrl }}
              />
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
  optionAside: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
  // A pointer over an option that can still be chosen: the card lifts and its
  // edge takes the soft accent, which is "this one, if you press" without
  // the full border that means "this one, pressed".
  optionHover: { borderColor: colors.accentSoft, ...shadow.cardRaised },
  optionPending: { borderColor: colors.accent },
  optionCorrect: { borderColor: colors.correct, backgroundColor: colors.correctSoft },
  optionWrong: { borderColor: colors.wrong, backgroundColor: colors.wrongSoft },
  numberBadge: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  numberBadgeCorrect: { backgroundColor: "rgba(14,159,110,0.16)" },
  numberBadgeWrong: { backgroundColor: "rgba(217,58,75,0.16)" },
  number: { fontSize: 13, fontWeight: "700", color: colors.accent },
  verdictRow: { flexDirection: "row", alignItems: "center", gap: space.lg },
  why: { gap: 2 },
  whyRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  hint: { textAlign: "center" },
  toggle: { textAlign: "center", textDecorationLine: "underline" },
});
