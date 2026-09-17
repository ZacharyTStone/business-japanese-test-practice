/**
 * The icon set, drawn rather than installed.
 *
 * A dozen line icons is not worth a font dependency: an icon font ships every
 * glyph in the family to load four of them, and the two RN icon packages both
 * want a native asset step that the web export does not need. These are stroked
 * paths on a 24-grid, so they inherit colour and size from the caller and stay
 * sharp wherever they land.
 *
 * Every icon here is decorative. Anything an icon labels also carries the word
 * next to it, so nothing is lost when a screen reader skips the drawing.
 */
import React from "react";
import Svg, { Path } from "react-native-svg";

import { colors } from "./theme";

const PATHS = {
  home: ["M3 10.7 12 3.5l9 7.2", "M5.8 9.6V20h12.4V9.6"],
  grid: ["M4.5 4.5h5.5v5.5H4.5z", "M14 4.5h5.5v5.5H14z", "M4.5 14h5.5v5.5H4.5z", "M14 14h5.5v5.5H14z"],
  chart: ["M3.5 20.5h17", "M7 20.5v-5.5", "M12 20.5V9", "M17 20.5v-8"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8", "M4.5 20.5c1.3-3.8 4-5.7 7.5-5.7s6.2 1.9 7.5 5.7"],
  flame: [
    "M12 3.4c.4 2.3-.9 3.6-2.2 4.9-1.5 1.4-2.7 2.8-2.7 5.1a4.9 4.9 0 0 0 9.8 0c0-1.7-.6-3.1-1.6-4.4-.5.8-1.1 1.2-1.9 1.4.5-2.4-.3-4.9-1.4-7z",
  ],
  check: ["M4.8 12.6l4.9 4.9L19.2 6.8"],
  target: [
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
    "M12 16.6a4.6 4.6 0 1 0 0-9.2 4.6 4.6 0 0 0 0 9.2",
    "M12 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4",
  ],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 7.2v5.2l3.4 2"],
  book: [
    "M12 7.6C10.5 6.1 8.4 5.3 5 5.3V18c3.4 0 5.5.8 7 2.3",
    "M12 7.6c1.5-1.5 3.6-2.3 7-2.3V18c-3.4 0-5.5.8-7 2.3",
    "M12 7.6v12.7",
  ],
  headphones: [
    "M4.2 14.5v-2.3a7.8 7.8 0 0 1 15.6 0v2.3",
    "M4.2 14.2h2.3a1.5 1.5 0 0 1 1.5 1.5v2.1a1.5 1.5 0 0 1-1.5 1.5H6a1.8 1.8 0 0 1-1.8-1.8z",
    "M19.8 14.2h-2.3a1.5 1.5 0 0 0-1.5 1.5v2.1a1.5 1.5 0 0 0 1.5 1.5h.5a1.8 1.8 0 0 0 1.8-1.8z",
  ],
  doc: ["M6.2 3.6h7.4L18.8 9v11.4H6.2z", "M13.6 3.6V9h5.2", "M9.2 13h6.4", "M9.2 16.4h6.4"],
  layers: ["M12 3.6 3.6 8 12 12.4 20.4 8z", "M3.6 12.4 12 16.8l8.4-4.4", "M3.6 16.4 12 20.8l8.4-4.4"],
  chevron: ["M9.5 5.5 16 12l-6.5 6.5"],
  chevronLeft: ["M14.5 5.5 8 12l6.5 6.5"],
  play: ["M8.4 5.6v12.8L18.8 12z"],
  stop: ["M7.2 7.2h9.6v9.6H7.2z"],
  alert: ["M12 4.4 20.8 19.6H3.2z", "M12 10v4.3", "M12 17.2v.2"],
  spark: ["M12 3.4 13.8 9 19.4 10.8 13.8 12.6 12 18.2 10.2 12.6 4.6 10.8 10.2 9z"],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 22,
  color = colors.text,
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {PATHS[name].map((d, i) => (
        <Path
          key={i}
          d={d}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
