/**
 * Playing a clip — and coping when there isn't one.
 *
 * Items are published before their audio exists, so every one of these controls
 * has to have a sensible shape when `path` is null. The choice made here is to
 * show the text instead of hiding the control: a listening item with no audio is
 * still a usable reading item, and it is much better than a dead play button.
 *
 * When the clips do exist this is also where the replay rule lives. The real
 * exam plays once, but practice is not the exam; being able to replay is how you
 * hear the difference between 「いただく」 and 「召し上がる」 on the fourth listen.
 */
import { type AudioStatus, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { clipUrl } from "../lib/db";
import { useLang } from "../lib/i18n";
import type { DialogueTurn } from "../lib/types";
import { Icon } from "./icons";
import { colors, MIN_TOUCH, radius, space, type } from "./theme";

/**
 * One voice at a time.
 *
 * Every control on the practice screen owns its own player — the listening
 * run, and each spoken option's play button — and the option buttons are live
 * while the run is still reading, on purpose: a learner who knows the answer at
 * the second option should not have to wait for the fourth. Two clips on top of
 * each other — an option's button pressed over the run reading it, or two
 * buttons pressed in a row — sound like distorted audio, so starting any player
 * silences whichever one was sounding.
 */
let voice: { owner: object; silence: () => void } | null = null;

function takeVoice(owner: object, silence: () => void) {
  if (voice && voice.owner !== owner) {
    const previous = voice.silence;
    voice = null;
    try {
      previous();
    } catch {
      // A player already released by its component has nothing left to stop.
    }
  }
  voice = { owner, silence };
}

function releaseVoice(owner: object) {
  if (voice?.owner === owner) voice = null;
}

/**
 * A play button with nothing but an icon — for an option that is heard rather
 * than read, or a line of a script. Beside an option it sits next to the
 * option's own button, never inside it: a press here plays and a press on the
 * option answers, which is the same split as a number and a speaker button on
 * the exam room's answer sheet — and a screen reader can only reach a button
 * that is not inside another.
 */
export function MiniPlay({
  url,
  label,
  onPlay,
}: {
  url: string;
  label: string;
  /** Told when it starts playing (not when it is stopped): the practice screen
   *  counts a spoken option heard again before the answer as a replay. */
  onPlay?: () => void;
}) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  const owner = React.useRef({}).current;
  React.useEffect(() => () => releaseVoice(owner), [owner]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        if (playing) {
          player.pause();
          releaseVoice(owner);
        } else {
          takeVoice(owner, () => player.pause());
          player.seekTo(0);
          player.play();
          onPlay?.();
        }
      }}
      style={({ pressed }) => [styles.mini, pressed && { opacity: 0.85 }]}
    >
      <Icon name={playing ? "stop" : "play"} size={16} color={colors.onAccent} strokeWidth={2} />
    </Pressable>
  );
}

/**
 * The script of a heard question, one line at a time, each line playable on
 * its own.
 *
 * Only ever drawn once the answer is in — after the reveal, and on the review
 * screen — because before that a script on the page turns a listening item
 * into a reading one. Afterwards the job is different: not to hear it once
 * but to find the sentence that got away. The replay button above the options
 * answers "let me hear it again"; this answers "which line was it, and how did
 * it sound", which is where 伺います and 参ります finally come apart.
 *
 * In the order it was heard: the conversation, then the narration. A line
 * whose clip has not been synthesised yet is text alone.
 */
export function Transcript({
  turns,
  narration,
}: {
  turns: DialogueTurn[];
  narration?: { text: string; url: string | null } | null;
}) {
  const { t } = useLang();
  const lines = [
    ...turns.map((turn) => ({
      who: turn.speaker_role,
      text: turn.text,
      url: clipUrl(turn.audio_path),
    })),
    ...(narration ? [{ who: t("narration"), text: narration.text, url: narration.url }] : []),
  ];
  if (lines.length === 0) return null;
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.small, { fontWeight: "700", color: colors.text }]}>{t("transcript")}</Text>
      {lines.map((line, i) => (
        <View key={i} style={styles.line}>
          {line.url ? <MiniPlay url={line.url} label={t("play_line", { who: line.who })} /> : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.small}>{line.who}</Text>
            <Text style={type.body}>{line.text}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  mini: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  play: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    padding: space.md,
    paddingRight: space.lg,
  },
  playIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  transcript: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
  },
  toggle: { textDecorationLine: "underline" },
  // A text link's hit area is its padding: hitSlop does nothing on the web.
  link: { minHeight: MIN_TOUCH, justifyContent: "center" },
  listening: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
  },
  listeningRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: "hidden" },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
});


