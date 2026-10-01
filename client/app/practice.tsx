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
 * This file is the arrangement; the parts live beside it. The state is one
 * reducer, and which stage shows what is `questionView` — both pure and tested
 * in src/lib/practice.ts. Loading the set, posting an answer and ending the set
 * are hooks under src/ui/practice/, and so are the cards the screen is made of.
 *
 * Three decisions worth stating:
 *
 * **The whole set is fetched up front** (usePracticeLoad). Someone practising
 * on the Yamanote line should not lose their set in a tunnel.
 *
 * **Correctness comes back from the insert** (usePostAnswer), and an answer
 * that cannot be sent waits in the outbox rather than being graded here.
 *
 * **No ads here, ever.** Not in a break, not between the narration and the
 * options. See AdSlot: the placement type has no member for this screen.
 */
import { useRouter, type ErrorBoundaryProps } from "expo-router";
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../src/lib/auth";
import { clipUrl, sceneUrl } from "../src/lib/db";
import { friendlyError } from "../src/lib/errors";
import { useLang } from "../src/lib/i18n";
import { budgetSeconds } from "../src/lib/pace";
import { playlistFor, spokenOptionUrls } from "../src/lib/playlist";
import { initialPractice, practiceReducer, questionView, type Stage } from "../src/lib/practice";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../src/lib/api";
import { NO_ANSWER } from "../src/lib/types";
import { Button, Loading, Notice } from "../src/ui/components";
import { DayDone } from "../src/ui/done";
import { optionForKey, useKeys } from "../src/ui/keys";
import { FadeIn, useReducedMotion } from "../src/ui/motion";
import { OptionList } from "../src/ui/practice/OptionList";
import { ProgressHeader } from "../src/ui/practice/ProgressHeader";
import { SceneCard, SceneStrip } from "../src/ui/practice/SceneCard";
import { StimulusCard } from "../src/ui/practice/StimulusCard";
import { shared } from "../src/ui/practice/styles";
import { useFinishSet } from "../src/ui/practice/useFinishSet";
import { usePostAnswer } from "../src/ui/practice/usePostAnswer";
import { usePracticeLoad } from "../src/ui/practice/usePracticeLoad";
import { VerdictPanel } from "../src/ui/practice/VerdictPanel";
import { page, space, type } from "../src/ui/theme";

