/**
 * The little that moves, and the switch that stops it.
 *
 * Three things animate in this app: a card arriving, a ring or a bar reaching
 * its value, and a button answering a press. Each is short, eased out, and
 * says the same thing — *this changed, and here is where it went* — which is
 * the only reason to move anything on a screen somebody is reading on a train.
 * Nothing loops, nothing bounces, nothing waits to be watched.
 *
 * All of it goes through `useReducedMotion`. A person who has asked the OS to
 * hold still gets the end state at once: the card is simply there, the ring
 * is simply full. That is the same screen, one frame sooner.
 */
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, type ViewProps } from "react-native";

import { motion } from "./theme";

/** Whether the OS has been asked for less motion. Read once, then followed. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (live) setReduced(on);
      })
      .catch(() => {
        // Unknown means "move": the default the person has not changed.
      });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

// The native animated module is a native module; on the web the flag only
// earns a console warning, so it is asked for where it exists.
const NATIVE = Platform.OS !== "web";

/**
 * Something arriving: a short rise into place as it fades in.
 *
 * Wrap the thing that has just appeared — a stage of a question, a verdict,
 * a hero — and give it a `key` that changes when the content does, so the
 * next thing arrives the same way. `delay` staggers a list; three cards
 * landing sixty milliseconds apart read as a sequence rather than a slab.
 */
export function FadeIn({
  children,
  style,
  delay = 0,
  distance = 10,
  ...rest
}: ViewProps & {
  delay?: number;
  /** How far below its place it starts, in points. Zero is a plain fade. */
  distance?: number;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: motion.enter,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    });
    anim.start();
    return () => anim.stop();
    // Runs once per mount: a change of `delay` after that is not a reason to
    // play the entrance again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
          ],
        },
      ]}
      {...rest}
    >
      {children}
    </Animated.View>
  );
}

/**
 * A number on its way to `target`.
 *
 * For a ring or a bar drawn with SVG, whose stroke is a prop and not a style
 * an `Animated.Value` can drive. It re-renders the caller a few dozen times
 * over `duration`, which is fine for a ring and would not be for a list.
 * With `from` set, the first value shown is that rather than the target — a
 * result ring that starts empty and fills is the whole point of a result
 * ring.
 */
export function useTween(target: number, opts: { from?: number; duration?: number } = {}): number {
  const reduced = useReducedMotion();
  const duration = opts.duration ?? motion.fill;
  const [value, setValue] = useState(opts.from ?? target);
  // Where the last frame left off, so a new target picks up from wherever the
  // number visibly is rather than from where the previous run meant to end.
  const shown = useRef(opts.from ?? target);

  useEffect(() => {
    if (reduced) {
      shown.current = target;
      setValue(target);
      return;
    }
    const start = shown.current;
    if (start === target) return;
    const t0 = Date.now();
    let frame = 0;
    const step = () => {
      const p = Math.min(1, (Date.now() - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      shown.current = start + (target - start) * eased;
      setValue(shown.current);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced, duration]);

  return reduced ? target : value;
}

/**
 * The press of a button, as a scale the finger can feel.
 *
 * Returns the transform to put on the button's face and the two handlers to
 * wire to the Pressable around it. Down is quick and small — three percent,
 * about what a real key gives — and up springs back, which is what makes it
 * read as a press rather than a flicker.
 */
export function usePressScale() {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const down = () => {
    if (reduced) return;
    Animated.timing(scale, {
      toValue: 0.97,
      duration: motion.press,
      easing: Easing.out(Easing.quad),
      useNativeDriver: NATIVE,
    }).start();
  };
  const up = () => {
    if (reduced) return;
    Animated.spring(scale, {
      toValue: 1,
      speed: 40,
      bounciness: 6,
      useNativeDriver: NATIVE,
    }).start();
  };
  return { style: { transform: [{ scale }] }, onPressIn: down, onPressOut: up };
}
