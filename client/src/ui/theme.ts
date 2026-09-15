/**
 * One place for colour and spacing, so screens argue about layout and not hex.
 *
 * Deliberately quiet. The content is dense Japanese prose that people read on a
 * train; anything with strong colour competes with it. Correct/incorrect are the
 * only two places allowed to shout, and they are distinguishable without colour
 * too (a tick, a cross, a label) because roughly one man in twelve cannot tell
 * the green from the red.
 */
import { StyleSheet } from "react-native";

export const colors = {
  bg: "#FBFAF8",
  surface: "#FFFFFF",
  border: "#E6E2DA",
  text: "#1D1B18",
  muted: "#6B655C",
  accent: "#2F5D50",
  accentSoft: "#E7EFEB",
  correct: "#1F6F4A",
  correctSoft: "#E6F2EB",
  wrong: "#A33A2A",
  wrongSoft: "#F8E9E6",
  warn: "#B07A1E",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const type = StyleSheet.create({
  h1: { fontSize: 24, fontWeight: "700", color: colors.text, lineHeight: 34 },
  h2: { fontSize: 18, fontWeight: "700", color: colors.text, lineHeight: 27 },
  // Japanese needs more leading than Latin at the same size, or the kanji sit
  // on top of each other.
  body: { fontSize: 16, color: colors.text, lineHeight: 28 },
  option: { fontSize: 16, color: colors.text, lineHeight: 26 },
  small: { fontSize: 13, color: colors.muted, lineHeight: 21 },
  mono: { fontSize: 12, color: colors.muted },
});

export const card = {
  backgroundColor: colors.surface,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colors.border,
  padding: space.lg,
} as const;
