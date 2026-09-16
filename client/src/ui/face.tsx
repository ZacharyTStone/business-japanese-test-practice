/**
 * The person you were talking to, and how that landed.
 *
 * A drawn face rather than a colour or a number, because the thing a learner
 * has to feel after 「まだですか」 to a client is not "minus one" — it is the
 * flicker on the other person's face. Five moods, keyed off the same two axes
 * the 失礼度メーター uses: the ruder the answer, the worse the face; a polite
 * miss only puzzles.
 *
 * Abstract on purpose. No skin tone, no gender, no age: it is *whoever* the
 * item says was listening, and the scene drawing already shows the room.
 */
import React from "react";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";

import { roleInfo } from "../lib/roles";
import { colors } from "./theme";

export type Mood = "happy" | "puzzled" | "uneasy" | "upset" | "shocked";

export function moodFor(role: string | null | undefined, isCorrect: boolean): Mood {
  if (isCorrect) return "happy";
  const { rudeness } = roleInfo(role);
  if (rudeness >= 3) return "shocked";
  if (rudeness === 2) return "upset";
  if (rudeness === 1) return "uneasy";
  return "puzzled";
}

const FACE = "#FFE2B8";
const LINE = colors.text;

export function Face({ mood, size = 72 }: { mood: Mood; size?: number }) {
  // Drawn in a 100×100 box and scaled.
  const eyeR = mood === "shocked" ? 6 : 4.2;
  const eyeY = mood === "shocked" ? 42 : 44;

  const brows: string[] =
    mood === "upset"
      ? ["M28 33 L42 38", "M72 33 L58 38"]
      : mood === "shocked"
        ? ["M27 28 Q35 22 43 28", "M57 28 Q65 22 73 28"]
        : mood === "puzzled"
          ? ["M28 34 L42 34", "M57 30 Q65 27 73 32"]
          : mood === "uneasy"
            ? ["M28 33 L42 35", "M58 35 L72 33"]
            : [];

  const mouth =
    mood === "happy"
      ? "M34 62 Q50 78 66 62"
      : mood === "puzzled"
        ? "M38 67 L62 67"
        : mood === "uneasy"
          ? "M38 69 Q50 64 62 69"
          : mood === "upset"
            ? "M36 72 Q50 60 64 72"
            : "";

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel={MOOD_LABEL[mood]}>
      <Circle cx="50" cy="52" r="42" fill={FACE} />
      {brows.map((d, i) => (
        <Path key={i} d={d} stroke={LINE} strokeWidth={4} strokeLinecap="round" fill="none" />
      ))}
      <Circle cx="38" cy={eyeY} r={eyeR} fill={LINE} />
      <Circle cx="62" cy={eyeY} r={eyeR} fill={LINE} />
      {mood === "shocked" ? (
        <Ellipse cx="50" cy="70" rx="8" ry="10" fill={LINE} />
      ) : (
        <Path d={mouth} stroke={LINE} strokeWidth={4.5} strokeLinecap="round" fill="none" />
      )}
      {mood === "upset" || mood === "shocked" ? (
        // A sweat drop: the one cartoon convention every learner of Japanese
        // already reads correctly.
        <Path d="M84 40 Q92 52 84 58 Q76 52 84 40 Z" fill="#7FB3FF" />
      ) : null}
      {mood === "happy" ? (
        <>
          <Circle cx="27" cy="58" r="6" fill="#FFB6A6" opacity={0.7} />
          <Circle cx="73" cy="58" r="6" fill="#FFB6A6" opacity={0.7} />
        </>
      ) : null}
    </Svg>
  );
}

export const MOOD_LABEL: Record<Mood, string> = {
  happy: "相手は満足しています",
  puzzled: "相手は首をかしげています",
  uneasy: "相手は少し困っています",
  upset: "相手は気を悪くしています",
  shocked: "相手は驚いています",
};
