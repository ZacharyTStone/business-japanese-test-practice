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
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { clipUrl } from "../lib/db";
import type { DialogueTurn } from "../lib/types";
import { Icon } from "./icons";
import { colors, radius, space, type } from "./theme";

export function ClipButton({
  path,
  text,
  label,
}: {
  path: string | null;
  text: string;
  label: string;
}) {
  const url = clipUrl(path);
  const player = useAudioPlayer(url ?? null);
  const status = useAudioPlayerStatus(player);

  if (!url) {
    // No audio yet. Say so plainly rather than leaving a button that does
    // nothing — a control that silently fails is worse than no control.
    return (
      <View style={styles.fallback}>
        <Text style={type.small}>{label}（音声は準備中）</Text>
        <Text style={type.body}>{text}</Text>
      </View>
    );
  }

  const playing = status.playing;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}を再生`}
      onPress={() => {
        if (playing) {
          player.pause();
        } else {
          player.seekTo(0);
          player.play();
        }
      }}
      style={({ pressed }) => [styles.play, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.playIcon}>
        <Icon name={playing ? "stop" : "play"} size={18} color={colors.onAccent} strokeWidth={2} />
      </View>
      <Text style={type.body}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.xs,
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
});


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
  const [showText, setShowText] = React.useState(false);
  const paths = turns.map((t) => clipUrl(t.audio_path));
  const playable = paths.filter(Boolean).length;

  // Nothing synthesised yet: the whole exchange is a script on the page, which
  // is how every item works before its audio exists.
  if (playable === 0) {
    return (
      <View style={styles.transcript}>
        <Text style={type.small}>会話（音声は準備中）</Text>
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
          {showText ? "本文を隠す" : "本文を見る"}
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
  const [at, setAt] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const player = useAudioPlayer(paths[at] ?? null);
  const status = useAudioPlayerStatus(player);

  React.useEffect(() => {
    if (!running) return;
    if (!status.didJustFinish) return;
    // Skip any turn that has no clip yet rather than stalling on it: a
    // half-synthesised conversation should still play the parts that exist.
    let next = at + 1;
    while (next < paths.length && !paths[next]) next += 1;
    if (next >= paths.length) {
      setRunning(false);
      setAt(0);
      return;
    }
    setAt(next);
  }, [status.didJustFinish, running, at, paths]);

  React.useEffect(() => {
    if (running && paths[at]) {
      player.seekTo(0);
      player.play();
    }
  }, [at, running]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={running ? "会話を止める" : "会話を再生する"}
      onPress={() => {
        if (running) {
          player.pause();
          setRunning(false);
          setAt(0);
        } else {
          setRunning(true);
          player.seekTo(0);
          player.play();
        }
      }}
      style={({ pressed }) => [styles.play, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.playIcon}>
        <Icon name={running ? "stop" : "play"} size={18} color={colors.onAccent} strokeWidth={2} />
      </View>
      <Text style={[type.body, { flex: 1 }]}>会話を聞く</Text>
      <Text style={type.small}>
        {at + 1} / {turns.length}
      </Text>
    </Pressable>
  );
}
