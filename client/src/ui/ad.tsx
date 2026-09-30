import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, radius, space, type } from "./theme";

/**
 * Where an ad may go — and, more importantly, where one may not.
 *
 * The placement type has exactly two members, so putting an ad on the practice
 * screen is a type error rather than a judgement call somebody makes later under
 * deadline. Listening practice is never interrupted: an ad between the narration
 * and the options would not just be annoying, it would make the question harder
 * in a way the exam never does.
 *
 * Nothing renders yet — no ad SDK is wired up, and the free tier is meant to be
 * genuinely complete. This is the seam, kept honest by the type.
 */
type AdPlacement = "session_result" | "list_screen";

export function AdSlot({ placement, enabled }: { placement: AdPlacement; enabled: boolean }) {
  if (!enabled || !__DEV__) return null;
  return (
    <View style={styles.adSlot}>
      <Text style={type.mono}>ad slot · {placement}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  adSlot: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: "center",
  },
});
