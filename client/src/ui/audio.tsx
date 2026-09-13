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
      <Text style={styles.playIcon}>{playing ? "■" : "▶"}</Text>
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
    borderRadius: radius.md,
    padding: space.lg,
  },
  playIcon: { fontSize: 16, color: colors.accent },
});
