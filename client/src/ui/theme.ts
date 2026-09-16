/**
 * One place for colour and spacing, so screens argue about layout and not hex.
 *
 * Colour does two jobs here and only two. It **identifies** — a violet surface is
 * where the app is speaking, a tinted badge says which kind of thing a card
 * counts — and it **warns**, in exactly two places. It never carries meaning on
 * its own: correct and incorrect are marked with a word and a symbol as well as
 * a colour, because roughly one man in twelve cannot tell the green from the red.
 *
 * Everything a learner has to *read* stays near-black on white. The content is
 * dense Japanese prose read on a train; the colour lives in the furniture around
 * it — headers, badges, progress — and not behind the sentences themselves.
 */
import { StyleSheet, type ViewStyle } from "react-native";

export const colors = {
  bg: "#F4F5FB",
  surface: "#FFFFFF",
  surfaceAlt: "#FAFAFE",
  border: "#EAEAF4",
  text: "#1B1A2E",
  muted: "#6E6C89",

  accent: "#6C5CE7",
  accentDeep: "#4B3BD4",
  accentSoft: "#EFEDFF",
  /** Text and controls that sit on top of an accent-filled surface. */
  onAccent: "#FFFFFF",
  onAccentMuted: "#DBD5FF",

  correct: "#0E9F6E",
  correctSoft: "#E3F6EF",
  wrong: "#D93A4B",
  wrongSoft: "#FDEBEE",
  warn: "#E0952A",
} as const;

/**
 * The tints a counted thing can wear. Assigned per card, not per value — the
 * colour says *which* statistic this is so the eye can come back to the same one
 * tomorrow, and it never encodes whether the number is good.
 */
export const badge = {
  violet: { fg: "#6C5CE7", bg: "#EFEDFF" },
  teal: { fg: "#0E9A9A", bg: "#E0F5F5" },
  pink: { fg: "#DB4E9B", bg: "#FCE9F3" },
  amber: { fg: "#CE8A1E", bg: "#FBF1DF" },
  blue: { fg: "#3A76E0", bg: "#E7F0FD" },
} as const;

export type BadgeTone = keyof typeof badge;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** What a tab screen has to leave under its last card so the bar does not sit on
 *  top of it. The bar is 76 tall and floats over the content on web. */
export const TAB_CLEARANCE = 104;

export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;

/** Depth, kept shallow. A card lifts off the page; nothing shouts. */
export const shadow: { card: ViewStyle; hero: ViewStyle; bar: ViewStyle } = {
  card: { boxShadow: "0 6px 16px rgba(32, 30, 68, 0.06)" },
  hero: { boxShadow: "0 12px 28px rgba(75, 59, 212, 0.28)" },
  bar: { boxShadow: "0 -2px 14px rgba(32, 30, 68, 0.06)" },
};

export const type = StyleSheet.create({
  h1: { fontSize: 26, fontWeight: "700", color: colors.text, lineHeight: 36 },
  h2: { fontSize: 18, fontWeight: "700", color: colors.text, lineHeight: 27 },
  // Japanese needs more leading than Latin at the same size, or the kanji sit
  // on top of each other.
  body: { fontSize: 16, color: colors.text, lineHeight: 28 },
  option: { fontSize: 16, color: colors.text, lineHeight: 26 },
  small: { fontSize: 13, color: colors.muted, lineHeight: 21 },
  mono: { fontSize: 12, color: colors.muted },
  /** The quiet label above a group of cards. */
  label: { fontSize: 12, fontWeight: "700", color: colors.muted, letterSpacing: 0.6 },
  /** A counted number, big enough to read at a glance and not a moment longer. */
  stat: { fontSize: 22, fontWeight: "700", color: colors.text, lineHeight: 30 },
});

export const card = {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  padding: space.lg,
  ...shadow.card,
} as const;
