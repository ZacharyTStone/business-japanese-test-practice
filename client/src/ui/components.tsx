/**
 * The handful of pieces every screen uses.
 */
import React from "react";
import {
  ActivityIndicator,
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
import { badge, card, colors, radius, shadow, space, type } from "./theme";
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
  return (
    <View style={[styles.gradientCard, style]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="heroFill" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.accent} />
            <Stop offset="1" stopColor={colors.accentDeep} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroFill)" />
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
  const labelColor =
    tone === "primary" ? colors.onAccent : tone === "onAccent" ? colors.accentDeep : colors.accent;
  const subColor = tone === "primary" ? colors.onAccentMuted : colors.muted;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        tone === "primary" && styles.buttonPrimary,
        tone === "secondary" && styles.buttonSecondary,
        tone === "onAccent" && styles.buttonOnAccent,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.buttonRow}>
        {icon ? <Icon name={icon} size={18} color={labelColor} strokeWidth={2} /> : null}
        <Text style={[styles.buttonLabel, { color: labelColor }]}>{label}</Text>
      </View>
      {sub ? <Text style={[styles.buttonSub, { color: subColor }]}>{sub}</Text> : null}
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
  /** What the ring means in words. Without it a screen reader reads "3 / 5" and
   *  "today" as two loose fragments with a circle between them. */
  accessibilityLabel?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
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
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.ringCenter]}>
        <Text style={[styles.ringLabel, { color: labelColor }]}>{label}</Text>
        {caption ? <Text style={[styles.ringCaption, { color: labelColor }]}>{caption}</Text> : null}
      </View>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipOn,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
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
  buttonPrimary: { backgroundColor: colors.accent, ...shadow.card },
  buttonSecondary: { backgroundColor: colors.accentSoft },
  buttonOnAccent: { backgroundColor: colors.onAccent },
  buttonLabel: { fontSize: 16, fontWeight: "700" },
  buttonSub: { fontSize: 12 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },
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
    padding: space.lg,
    gap: 2,
    ...shadow.card,
  },
  ringCenter: { alignItems: "center", justifyContent: "center" },
  ringLabel: { fontSize: 20, fontWeight: "700" },
  ringCaption: { fontSize: 11, opacity: 0.85 },
  // No horizontal padding: the screen owns its gutter, and a header that added
  // its own would sit a notch further in than the cards under it.
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingBottom: space.xs },
  screenMessage: { flex: 1, paddingHorizontal: space.lg, gap: space.lg },
  chip: {
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  chipOn: { backgroundColor: colors.accent },
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