/**
 * How often a playing clip reports in.
 *
 * Shorter than the 500ms default, because on web the end of a clip is carried
 * by an ordinary time update — `didJustFinish` there is `media.ended` — and
 * time updates are throttled to exactly this interval. Chromium also fires
 * `pause` at the end, which expo-audio emits unthrottled and which says the
 * same thing, so there the end is reported twice; a browser that does not is
 * one where a clip shorter than the interval could finish without the queue
 * ever hearing about it. 250ms is comfortably under the shortest thing the
 * library says aloud, which is an option number.
 */
const STATUS_INTERVAL_MS = 250;

/**
 * How long a clip may sit without its position moving before it is given up
 * on. A clip that 404s, a phone that lost its connection between two turns, a
 * browser that refused to start sound without a tap: each of them leaves a
 * player that never finishes, and a queue that advances only on a finish
 * would sit at 「聞いています…」 and 0% for ever. Eight seconds is well past a
 * slow start on a train and well short of somebody giving up on the screen.
 * The watch counts its own looks rather than the clock on the wall, so a phone
 * that put the app to sleep does not wake up to find every clip overdue.
 */
const STALL_MS = 8000;
const WATCH_MS = 1000;

/** What a component gets back from `useClipQueue`. */
type ClipQueue = {
  /** Which clip is playing, as an index into `urls`. */
  at: number;
  running: boolean;
  status: AudioStatus;
  /** Play from the first clip that exists. */
  start: () => void;
  /** Stop and rewind to the beginning. Does not report the run as finished. */
  stop: () => void;
};

/** Start a player, and never let it throw into a render. On the web the
 *  browser's own `play()` promise is out of reach inside expo-audio; a refusal
 *  there shows up as a clip that never moves, which the watch catches. */
function startPlayer(player: { seekTo: (s: number) => Promise<void> | void; play: () => void }) {
  try {
    void Promise.resolve(player.seekTo(0)).catch(() => undefined);
    player.play();
  } catch {
    // A player that cannot start is a clip that never moves: see STALL_MS.
  }
}

/**
 * One player, walked along a list of clips.
 *
 * The step from one clip to the next is taken on the player's own
 * `playbackStatusUpdate` event rather than on the status this component
 * renders, and that is the whole reason this is a hook and not an effect.
 * `useAudioPlayer` builds a *new* player whenever the source changes, while
 * `useAudioPlayerStatus` keeps the last status it was handed until that new
 * player says something — so for one render the status of the clip that has
 * just ended is attached to the clip that is about to start. An effect that
 * advanced on `status.didJustFinish` would fire twice for one clip — once on
 * the finish, and again when the index it depends on changed with the same
 * stale `true` still showing — and skip every other clip.
 *
 * An event is delivered once, to a listener attached to the player that sent
 * it, so a status belonging to the clip before cannot be read as this one's.
 * `handled` is the other half, and web is why: `didJustFinish` there is
 * `media.ended`, a state that stays true rather than a one-shot, and a clip
 * that reaches its end reports it on the final time update *and* again on the
 * pause that follows. One advance per player is what makes that one step.
 *
 * A clip with no audio yet is stepped over rather than waited for: a
 * half-synthesised item should still play the parts that exist. So is a clip
 * that reports an error or does not move for STALL_MS — and the run then
 * finishes saying that something was not heard (`onFinished(true)`), so the
 * screen can put the words on the page instead.
 *
 * The run holds the one voice (`takeVoice`) while it plays. Another player
 * starting stops it, exactly as the learner pressing stop would, and then
 * `onInterrupted` says so — the listening stage counts that as a skip.
 */
