/**
 * The few styles the practice screen's parts share.
 */
import { StyleSheet } from "react-native";

import { ANSWER_COLUMN_WIDTH, MIN_TOUCH, space, SPLIT_MAX_WIDTH } from "../theme";

export const shared = StyleSheet.create({
  page: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  hint: { textAlign: "center" },
  toggle: { textAlign: "center", textDecorationLine: "underline" },
  // A line of text that is a button still has to be a thumb's height: the
  // padding is the hit area, since hitSlop does nothing on the web.
  link: { minHeight: MIN_TOUCH, justifyContent: "center" },
  // The split layout (a wide window): the counter across the top, then what
  // you read and hear beside what you answer, each column scrolling by itself.
  split: {
    flex: 1,
    width: "100%",
    maxWidth: SPLIT_MAX_WIDTH + 2 * space.lg,
    alignSelf: "center",
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    gap: space.lg,
  },
  columns: { flex: 1, flexDirection: "row", gap: space.xl },
  readColumn: { flex: 1 },
  answerColumn: { width: ANSWER_COLUMN_WIDTH, flexGrow: 0, flexShrink: 0 },
  column: { gap: space.lg, paddingBottom: space.xxl },
});
