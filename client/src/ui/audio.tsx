/**
 * Playing a clip — and coping when there isn't one.
 *
 * Items are published before their audio exists, so every one of these controls
 * has to have a sensible shape when `path` is null. The choice made here is to
 * show the text instead of hiding the control: a listening item with no audio is
 * still a usable reading item, and it is much better than a dead play button.
 *
 * When the clips do exist this is also where the replay rule will live. The real
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
import { colors, radius, space, type } from "./theme";

/**
 * A play button with nothing but an icon — for an option that is heard rather
 * than read. Sits inside the option's own Pressable; a press here plays, a press
 * anywhere else on the option answers, which is the same split as a letter and
 * a speaker button on the exam room's answer sheet.
 */
export function MiniPlay({ url, label }: { url: string; label: string }) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        if (playing) {
          player.pause();
        } else {
          player.seekTo(0);
          player.play();
        }
      }}
      style={({ pressed }) => [styles.mini, pressed && { opacity: 0.85 }]}
    >
      <Icon name={playing ? "stop" : "play"} size={16} color={colors.onAccent} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
 * same thing, so today the end is reported twice; a browser that does not is
 * one where a clip shorter than the interval could finish without the queue
 * ever hearing about it. 250ms is comfortably under the shortest thing the
 * library says aloud, which is a letter.
 */
const STATUS_INTERVAL_MS = 250;

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
 * advanced on `status.didJustFinish` therefore fired twice for one clip: once
 * on the finish, and again when the index it depends on changed with the same
 * stale `true` still showing. That is why a listening run played the first,
 * third and fifth clips and skipped every even one.
 *
 * An event is delivered once, to a listener attached to the player that sent
 * it, so a status belonging to the clip before can no longer be read as this
 * one's. `handled` is the other half, and web is why: `didJustFinish` there is
 * `media.ended`, a state that stays true rather than a one-shot, and a clip
 * that reaches its end reports it on the final time update *and* again on the
 * pause that follows. One advance per player is what makes that one step.
 *
 * A clip with no audio yet is stepped over rather than waited for: a
 * half-synthesised item should still play the parts that exist.
 */
function useClipQueue(
  urls: (string | null)[],
  { autoplay = false, onFinished }: { autoplay?: boolean; onFinished?: () => void } = {}
): ClipQueue {
  const firstPlayable = () => Math.max(0, urls.findIndex(Boolean));
  const [at, setAt] = React.useState(firstPlayable);
  const [running, setRunning] = React.useState(autoplay && urls.some(Boolean));
  const player = useAudioPlayer(urls[at] ?? null, { updateInterval: STATUS_INTERVAL_MS });
  const status = useAudioPlayerStatus(player);

  // What the listener reads when an event arrives. Both are re-read rather than
  // captured: the list is rebuilt by the parent's render and `onFinished` is
  // usually written inline, and neither should re-subscribe the listener.
  const live = React.useRef({ urls, onFinished });
  live.current = { urls, onFinished };

  React.useEffect(() => {
    if (!running) return undefined;
    // One advance per clip. Declared here rather than in a ref so that it
    // resets with the listener — on the next clip, and on a replay of this one.
    let handled = false;
    const sub = player.addListener("playbackStatusUpdate", (s) => {
      if (handled || !s.didJustFinish) return;
      handled = true;
      const list = live.current.urls;
      let next = at + 1;
      while (next < list.length && !list[next]) next += 1;
      if (next < list.length) {
        setAt(next);
        return;
      }
      setRunning(false);
      setAt(0);
      live.current.onFinished?.();
    });
    return () => sub.remove();
    // `at` is a dependency so that two identical clips in a row — which share
    // one player, because the source is what builds it — still get a listener
    // each.
  }, [player, running, at]);

  React.useEffect(() => {
    if (!running || !urls[at]) return;
    player.seekTo(0);
    player.play();
  }, [player, running, at]);

  const start = React.useCallback(() => {
    const first = live.current.urls.findIndex(Boolean);
    if (first < 0) return;
    setAt(first);
    setRunning(true);
  }, []);

  const stop = React.useCallback(() => {
    player.pause();
    setRunning(false);
    setAt(Math.max(0, live.current.urls.findIndex(Boolean)));
  }, [player]);

  return { at, running, status, start, stop };
}

