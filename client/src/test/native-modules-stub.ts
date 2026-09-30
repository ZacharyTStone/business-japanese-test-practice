/**
 * The two native-backed libraries src/ui draws with — react-native-svg and
 * react-native-safe-area-context — for unit tests in Node. Same rule as the
 * React Native stub beside it: components draw nothing, hooks answer as a
 * phone with no notch would.
 */
import type { ReactNode } from "react";

const Nothing = (_props: { children?: ReactNode }) => null;

// react-native-svg
export default Nothing;
export const Svg = Nothing;
export const Circle = Nothing;
export const Line = Nothing;
export const Polygon = Nothing;
export const Polyline = Nothing;
export const Path = Nothing;
export const Rect = Nothing;
export const Text = Nothing;
export const G = Nothing;
export const Defs = Nothing;
export const LinearGradient = Nothing;
export const Stop = Nothing;

// react-native-safe-area-context
export const SafeAreaProvider = Nothing;
export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
