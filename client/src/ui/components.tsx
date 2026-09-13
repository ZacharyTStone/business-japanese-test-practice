/**
 * The handful of pieces every screen uses.
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { card, colors, radius, space, type } from "./theme";

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  tone = "primary",
  disabled,
  sub,
}: {
  label: string;
  onPress: () => void;
  tone?: "primary" | "secondary";
  disabled?: boolean;
  sub?: string;
}) {
  const primary = tone === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonSecondary,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonLabel, !primary && { color: colors.accent }]}>{label}</Text>
      {sub ? <Text style={[styles.buttonSub, !primary && { color: colors.muted }]}>{sub}</Text> : null}
    </Pressable>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Text style={[type.small, { marginTop: space.md }]}>{label}</Text> : null}
    </View>
  );
}

export function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Card style={{ gap: space.sm }}>
      <Text style={type.h2}>{title}</Text>
      <Text style={type.small}>{body}</Text>
    </Card>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.tag}>
      <Text style={type.small}>{children}</Text>
    </View>
  );
}

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
export type AdPlacement = "session_result" | "list_screen";

export function AdSlot({ placement, enabled }: { placement: AdPlacement; enabled: boolean }) {
  if (!enabled || !__DEV__) return null;
  return (
    <View style={styles.adSlot}>
      <Text style={type.mono}>ad slot · {placement}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
    alignItems: "center",
    gap: 2,
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.accentSoft },
  buttonLabel: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  buttonSub: { color: "#D6E3DD", fontSize: 12 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  tag: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  adSlot: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: space.lg,
    alignItems: "center",
  },
});
