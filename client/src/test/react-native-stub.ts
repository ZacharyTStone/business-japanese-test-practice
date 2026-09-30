/**
 * React Native, for unit tests: just enough of it for a module under src/ui
 * to be imported in Node.
 *
 * What a test reads from such a module is the plain part of it — the words a
 * chart says aloud, how much taller a bar gets for larger text — and never a
 * rendered view. So styles are what they were written as (`create` is the
 * identity), the platform is the web, every component draws nothing, and the
 * hooks answer with a phone-sized window at the default text size. Anything a
 * test needs beyond that belongs in a module that does not import this at all.
 */
import type { ReactNode } from "react";

type Styles = Record<string, unknown>;

const Nothing = (_props: { children?: ReactNode }) => null;

export const StyleSheet = {
  create: <T extends Styles>(styles: T): T => styles,
  flatten: (style: unknown): Styles =>
    Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).filter(Boolean)) : ((style as Styles) ?? {}),
  hairlineWidth: 1,
  absoluteFill: {},
  absoluteFillObject: {},
};

export const Platform = {
  OS: "web" as const,
  select: <T>(options: { web?: T; default?: T }) => ("web" in options ? options.web : options.default),
};

export const View = Nothing;
export const Text = Nothing;
export const Pressable = Nothing;
export const ScrollView = Nothing;
export const TextInput = Nothing;
export const Image = Nothing;
export const ActivityIndicator = Nothing;

class AnimatedValue {
  constructor(public value: number) {}
  interpolate() {
    return this;
  }
}

export const Animated = {
  View: Nothing,
  Value: AnimatedValue,
  timing: () => ({ start() {}, stop() {} }),
};

export const Easing = {
  out: (f: (t: number) => number) => f,
  quad: (t: number) => t * t,
  cubic: (t: number) => t * t * t,
};

export const AppState = { addEventListener: () => ({ remove() {} }) };

export const AccessibilityInfo = {
  isReduceMotionEnabled: async () => false,
  addEventListener: () => ({ remove() {} }),
};

export const useWindowDimensions = () => ({ width: 375, height: 812, scale: 2, fontScale: 1 });

export default {
  StyleSheet,
  Platform,
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Image,
  ActivityIndicator,
  Animated,
  Easing,
  AppState,
  AccessibilityInfo,
  useWindowDimensions,
};