function useClipQueue(
  urls: (string | null)[],
  {
    autoplay = false,
    onFinished,
    onInterrupted,
  }: {
    autoplay?: boolean;
    /** `failed` is true when a clip of the run could not be played. */
    onFinished?: (failed: boolean) => void;
    onInterrupted?: () => void;
  } = {}
): ClipQueue {
  const firstPlayable = () => Math.max(0, urls.findIndex(Boolean));
  const [at, setAt] = React.useState(firstPlayable);
  const [running, setRunning] = React.useState(autoplay && urls.some(Boolean));
  const player = useAudioPlayer(urls[at] ?? null, { updateInterval: STATUS_INTERVAL_MS });
  const status = useAudioPlayerStatus(player);
  const owner = React.useRef({}).current;

  // What the listener reads when an event arrives. Both are re-read rather than
  // captured: the list is rebuilt by the parent's render and `onFinished` is
  // usually written inline, and neither should re-subscribe the listener.
  const live = React.useRef({ urls, onFinished, onInterrupted });
  live.current = { urls, onFinished, onInterrupted };
  /** Whether any clip of this run was given up on. */
  const missed = React.useRef(false);

  React.useEffect(() => {
    if (!running) return undefined;
    // One advance per clip. Declared here rather than in a ref so that it
    // resets with the listener — on the next clip, and on a replay of this one.
    let handled = false;
    const advance = (failed: boolean) => {
      if (handled) return;
      handled = true;
      if (failed) missed.current = true;
      const list = live.current.urls;
      let next = at + 1;
      while (next < list.length && !list[next]) next += 1;
      if (next < list.length) {
        setAt(next);
        return;
      }
      setRunning(false);
      setAt(0);
      releaseVoice(owner);
      const anyMissed = missed.current;
      missed.current = false;
      live.current.onFinished?.(anyMissed);
    };
    const sub = player.addListener("playbackStatusUpdate", (s) => {
      if (s.error) advance(true);
      else if (s.didJustFinish) advance(false);
    });
    // The watch: a position that has not changed in STALL_MS is a clip that is
    // not coming. Any change counts as life, backwards included — a replay
    // starts again from zero.
    let last: number | null = null;
    let still = 0;
    const watch = setInterval(() => {
      let now: number | null = null;
      try {
        now = player.currentTime;
      } catch {
        // A released player reads as a stalled one.
      }
      if (now !== null && (last === null || Math.abs(now - last) > 0.01)) {
        last = now;
        still = 0;
        return;
      }
      still += 1;
      if (still * WATCH_MS >= STALL_MS) advance(true);
    }, WATCH_MS);
    return () => {
      sub.remove();
      clearInterval(watch);
    };
    // `at` is a dependency so that two identical clips in a row — which share
    // one player, because the source is what builds it — still get a listener
    // each.
  }, [player, running, at]);

  const stop = React.useCallback(() => {
    try {
      player.pause();
    } catch {
      // Already released: nothing is sounding.
    }
    missed.current = false;
    setRunning(false);
    setAt(Math.max(0, live.current.urls.findIndex(Boolean)));
    releaseVoice(owner);
  }, [player, owner]);
  // Read by another player taking the voice, which may happen several clips
  // after this one started, so it must reach the player playing now.
  const stopLatest = React.useRef(stop);
  stopLatest.current = stop;

  React.useEffect(() => {
    if (!running || !urls[at]) return;
    takeVoice(owner, () => {
      stopLatest.current();
      live.current.onInterrupted?.();
    });
    startPlayer(player);
  }, [player, running, at]);

  React.useEffect(() => () => releaseVoice(owner), [owner]);

  const start = React.useCallback(() => {
    const first = live.current.urls.findIndex(Boolean);
    if (first < 0) return;
    setAt(first);
    setRunning(true);
  }, []);

  return { at, running, status, start, stop };
}

/**
 * A heard conversation that cannot be heard: the script on the page.
 *
 * This is how every item with a conversation works before its turns are
 * synthesised, and — once they are — how it works when they will not play.
 * While the turns can be heard they are part of the listening run
 * (AutoPlaylist), with the rest of the item's clips, and the script waits for
 * the answer (Transcript): a script on the page from the start would turn a
 * listening item into a reading one.
 */
