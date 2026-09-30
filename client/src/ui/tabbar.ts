/**
 * The tab bar's size on this device.
 *
 * A fixed height is wrong on most phones: an iPhone without a home button
 * keeps the bottom 34pt for its home indicator, an Android phone with gesture
 * navigation keeps a strip of its own, and the bar has to stand on top of
 * that, not under it. The bar draws its own inset only when nobody gives it a
 * height, and it has been given one, so the inset is added here — once, for
 * the bar and for the screens that leave room under their last card for it.
 *
 * And a fixed height is wrong for somebody who has asked the phone for larger
 * text: the labels grow with the system font size, and a bar that does not
 * grow with them clips them. The navigator takes a height it is given as the
 * height — a `minHeight` beside it is never the larger of the two — so the
 * growth is worked out here too, a label line's worth per step of scale.
 */
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_BAR_HEIGHT, TAB_BREATHING } from "./theme";

/** The tab labels' size and line, which `app/(tabs)/_layout.tsx` draws them at. */
export const TAB_LABEL = { fontSize: 12, lineHeight: 16 } as const;

/** Extra height for labels drawn larger than their size: nothing at the
 *  default scale, a line's worth per step above it. Never shrinks the bar. */
export function labelGrowth(fontScale: number): number {
  return Math.max(0, Math.ceil(TAB_LABEL.lineHeight * (fontScale - 1)));
}

/** The bar's height here: its own, room for larger labels, and the strip
 *  beneath it that the system owns. */
export function useTabBarHeight(): { height: number; inset: number } {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  return { height: TAB_BAR_HEIGHT + labelGrowth(fontScale) + insets.bottom, inset: insets.bottom };
}

/** What a tab screen leaves under its last card, so nothing ends under the bar. */
export function useTabClearance(): number {
  return useTabBarHeight().height + TAB_BREATHING;
}