/**
 * A heard conversation.
 *
 * Turns play one after another rather than as a single file, for a reason that
 * outlives this component: clip ids are content hashes, so 「承知しました。」 is
 * synthesised once and shared by every item that contains it. Concatenating a
 * conversation server-side would throw that away and make one file per item.
 *
 * The transcript is hidden until the learner asks for it. 総合聴解 is a listening
 * item — a transcript on screen from the start turns it into a reading item with
 * an audio track — but refusing to show it at all would be worse: practice is
 * not the exam, and the fourth listen is where you finally hear that it was
 * 伺います and not 参ります.
 */
export function DialoguePlayer({ turns }: { turns: DialogueTurn[] }) {
  const { t } = useLang();
  const [showText, setShowText] = React.useState(false);
  const paths = turns.map((turn) => clipUrl(turn.audio_path));
  const playable = paths.filter(Boolean).length;

  // Nothing synthesised yet: the whole exchange is a script on the page, which
  // is how every item works before its audio exists.
  if (playable === 0) {
    return (
      <View style={styles.transcript}>
        <Text style={type.small}>{t("dialogue_pending")}</Text>
        {turns.map((turn, i) => (
          <Turn key={i} turn={turn} />
        ))}
      </View>
    );
  }

  return (
    <View style={{ gap: space.sm }}>
      <DialogueTrack turns={turns} paths={paths} />
      <Pressable
        accessibilityRole="button"
        onPress={() => setShowText((v) => !v)}
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      >
        <Text style={[type.small, styles.toggle]}>
          {showText ? t("hide_text") : t("show_text")}
        </Text>
      </Pressable>
      {showText ? (
        <View style={styles.transcript}>
          {turns.map((turn, i) => (
            <Turn key={i} turn={turn} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Turn({ turn }: { turn: DialogueTurn }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={type.small}>{turn.speaker_role}</Text>
      <Text style={type.body}>{turn.text}</Text>
    </View>
  );
}

/** Plays each turn in order, advancing when one finishes. */
function DialogueTrack({ turns, paths }: { turns: DialogueTurn[]; paths: (string | null)[] }) {
  const { t } = useLang();
  const queue = useClipQueue(paths);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={queue.running ? t("stop_dialogue") : t("listen_dialogue")}
      onPress={() => (queue.running ? queue.stop() : queue.start())}
      style={({ pressed }) => [styles.play, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.playIcon}>
        <Icon
          name={queue.running ? "stop" : "play"}
          size={18}
          color={colors.onAccent}
          strokeWidth={2}
        />
      </View>
      <Text style={[type.body, { flex: 1 }]}>{t("listen_dialogue")}</Text>
      <Text style={type.small}>
        {queue.at + 1} / {turns.length}
      </Text>
    </Pressable>
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
 * it as letters and may be answered before it finishes.
 *
 * `autoplay` is read once, on mount. The screen mounts this at the listening
 * stage and keeps it mounted through answering, so the replay button is the
 * same player, and the item's `id` is the key that resets it.
 */
export function AutoPlaylist({
  urls,
  autoplay,
  onFinished,
}: {
  urls: string[];
  autoplay: boolean;
  onFinished?: () => void;
}) {
  const { t } = useLang();
  const [finished, setFinished] = React.useState(!autoplay || urls.length === 0);
  const reported = React.useRef(false);
  const report = () => {
    setFinished(true);
    if (reported.current) return;
    reported.current = true;
    onFinished?.();
  };
  const queue = useClipQueue(urls, {
    autoplay: autoplay && urls.length > 0,
    onFinished: report,
  });

  if (urls.length === 0) return null;

  if (!queue.running && finished) {
    // Always replayable. The exam plays a clip once; practice is not the exam,
    // and the fourth listen is where a learner finally hears that it was
    // 伺います and not 参ります.
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("listen_again")}
        onPress={queue.start}
        style={({ pressed }) => [styles.play, pressed && { opacity: 0.85 }]}
      >
        <View style={styles.playIcon}>
          <Icon name="play" size={18} color={colors.onAccent} strokeWidth={2} />
        </View>
        <Text style={type.body}>{t("listen_again")}</Text>
      </Pressable>
    );
  }

  const { status } = queue;
  const fraction =
    status.duration && status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  return (
    <View style={styles.listening} accessibilityLiveRegion="polite">
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
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      >
        <Text style={[type.small, styles.toggle]}>{t("skip")}</Text>
      </Pressable>
    </View>
  );
}
