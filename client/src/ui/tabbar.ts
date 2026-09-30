/**
 * The tab bar's size on this device.
 *
 * A fixed height is wrong on most phones: an iPhone without a home button
 * keeps the bottom 34pt for its home indicator, an Android phone with gesture
 * navigation keeps a strip of its own, and the bar has to stand on top of
 * that, not under it. The bar draws its own inset only when nobody gives it a
 * height, and it has been given one, so the inset is added here — once, for
 * the bar and for the screens that leave room under their last card for it.
 */
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_BAR_HEIGHT, TAB_BREATHING } from "./theme";

/** The bar's height here: its own, and the strip beneath it that the system owns. */
export function useTabBarHeight(): { height: number; inset: number } {
  const insets = useSafeAreaInsets();
  return { height: TAB_BAR_HEIGHT + insets.bottom, inset: insets.bottom };
}

/** What a tab screen leaves under its last card, so nothing ends under the bar. */
export function useTabClearance(): number {
  return useTabBarHeight().height + TAB_BREATHING;
}
