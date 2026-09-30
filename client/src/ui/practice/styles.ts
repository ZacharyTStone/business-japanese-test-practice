/**
 * The few styles the practice screen's parts share.
 */
import { StyleSheet } from "react-native";

import { MIN_TOUCH, space } from "../theme";

export const shared = StyleSheet.create({
  page: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  hint: { textAlign: "center" },
  toggle: { textAlign: "center", textDecorationLine: "underline" },
  // A line of text that is a button still has to be a thumb's height: the
  // padding is the hit area, since hitSlop does nothing on the web.
  link: { minHeight: MIN_TOUCH, justifyContent: "center" },
});
