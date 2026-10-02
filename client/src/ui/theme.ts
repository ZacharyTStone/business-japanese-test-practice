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
 * `client/src/ui/theme.test.ts` holds the tokens to that; the rule about which
 * fills carry text is one a reader has to keep, so it is written here.
 */
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";

export const colors = {
  bg: "#F4F5FB",
  surface: "#FFFFFF",
  surfaceAlt: "#FAFAFE",
  border: "#EAEAF4",
  /** The edge of something you type into. `border` is a card's hairline at 1.2:1,
   *  which leaves a field on white with no visible edge; this is 3.4:1, the floor
   *  for a control's boundary. */
  inputBorder: "#8A88A3",
  text: "#1B1A2E",
  /** The second line. Dark enough to be read on every soft fill it sits on —
   *  the verdict card's green and red, the violet of a default tag — and not
   *  only on white: #6E6C89 was 4.4:1 on those, this is 5.1–5.3 (5.9 on white). */
  muted: "#636180",
  /** The edge of a card. A shadow alone reads as a smudge on a bright screen;
   *  a hairline under it is what makes the edge a decision. Kept translucent
   *  so it is the same tint on white and on the soft violet. */
  hairline: "rgba(32, 30, 68, 0.07)",

  accent: "#6C5CE7",
  accentDeep: "#4B3BD4",
  /** The far end of a hero's fill. The gradient runs from `accentDeep` rather
   *  than `accent` because its lightest violet sits under the hero's top-left
   *  corner, which is exactly where the small text sits. */
  accentInk: "#3B2EB3",
  accentSoft: "#EFEDFF",
  /** Text and controls that sit on top of an accent-filled surface. Muted is a
   *  step down in weight, not a step towards invisible: it stays above 4.5:1. */
  onAccent: "#FFFFFF",
  onAccentMuted: "#E8E4FF",

  /** The verdict ink. Dark enough to be *read* on its own soft background —
   *  「正解」 on the green card, and the marked option in the review. */
  correct: "#097A52",
  correctSoft: "#E3F6EF",
  wrong: "#C62B3C",
  wrongSoft: "#FDEBEE",
  /** The one amber that warns — the reading clock running low, the 場面ちがい
   *  meter, a notice's alert. It is drawn as a shape, not as text, so the bar
   *  is 3:1: 4.4 on white, 3.9 on `wrongSoft`. The lighter amber it replaces
   *  was 2.5 and 2.2, a clock bar that faded into the card as it ran out. */
  warn: "#A86A10",
} as const;

/**
 * The paper's own palette, for everything drawn inside a document
 * (ui/document.tsx) and the charts on it (ui/chart.tsx). Deliberately not
 * `colors`: a quotation is black on white whoever's app it is being read in,
 * and nothing on the sheet is coloured purple — the app's visual language stops
 * at the edge of the sheet. A chart is ink too: its series are told apart by
 * fill, dash and marker — solid, grey, open — the way a photocopied chart tells
 * them apart, never by hue.
 */
export const ink = {
  paper: "#FFFFFF",
  text: "#1F1F1F",
  faint: "#5C5C5C",
  rule: "#9A9A9A",
  ruleLight: "#D6D6D6",
  headFill: "#F2F2F2",
  mailFill: "#F7F7F7",
  postit: "#FFF8D6",
  /** The middle of a chart's three fills: solid ink, this grey, open paper.
   *  Far enough from both that a bar is never mistaken for its neighbour. */
  seriesGrey: "#8C8C8C",
} as const;

/**
 * The tints a counted thing can wear. Assigned per card, not per value — the
 * colour says *which* statistic this is so the eye can come back to the same one
 * tomorrow, and it never encodes whether the number is good.
 *
 * `fg` is text as well as an icon: `Tag` writes 13px bold in it on `bg`, so
 * each pair clears 4.5:1 (5.2–5.6), not just the 3:1 an icon would need.
 */
export const badge = {
  violet: { fg: "#5646D6", bg: "#EFEDFF" },
  teal: { fg: "#0A6F6F", bg: "#E0F5F5" },
  pink: { fg: "#B0306F", bg: "#FCE9F3" },
  amber: { fg: "#8A5A0E", bg: "#FBF1DF" },
  blue: { fg: "#2A5FC0", bg: "#E7F0FD" },
} as const;

export type BadgeTone = keyof typeof badge;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** The tab bar's own height, before the strip under it that a phone's home
 *  indicator or gesture bar owns — `useTabBarHeight` in ui/tabbar.ts adds
 *  that, per device. */
export const TAB_BAR_HEIGHT = 76;

/** What a tab screen leaves under its last card beyond the bar itself, so the
 *  last card ends on the page rather than on the bar's shadow. */
export const TAB_BREATHING = 28;

/** The widest a page's content runs. Past this a line of Japanese is too long to
 *  read and a button too wide to be one; a wider window centres the column. */
export const PAGE_MAX_WIDTH = 720;

/** A page's content column: the full width on a phone, centred and capped on a
 *  desktop or tablet. Spread into a `contentContainerStyle`. */
export const page: ViewStyle = { width: "100%", maxWidth: PAGE_MAX_WIDTH, alignSelf: "center" };

/** The smallest thing a thumb is asked to hit, per both platforms' guidelines.
 *  A text link reaches it with vertical padding, not `hitSlop`, which web ignores. */
export const MIN_TOUCH = 44;

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
