/**
 * Furigana, drawn with React Native primitives.
 *
 * There is no <ruby> in React Native, so a line with readings is laid out as a
 * wrapping row of cells: a reading (or an empty line of the same height) over
 * its text. Bare text is split into one cell per character so the line still
 * wraps where Japanese wraps. Without readings the line is one ordinary Text,
 * which is cheaper and wraps natively — which is why the toggle is worth
 * having for a long list.
 */
import React from "react";
import { StyleSheet, Text, type TextStyle, View } from "react-native";

import type { RubySegment } from "../lib/words";
import { colors } from "./theme";

export function RubyText({
  segments,
  show,
  style,
}: {
  segments: RubySegment[];
  show: boolean;
  style: TextStyle;
}) {
  const plain = segments.map((s) => s.text).join("");
  if (!show || !segments.some((s) => s.ruby)) return <Text style={style}>{plain}</Text>;

  // Half the text's size, but never below 11: a reading is there to be read,
  // and at 9 a kana's strokes run together.
  const size = Math.max(11, Math.round((style.fontSize ?? 16) * 0.5));
  const rubyStyle = [styles.ruby, { fontSize: size, lineHeight: size + 3 }];
  const cells: React.ReactNode[] = [];
  segments.forEach((seg, i) => {
    if (seg.ruby) {
      cells.push(
        <View key={i} style={styles.cell}>
          <Text style={rubyStyle}>{seg.ruby}</Text>
          <Text style={[style, styles.tight]}>{seg.text}</Text>
        </View>
      );
    } else {
      [...seg.text].forEach((ch, j) =>
        cells.push(
          <View key={`${i}.${j}`} style={styles.cell}>
            <Text style={rubyStyle}> </Text>
            <Text style={[style, styles.tight]}>{ch}</Text>
          </View>
        )
      );
    }
  });
  return (
    <View style={styles.line} accessible accessibilityLabel={plain}>
      {cells}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" },
  cell: { alignItems: "center" },
  // In the text's own colour: the grey used for small print loses too much
  // contrast at this size.
  ruby: { color: colors.text },
  tight: { marginTop: -2 },
});