export function DialoguePlayer({
  turns,
  unplayable = false,
}: {
  turns: DialogueTurn[];
  /** The clips exist but would not play, rather than not existing yet. */
  unplayable?: boolean;
}) {
  const { t } = useLang();
  return (
    <View style={styles.transcript}>
      <Text style={type.small}>{t(unplayable ? "dialogue_as_text" : "dialogue_pending")}</Text>
      {turns.map((turn, i) => (
        <View key={i} style={{ gap: 2 }}>
          <Text style={type.small}>{turn.speaker_role}</Text>
          <Text style={type.body}>{turn.text}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The listening stage.
 *
 * Every clip of one item, in the order it is met — the turns of a conversation,
 * then the question — played once without being asked, the way the exam plays
 * them, and then a button to hear it all again, which the exam does not offer
 * and practice should. Nothing readable about the answers is on screen while
 * it runs, so the first listen is a real listen and not a skim of the answers
 * with sound in the background; spoken options, which show no text, sit under
 * it as numbers and may be answered before it finishes.
 *
 * `autoplay` is read once, on mount. The screen mounts this at the listening
 * stage and keeps it mounted through answering, so the replay button is the
 * same player, and the item's `id` is the key that resets it.
 */
export function AutoPlaylist({
  urls,
  autoplay,
  onFinished,
  onFailed,
  onReplay,
}: {
  urls: string[];
  autoplay: boolean;
  onFinished?: () => void;
  /** Told when a clip could not be played, so the screen can show its words:
   *  a listening item that cannot be heard is still a usable reading item. */
  onFailed?: () => void;
  /** Told each time "listen again" is pressed. The exam plays once, so the
   *  practice screen records a replay with the answer (attempts.replays). */
  onReplay?: () => void;
}) {
  const { t } = useLang();
  const [finished, setFinished] = React.useState(!autoplay || urls.length === 0);
  const [failed, setFailed] = React.useState(false);
  const reported = React.useRef(false);
  const report = () => {
    setFinished(true);
    if (reported.current) return;
    reported.current = true;
    onFinished?.();
  };
  const queue = useClipQueue(urls, {
    autoplay: autoplay && urls.length > 0,
    onFinished: (missed) => {
      // Said once it happens, and kept: a replay that plays is good news, but
      // the words are already on the page and taking them away would be worse.
      if (missed) {
        setFailed(true);
        onFailed?.();
      }
      report();
    },
    // An option's own play button cut the run short: a skip, like the link
    // below, so the options stay answerable and the replay button appears.
    onInterrupted: report,
  });

  if (urls.length === 0) return null;

  if (!queue.running && finished) {
    // Always replayable: the exam plays a clip once, but practice is not the
    // exam. After a failure the same button is the way to try again — and on
    // a browser that would not start sound by itself, the tap it was waiting
    // for.
    return (
      <View style={{ gap: space.sm }}>
        {failed ? (
          <Text style={[type.small, { color: colors.wrong }]} accessibilityLiveRegion="polite">
            {t("audio_failed")}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("listen_again")}
          onPress={() => {
            onReplay?.();
            queue.start();
          }}
          style={({ pressed }) => [styles.play, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.playIcon}>
            <Icon name="play" size={18} color={colors.onAccent} strokeWidth={2} />
          </View>
          <Text style={type.body}>{t("listen_again")}</Text>
        </Pressable>
      </View>
    );
  }

  const { status } = queue;
  const fraction =
    status.duration && status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  return (
    // Not a live region. The counter below changes with every clip, and a
    // screen reader reading "3 / 8" over the conversation it is meant to be
    // listening to is the one thing this stage cannot afford. The stage says
    // what it is when it is reached; a clip that will not play is the one
    // status worth interrupting for, and that line is a live region.
    <View style={styles.listening}>
      <View style={styles.listeningRow}>
        <View style={styles.playIcon}>
          <Icon name="headphones" size={18} color={colors.onAccent} strokeWidth={2} />
        </View>
        <Text style={[type.body, { flex: 1 }]}>{t("listening")}</Text>
        {urls.length > 1 ? (
          <Text style={type.small}>
            {queue.at + 1} / {urls.length}
          </Text>
        ) : null}
      </View>
      <View style={styles.track}>
        <View style={[styles.trackFill, { width: `${Math.round(fraction * 100)}%` }]} />
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          // Skipping is allowed — it is practice — but it counts as finished,
          // so the options appear rather than the screen waiting for ever.
          queue.stop();
          report();
        }}
        // The only way out of a run that has stalled before the watch gives up
        // on it, so it is a full thumb's height, not a line of small print.
        style={({ pressed }) => [styles.link, pressed && { opacity: 0.85 }]}
      >
        <Text style={[type.small, styles.toggle]}>{t("skip")}</Text>
      </Pressable>
    </View>
  );
}