/**
 * What this screen shows instead of itself when it throws while drawing.
 *
 * expo-router wraps a route that exports one of these, so a malformed item —
 * a document block nobody anticipated, a chart with no figures — costs the
 * question on screen and not the app. Every answer already given is in the
 * database, or in the outbox, so "try again" draws a fresh set from where the
 * record stands, and home is always one press away.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const router = useRouter();
  const { t } = useLang();
  const said = friendlyError(error, t);
  return (
    <ScrollView contentContainerStyle={[shared.page, page]}>
      <Notice
        title={t("practice_broke")}
        body={said.message}
        tone="warn"
        action={{ label: t("retry"), onPress: () => void retry() }}
      />
      {said.detail ? <Text style={[type.mono, shared.hint]}>{said.detail}</Text> : null}
      <Button label={t("to_home")} tone="secondary" onPress={() => router.replace("/")} />
    </ScrollView>
  );
}

export default function Practice() {
  const router = useRouter();
  const { t } = useLang();
  // The navigator admits nobody to this screen until the session has loaded
  // and the database has said they are a tester, so there is no loading or
  // refused state to draw here.
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  // A direct load of /practice — a deep link, a refresh — has nothing behind
  // it to go back to, and "back" from here always has to land somewhere.
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

  // The set and everything about the question on screen: one reducer, whose
  // transitions are pure and tested (src/lib/practice.ts). What follows it here
  // is only what the screen needs besides — what was loaded alongside the set,
  // and the furniture of drawing it.
  const [state, dispatch] = useReducer(practiceReducer, Date.now(), initialPractice);
  const load = usePracticeLoad(userId, dispatch);
  /** The question whose audio would not play, if the one on screen is it: its
   *  words go on the page, as they do for an item with no clips yet. */
  const [audioFailedFor, setAudioFailedFor] = useState<string | null>(null);
  const { sendError, resend } = usePostAnswer({
    state,
    dispatch,
    userId,
    pace: load.pace,
    labels: load.labels,
    audioFailedFor,
    sessionReady: load.sessionReady,
  });
  useFinishSet({ state, userId, sessionReady: load.sessionReady, levelsBefore: load.levelsBefore });

  // Brings the verdict on screen: on a long item it would otherwise appear
  // below the fold of a phone, under the option that was just pressed.
  const scroller = useRef<ScrollView>(null);
  /** How tall the sticky counter is, so a scroll to the verdict clears it. */
  const headerHeight = useRef(0);
  const reduced = useReducedMotion();
  // The last button sits above the home indicator, not under it.
  const insets = useSafeAreaInsets();

  const { index, items, chosen, graded, showDetails, optionsAsText } = state;
  const item = items[index];
  // A new question starts at the top: the verdict scrolled the last one down to
  // its explanation, and the next question opening there would open on its
  // options with its scene above the fold.
  useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, [item?.id]);
  // The options' two handlers, the same functions for the life of the screen,
  // so that an option card redraws when its own state changes and not on every
  // tick of the audio player above it. `choose` itself is rebuilt each render
  // — it closes over the stage — and is reached through the ref.
  const chooseLatest = useRef<(position: number) => void>(() => undefined);
  const onChoose = useCallback((position: number) => chooseLatest.current(position), []);
  const onPlayOption = useCallback(() => dispatch({ type: "replayed" }), []);
  const options = useMemo(
    () => (item ? [...item.options].sort((a, b) => a.position - b.position) : []),
    [item]
  );
  const playlist = useMemo(() => (item ? playlistFor(item, load.labels, clipUrl) : []), [item, load.labels]);
  const spokenOptions = useMemo(() => (item ? spokenOptionUrls(item, clipUrl) : null), [item]);

  if (!isConfigured) {
    return (
      <View style={[shared.page, page]}>
        <Notice title={t("config_needed")} body={MISSING_CONFIG_MESSAGE} tone="warn" />
      </View>
    );
  }
  if (load.error) {
    // Said so a learner can act on it — offline, or signed out — with the
    // technical text underneath for whoever has to find the bug, and a way to
    // try again that is not "go home and press start".
    const said = friendlyError(load.error, t);
    return (
      <View style={[shared.page, page]}>
        <Notice
          title={t("q_load_err")}
          body={said.message}
          tone="warn"
          action={{ label: t("retry"), onPress: load.retry }}
        />
        {said.detail ? <Text style={[type.mono, shared.hint]}>{said.detail}</Text> : null}
        <Button label={t("back")} tone="secondary" onPress={leave} />
      </View>
    );
  }
  if (!load.loaded && load.blocked === null) return <Loading label={t("preparing")} />;

  if (load.blocked !== null || state.done === "day") {
    // The door, from this side: a deep link or a stale tab past the ceiling —
    // or the database closing the day under a set that had not started.
    return (
      <View style={[shared.page, page]}>
        <DayDone answered={load.blocked ?? load.answeredAtLoad} streak={0} onHome={() => router.replace("/")} />
      </View>
    );
  }
  // On the way out: useFinishSet is navigating.
  if (state.done) return <Loading />;
  if (items.length === 0) {
    return (
      <View style={[shared.page, page]}>
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
  const narrationUrl = clipUrl(item.narration_path);
  const audioFailed = audioFailedFor === item.id;
  // Which stage shows what, from the state and the item's media: pure, and
  // tested, in lib/practice.ts.
  const view = questionView(state, item, {
    playable: playlist.length > 0,
    picture: Boolean(sceneImage),
    narrated: Boolean(narrationUrl),
    spokenOptions: spokenOptions !== null,
    audioFailed,
  });
  const { stage, revealed } = view;
  // How long this question gets, from the exam's budget for its type and the
  // amount there is to read in this particular one. Zero means no clock — see
  // budgetSeconds — and the learner's switch is the only part of it that is
  // about the learner rather than about the question.
  const clockSeconds = load.timed ? budgetSeconds(item, load.pace) : 0;
  const go = (next: Stage) => dispatch({ type: "stage", stage: next, now: Date.now() });

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
  chooseLatest.current = choose;

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

  /** The four keys that matter, and nothing else. See src/ui/keys.ts. */
  function onKey(key: string): boolean | void {
    if (!revealed && view.optionsShown && !view.locked) {
      const pick = optionForKey(key, options.length);
      if (pick >= 0) {
        choose(pick);
        return;
      }
    }
    if (key === "Enter" || key === " ") {
      if (revealed) {
        next();
        return;
      }
      if (stage === "scene") {
        go(view.afterScene);
        return;
      }
    }
    return false;
  }

  return (
    <>
      <Keys onKey={onKey} />
      <ScrollView
        ref={scroller}
        // The column is capped and centred on a wide window: a line of Japanese
        // past about 720 points is too long to read, and an answer card that
        // wide is not something a pointer finds.
        contentContainerStyle={[shared.page, page, { paddingBottom: space.xxl + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        // The counter and the clock stay at the top while a long passage
        // scrolls under them: a clock that has scrolled away is not pacing
        // anybody.
        stickyHeaderIndices={[0]}
      >
        <ProgressHeader
          index={index}
          total={items.length}
          revealed={revealed}
          retest={Boolean(item.stands_for)}
          again={item.times_seen > 0}
          clock={
            clockSeconds > 0
              ? { runKey: item.id, seconds: clockSeconds, running: view.clockRunning, onExpire: () => choose(NO_ANSWER) }
              : null
          }
          onHeight={(h) => {
            headerHeight.current = h;
          }}
        />

        <SceneStrip item={item} big={stage === "scene"} />

        {/* Each stage of a question arrives rather than snaps: the scene card,
            then the question card in its place. The key is what makes the
            second one arrive too — same component, new content. */}
        {stage === "scene" ? (
          <FadeIn key={`${item.id}-scene`}>
            <SceneCard
              item={item}
              sceneImage={sceneImage}
              listenable={view.listenable}
              onGo={() => go(view.afterScene)}
            />
          </FadeIn>
        ) : (
          <FadeIn key={`${item.id}-question`}>
            <StimulusCard
              item={item}
              sceneImage={sceneImage}
              playlist={playlist}
              autoplay={stage === "listen"}
              stemAsText={view.stemAsText}
              dialogueAsText={view.dialogueAsText}
              audioFailed={audioFailed}
              onFinished={() => go("answer")}
              onFailed={() => setAudioFailedFor(item.id)}
              onReplay={() => dispatch({ type: "replayed" })}
            />
          </FadeIn>
        )}

        {/* What happens next, as the screen actually does it: printed options
            wait for the audio to end, numbered ones can be pressed now. */}
        {stage === "listen" ? (
          <Text style={[type.small, shared.hint]}>
            {view.optionTextHidden ? t("listen_hint_spoken") : t("listen_hint")}
          </Text>
        ) : null}

        {view.optionsShown ? (
          <OptionList
            item={item}
            options={options}
            view={view}
            spokenOptions={spokenOptions}
            optionsAsText={optionsAsText}
            chosen={chosen}
            canVeto={load.canVeto}
            onChoose={onChoose}
            onPlay={onPlayOption}
            onToggleText={() => dispatch({ type: "toggleOptionsText" })}
            onVetoed={vetoed}
          />
        ) : null}

        {revealed && graded ? (
          <VerdictPanel
            key={`${item.id}-verdict`}
            item={item}
            options={options}
            graded={graded}
            view={view}
            chosen={chosen}
            spokenOptions={spokenOptions}
            narrationUrl={narrationUrl}
            showDetails={showDetails}
            sendError={sendError?.itemId === item.id ? sendError : null}
            nextLabel={index + 1 >= items.length ? t("btn_result") : t("btn_next")}
            onToggleDetails={() => dispatch({ type: "toggleDetails" })}
            onResend={resend}
            onNext={next}
            onArrive={(y) => {
              // Clear of the sticky counter, which would otherwise sit on top
              // of the verdict's first line — and jumped rather than glided for
              // somebody who has asked the OS for less motion.
              const top = y - headerHeight.current - space.sm;
              scroller.current?.scrollTo({ y: Math.max(0, top), animated: !reduced });
            }}
          />
        ) : null}
      </ScrollView>
    </>
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
