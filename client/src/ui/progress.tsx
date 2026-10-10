/**
 * How far along something finite is: a ring for today's goal, a bar for a
 * set's progress or an accuracy laid beside others of its kind.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { useReducedMotion, useTween } from "./motion";
import { colors, motion, tabular } from "./theme";

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
  /** The caption is the quiet half of the ring: the same token as every other
   *  quiet line on an accent fill, rather than the label faded, so a contrast
   *  check can see it and it moves when that one does. */
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

const styles = StyleSheet.create({
  ringCenter: { alignItems: "center", justifyContent: "center" },
  ringLabel: { fontSize: 20, fontWeight: "700", ...tabular },
  ringCaption: { fontSize: 11, fontWeight: "600" },
  track: { overflow: "hidden" },
});
