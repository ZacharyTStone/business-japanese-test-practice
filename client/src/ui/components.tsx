/**
 * The handful of pieces every screen uses.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { isIsoDate } from "../lib/exam";
import { Icon, type IconName } from "./icons";
import { usePressScale, useReducedMotion, useTween } from "./motion";
import { badge, card, colors, motion, radius, shadow, space, tabular, type } from "./theme";
import type { BadgeTone } from "./theme";

/** Anything else a View takes comes through — the accessibility props in
 *  particular, so a card that appears in response to an answer can announce
 *  itself without being wrapped in another View to carry the attribute. */
export function Card({ children, style, ...rest }: ViewProps) {
  return (
    <View style={[card, style]} {...rest}>
      {children}
    </View>
  );
}

/**
 * A card the app speaks from, rather than one the learner reads from.
 *
 * The gradient is drawn as SVG rather than pulled in as a gradient package: one
 * rectangle with two stops is not worth a dependency, and this way the same code
 * paints the web export and a native build.
 */
export function GradientCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  // The gradient needs an id of its own. Two of these can be in the document
  // at once — the tab stack keeps 今日 mounted behind the result screen — and
  // two paint servers sharing one id is a reference that resolves to whichever
  // the browser saw first, and to nothing at all when that one unmounts.
  const fill = `heroFill${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <View style={[styles.gradientCard, style]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id={fill} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.accentDeep} />
            <Stop offset="1" stopColor={colors.accentInk} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${fill})`} />
        {/* Two soft lights, low on the right, where no text sits. They are
            what stops a flat fill reading as a coloured rectangle; at this
            opacity they take nothing measurable off the contrast of the
            lines in the top-left corner (see tests/test_theme_contrast.py). */}
        <Circle cx="88%" cy="112%" r="52%" fill="rgba(255,255,255,0.09)" />
        <Circle cx="104%" cy="18%" r="26%" fill="rgba(255,255,255,0.06)" />
      </Svg>
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  tone = "primary",
  disabled,
  sub,
  icon,
}: {
  label: string;
  onPress: () => void;
  tone?: "primary" | "secondary" | "onAccent";
  disabled?: boolean;
  sub?: string;
  icon?: IconName;
}) {
  // A button that cannot be pressed is drawn as one, rather than as a faded
  // copy of a button that can: the fill goes flat, the label goes grey, the
  // shadow goes. Fading it left every colour on the card lying about its own
  // contrast — and, on a screen where something else is also faded, made the
  // two indistinguishable. The owner asked for state to be drawn rather than
  // dimmed (2026-09-20).
  const labelColor = disabled
    ? colors.muted
    : tone === "primary"
      ? colors.onAccent
      : tone === "onAccent"
        ? colors.accentDeep
        : colors.accent;
  const subColor = disabled
    ? colors.muted
    : tone === "primary"
      ? colors.onAccentMuted
      : colors.muted;
  // The face of the button scales under the finger; the Pressable around it
  // is the hit area and does not move, so a press that started on the edge
  // is still on the button when it lifts.
  const press = usePressScale();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      disabled={disabled}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.button,
            tone === "primary" && styles.buttonPrimary,
            tone === "secondary" && styles.buttonSecondary,
            tone === "onAccent" && styles.buttonOnAccent,
            // Last of the fills, so it replaces the tone's rather than sitting
            // over it at half strength.
            disabled && styles.buttonOff,
            hovered && !disabled && (tone === "primary" ? styles.buttonPrimaryHover : styles.buttonHover),
            pressed && !disabled && styles.pressed,
            press.style,
          ]}
        >
          <View style={styles.buttonRow}>
            {icon ? <Icon name={icon} size={18} color={labelColor} strokeWidth={2} /> : null}
            <Text style={[styles.buttonLabel, { color: labelColor }]}>{label}</Text>
          </View>
          {sub ? <Text style={[styles.buttonSub, { color: subColor }]}>{sub}</Text> : null}
        </Animated.View>
      )}
    </Pressable>
  );
}

/**
 * A wait, shown only once it is one.
 *
 * Most loads finish inside a quarter of a second, and a spinner that appears
 * and vanishes in that time is not information — it is a flicker between two
 * screens that were going to look the same anyway. So the indicator holds
 * off for that long, then fades in. A long wait still looks like a wait; a
 * short one looks like nothing happened, which is the truth.
 */
export function Loading({ label }: { label?: string }) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(opacity, {
      toValue: 1,
      duration: reduced ? 0 : motion.enter,
      delay: 250,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== "web",
    });
    anim.start();
    return () => anim.stop();
  }, [reduced, opacity]);
  return (
    <Animated.View style={[styles.centered, { opacity }]}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Text style={[type.small, { marginTop: space.md }]}>{label}</Text> : null}
    </Animated.View>
  );
}

