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
 *
 * **An accent fill that carries text is `accentDeep` or darker.** The furniture
 * still has to be legible, and `accent` is too light to hold two weights of
 * text: white on `#6C5CE7` is 4.86:1, which leaves nothing underneath it for a
 * quieter second line, and the quieter line is the one the hero uses for the
 * countdown and the streak. On `accentDeep` white is 7.3:1 and `onAccentMuted`
 * is 5.9:1, so both clear 4.5:1 — the floor for 13px text — with room to spare.
 * `tests/test_theme_contrast.py` holds the tokens to that; the rule about which
 * fills carry text is one a reader has to keep, so it is written here.
 */
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";

export const colors = {
  bg: "#F4F5FB",
  surface: "#FFFFFF",
  surfaceAlt: "#FAFAFE",
  border: "#EAEAF4",
  text: "#1B1A2E",
  muted: "#6E6C89",
  /** The edge of a card. A shadow alone reads as a smudge on a bright screen;
   *  a hairline under it is what makes the edge a decision. Kept translucent
   *  so it is the same tint on white and on the soft violet. */
  hairline: "rgba(32, 30, 68, 0.07)",

  accent: "#6C5CE7",
  accentDeep: "#4B3BD4",
  /** The far end of a hero's fill. A gradient run from `accent` put its lightest
   *  violet under the hero's top-left corner, which is exactly where the small
   *  text sits; running it from `accentDeep` instead keeps the depth and gives
   *  that corner 2.5 more points of contrast. */
  accentInk: "#3B2EB3",
  accentSoft: "#EFEDFF",
  /** Text and controls that sit on top of an accent-filled surface. Muted is a
   *  step down in weight, not a step towards invisible: it stays above 4.5:1. */
  onAccent: "#FFFFFF",
  onAccentMuted: "#E8E4FF",

  /** The verdict ink. Dark enough to be *read* on its own soft background —
   *  「正解」 on the green card, and the marked option in the review — which the
   *  brighter pair it replaces was not: 3.0:1 and 3.9:1 against those fills. */
  correct: "#097A52",
  correctSoft: "#E3F6EF",
  wrong: "#C62B3C",
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

/**
 * The typeface, named rather than left to the browser.
 *
 * Nothing is downloaded: a web font for Japanese is several megabytes, and the
 * learner is on a train. What this does is put the *right* system face first
 * for the script. Left to `sans-serif`, Windows draws kanji in whatever it
 * finds after Segoe UI — often MS Gothic, bitmap-hinted and jagged — and
 * Android may pick a Chinese-variant CJK face with the wrong glyph shapes for
 * Japanese. The order here is the Latin face the platform designed for its
 * own UI, then that platform's Japanese face, so mixed text sits on one
 * baseline with one weight. Only the web reads this (see `app/+html.tsx`);
 * a native build's system font already does it.
 */
export const fontStack =
  '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", ' +
  '"Segoe UI Variable", "Segoe UI", "Yu Gothic UI", "Meiryo", Roboto, "Noto Sans JP", ' +
  '"Noto Sans CJK JP", "Helvetica Neue", Arial, sans-serif';

/**
 * How long things take to move, in milliseconds. Short enough that nobody
 * waits for them; long enough to be seen. `useReducedMotion` in ui/motion.tsx
 * turns every one of them off for a person who has asked the OS for that.
 */
export const motion = {
  /** A card or a stage arriving. */
  enter: 320,
  /** A ring or a bar reaching its value. */
  fill: 640,
  /** A button answering a press. */
  press: 120,
} as const;

/** Depth, kept shallow. A card lifts off the page; nothing shouts. */
export const shadow: { card: ViewStyle; cardRaised: ViewStyle; hero: ViewStyle; bar: ViewStyle } = {
  // Two shadows, not one: a tight one that draws the edge, and a wide soft one
  // that lifts the card. A single mid-sized blur does neither and reads as a
  // smudge.
  card: { boxShadow: "0 1px 2px rgba(32, 30, 68, 0.04), 0 8px 24px rgba(32, 30, 68, 0.06)" },
  /** The same card under a pointer: a little further off the page. */
  cardRaised: { boxShadow: "0 2px 4px rgba(32, 30, 68, 0.05), 0 14px 32px rgba(32, 30, 68, 0.10)" },
  hero: { boxShadow: "0 2px 6px rgba(59, 46, 179, 0.18), 0 16px 36px rgba(75, 59, 212, 0.28)" },
  bar: { boxShadow: "0 -1px 0 rgba(32, 30, 68, 0.05), 0 -6px 20px rgba(32, 30, 68, 0.05)" },
};

/** Digits that all take the same width, so a counter does not jiggle as it
 *  counts and a column of percentages lines up. Anything that is read as a
 *  number rather than as a word gets it. */
export const tabular: { fontVariant: TextStyle["fontVariant"] } = { fontVariant: ["tabular-nums"] };

export const type = StyleSheet.create({
  // A headline set a touch tighter than the body: at 26px the default tracking
  // reads loose, and the kanji in a title stand better shoulder to shoulder.
  h1: { fontSize: 26, fontWeight: "700", color: colors.text, lineHeight: 36, letterSpacing: -0.3 },
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
  stat: { fontSize: 22, fontWeight: "700", color: colors.text, lineHeight: 30, ...tabular },
});

export const card = {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: colors.hairline,
  padding: space.lg,
  ...shadow.card,
} as const;