/**
 * Something the app has to say for itself: a missing setting, a failed load, an
 * empty shelf. `action` is what turns the last of those from a dead end into a
 * screen somebody can leave — an error with no way forward is a crash with
 * better manners.
 */
export function Notice({
  title,
  body,
  tone = "info",
  action,
}: {
  title: string;
  body: string;
  tone?: "info" | "warn";
  action?: { label: string; onPress: () => void };
}) {
  const warn = tone === "warn";
  return (
    <Card style={warn ? styles.noticeWarn : undefined}>
      <View style={styles.noticeHead}>
        <View style={[styles.noticeIcon, { backgroundColor: warn ? "#FBF1DF" : colors.accentSoft }]}>
          <Icon name={warn ? "alert" : "spark"} size={16} color={warn ? colors.warn : colors.accent} />
        </View>
        <Text style={[type.h2, { flex: 1 }]}>{title}</Text>
      </View>
      <Text style={[type.small, { marginTop: space.sm }]}>{body}</Text>
      {action ? (
        <View style={{ marginTop: space.lg }}>
          <Button label={action.label} tone="secondary" onPress={action.onPress} />
        </View>
      ) : null}
    </Card>
  );
}

export function Tag({ children, tone }: { children: React.ReactNode; tone?: BadgeTone }) {
  const paint = tone ? badge[tone] : { fg: colors.muted, bg: colors.accentSoft };
  return (
    <View style={[styles.tag, { backgroundColor: paint.bg }]}>
      <Text style={[type.small, { color: paint.fg, fontWeight: "700" }]}>{children}</Text>
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={type.label}>{children}</Text>;
}

export function IconBadge({ name, tone, size = 34 }: { name: IconName; tone: BadgeTone; size?: number }) {
  return (
    <View
      style={[
        styles.iconBadge,
        { width: size, height: size, borderRadius: size / 3, backgroundColor: badge[tone].bg },
      ]}
    >
      <Icon name={name} size={size * 0.55} color={badge[tone].fg} strokeWidth={2} />
    </View>
  );
}

/**
 * A counted thing, with the tint that identifies it.
 *
 * `value` is a string and not a number on purpose: the honest reading of "no
 * answers yet" is 「—」, not 0%, and the caller is the only one who knows which
 * of those it has.
 */
export function StatCard({
  name,
  tone,
  label,
  value,
  caption,
}: {
  name: IconName;
  tone: BadgeTone;
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <View style={styles.statCard}>
      <IconBadge name={name} tone={tone} size={30} />
      <Text style={[type.small, { marginTop: space.sm }]}>{label}</Text>
      <Text style={type.stat}>{value}</Text>
      {caption ? <Text style={type.small}>{caption}</Text> : null}
    </View>
  );
}

/**
 * A ring, for a fraction of something finite — today's goal, a run of answers.
 *
 * Never an accuracy or a level. A ring reads as "how far along", and accuracy is
 * not a journey to the edge of a circle.
 */
export function ProgressRing({
  value,
  size = 84,
  stroke = 9,
  color = colors.onAccent,
  track = "rgba(255,255,255,0.28)",
  label,
  caption,
  labelColor = colors.onAccent,
  captionColor = colors.onAccentMuted,
  accessibilityLabel,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  label: string;
  caption?: string;
  labelColor?: string;
  /** The caption is the quiet half of the ring, and it used to be the label at
   *  85% opacity — a second way of saying "muted" that no contrast check could
   *  see through. It is the same token as every other quiet line on an accent
   *  fill now, so it moves when that one does. */
  captionColor?: string;
  /** What the ring means in words. Without it a screen reader reads "3 / 5" and
   *  "today" as two loose fragments with a circle between them. */
  accessibilityLabel?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  // The arc is drawn to where the number is on its way to, from empty on the
  // first frame: a ring that fills is read as "this much", a ring that is
  // simply full when the screen appears is read as decoration. The
  // accessibility value is the destination, not the frame.
  const drawn = useTween(clamped, { from: 0 });
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? (caption ? `${caption} ${label}` : label)}
      accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }}
    >
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - drawn)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.ringCenter]}>
        <Text style={[styles.ringLabel, { color: labelColor }]}>{label}</Text>
        {caption ? (
          <Text style={[styles.ringCaption, { color: captionColor }]}>{caption}</Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A bar, for the same kind of thing as the ring: a fraction of something
 * finite, or an accuracy laid beside others of its kind so the lengths can be
 * compared. The fill moves to its value rather than jumping, and moves again
 * when the value does — on the practice screen that is one question's width
 * every answer, which is the whole of what the bar has to say.
 */
export function ProgressBar({
  value,
  height = 8,
  color = colors.accent,
  track = colors.border,
  style,
}: {
  value: number;
  height?: number;
  color?: string;
  track?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, value));
  const width = useRef(new Animated.Value(clamped)).current;
  useEffect(() => {
    const anim = Animated.timing(width, {
      toValue: clamped,
      duration: reduced ? 0 : motion.fill,
      easing: Easing.out(Easing.cubic),
      // Width is layout, which no native driver animates.
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [clamped, reduced, width]);
  return (
    <View style={[styles.track, { height, borderRadius: height / 2, backgroundColor: track }, style]}>
      <Animated.View
        style={{
          height,
          borderRadius: height / 2,
          backgroundColor: color,
          width: width.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
        }}
      />
    </View>
  );
}

/**
 * The top of a tab screen. The tabs carry their own titles, so the stack header
 * is off up there and this stands in its place — which also means a screen can
 * put something useful beside its name instead of a back arrow it cannot use.
 */
export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
      <View style={{ flex: 1 }}>
        <Text style={type.h1}>{title}</Text>
        {subtitle ? <Text style={type.small}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/**
 * A screen that is only saying something: a missing setting, a failed load, an
 * empty shelf. It exists so those branches keep the safe-area padding that the
 * scrolling version of the same screen gets from its header.
 */
export function ScreenMessage({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screenMessage, { paddingTop: insets.top + space.xl }]}>{children}</View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipOn,
        hovered && !selected && !disabled && styles.chipHover,
        pressed && !disabled && styles.pressed,
        disabled && styles.chipOff,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          selected && styles.chipTextOn,
          disabled && styles.chipTextOff,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A date somebody actually picks.
 *
 * It replaced three chips — "in 1 month", "in 3 months", "in 6 months" — which
 * were never anybody's exam date. The exam is on a published day; rounding it
 * to a month makes the countdown that hangs off it wrong by up to a fortnight,
 * which is the difference between two more weekends of revision and none.
 *
 * On the web this is the browser's own date control, because that is the best
 * picker already on the device and it costs nothing to use. Everywhere else it
 * is a plain YYYY-MM-DD field: a wheel picker means a native module, and one
 * date on one screen does not earn a dependency. Either way the value is only
 * handed up once it is a real day, so a half-typed date never reaches the
 * profile.
 */
export function DateField({
  value,
  onChange,
  placeholder,
  min,
  accessibilityLabel,
}: {
  value: string | null;
  onChange: (date: string | null) => void;
  placeholder: string;
  /** The earliest day worth offering, as YYYY-MM-DD. */
  min?: string;
  accessibilityLabel: string;
}) {
  const [text, setText] = React.useState(value ?? "");
  // Follows the profile when it is loaded or cleared from elsewhere on the
  // screen, without fighting what is being typed here.
  React.useEffect(() => setText(value ?? ""), [value]);

  function commit(next: string) {
    setText(next);
    if (next === "") {
      if (value !== null) onChange(null);
      return;
    }
    if (isIsoDate(next) && next !== value) onChange(next);
  }

  if (Platform.OS === "web") {
    return (
      <input
        type="date"
        value={text}
        min={min}
        aria-label={accessibilityLabel}
        onChange={(e) => commit(e.target.value)}
        style={{
          fontFamily: "inherit",
          fontSize: 16,
          color: colors.text,
          backgroundColor: colors.surfaceAlt,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.md,
          padding: `${space.md}px ${space.lg}px`,
          width: "100%",
          boxSizing: "border-box",
        }}
      />
    );
  }

  return (
    <TextInput
      value={text}
      onChangeText={commit}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      accessibilityLabel={accessibilityLabel}
      autoCapitalize="none"
      autoCorrect={false}
      inputMode="numeric"
      maxLength={10}
      style={styles.dateInput}
    />
  );
}

/**
 * A whole number somebody types, between two bounds.
 *
 * The same shape as DateField and for the same reason: on the web this is the
 * browser's own number control, because it is the best one already on the
 * device, and everywhere else a plain numeric field. The value is handed up
 * only once it is a whole number inside the bounds, so a half-typed "4" on the
 * way to "40" never reaches the profile — and a field left empty or out of
 * range falls back to the last good value when it loses focus rather than
 * saving something nobody meant.
 *
 * There is exactly one of these in the app, on the account screen, and only
 * for an account the database says may size its own day. It is not a difficulty
 * or a level or a type: it is how long a sitting is.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  accessibilityLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  accessibilityLabel: string;
}) {
  const [text, setText] = useState(String(value));
  // Follows the profile when it is loaded or changed from elsewhere, without
  // fighting what is being typed here.
  useEffect(() => setText(String(value)), [value]);

  function parse(next: string): number | null {
    if (!/^\d+$/.test(next)) return null;
    const n = Number(next);
    return n >= min && n <= max ? n : null;
  }

  function commit(next: string) {
    setText(next);
    const n = parse(next);
    if (n !== null && n !== value) onChange(n);
  }

  /** Nothing usable in the box when the cursor leaves: put back what is saved. */
  function settle() {
    if (parse(text) === null) setText(String(value));
  }

  if (Platform.OS === "web") {
    return (
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={1}
        aria-label={accessibilityLabel}
        onChange={(e) => commit(e.target.value)}
        onBlur={settle}
        style={{
          fontFamily: "inherit",
          fontSize: 16,
          color: colors.text,
          backgroundColor: colors.surfaceAlt,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.md,
          padding: `${space.md}px ${space.lg}px`,
          width: "100%",
          boxSizing: "border-box",
        }}
      />
    );
  }

  return (
    <TextInput
      value={text}
      onChangeText={commit}
      onBlur={settle}
      accessibilityLabel={accessibilityLabel}
      inputMode="numeric"
      keyboardType="number-pad"
      maxLength={5}
      style={styles.dateInput}
    />
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
  gradientCard: {
    borderRadius: radius.xl,
    padding: space.xl,
    overflow: "hidden",
    // The fill is the card's own, and the gradient above it is decoration.
    // This card carries two weights of text in colours picked for a violet
    // ground (see theme.ts: "an accent fill that carries text is accentDeep
    // or darker"), and until this line the only thing keeping that rule was
    // an SVG paint server. A browser that drops it — the frame before it
    // rasterises, a composited layer it declines to repaint — left white text
    // and pale violet text on the page's own near-white, which is a hero
    // nobody can read; reported from a phone (2026-09-20). `accentDeep` is
    // the gradient's own light end, so nothing changes when it does paint.
    backgroundColor: colors.accentDeep,
    ...shadow.hero,
  },
  button: {
    borderRadius: radius.pill,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
    alignItems: "center",
    gap: 2,
  },
  buttonRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  buttonPrimary: { backgroundColor: colors.accentDeep, ...shadow.card },
  buttonPrimaryHover: { backgroundColor: colors.accentInk, ...shadow.cardRaised },
  buttonSecondary: { backgroundColor: colors.accentSoft },
  buttonOnAccent: { backgroundColor: colors.onAccent },
  // A pointer over a light button: a shade deeper, not a shadow — the light
  // ones sit flat on purpose, and lifting them would rank them with the
  // primary.
  buttonHover: { opacity: 0.92 },
  buttonLabel: { fontSize: 16, fontWeight: "700", letterSpacing: 0.1 },
  buttonSub: { fontSize: 12, ...tabular },
  pressed: { opacity: 0.85 },
  // Off, not faded: a flat surface inside a hairline, with no shadow to lift
  // it. `muted` on `surfaceAlt` is 4.84:1, so the label is still a label —
  // which is the half that dimming to 45% gives up.
  buttonOff: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  noticeWarn: { backgroundColor: colors.surfaceAlt },
  noticeHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  noticeIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tag: {
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  iconBadge: { alignItems: "center", justifyContent: "center" },
  statCard: {
    flexGrow: 1,
    flexBasis: "46%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: space.lg,
    gap: 2,
    ...shadow.card,
  },
  ringCenter: { alignItems: "center", justifyContent: "center" },
  ringLabel: { fontSize: 20, fontWeight: "700", ...tabular },
  ringCaption: { fontSize: 11, fontWeight: "600" },
  track: { overflow: "hidden" },
  // No horizontal padding: the screen owns its gutter, and a header that added
  // its own would sit a notch further in than the cards under it.
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingBottom: space.xs },
  screenMessage: { flex: 1, paddingHorizontal: space.lg, gap: space.lg },
  chip: {
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    ...shadow.card,
  },
  chipOn: { backgroundColor: colors.accentDeep },
  // Same rule as the button: a chip that is off is drawn flat and grey rather
  // than faded, so nothing on the screen is asked to read through a veil.
  chipOff: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, shadowOpacity: 0, elevation: 0 },
  chipTextOff: { color: colors.muted },
  chipHover: shadow.cardRaised,
  dateInput: {
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  chipText: { fontSize: 14, fontWeight: "700", color: colors.text },
  chipTextOn: { color: colors.onAccent },
  adSlot: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: "center",
  },
});
