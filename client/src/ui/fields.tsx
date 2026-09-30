/**
 * The two things a learner types a value into: the exam date, and — for the
 * one account that may choose it — the size of a day.
 *
 * On the web each is the browser's own control, drawn with one shared style;
 * everywhere else a plain field drawn with its native twin. Both have the
 * visible edge a field needs (`inputBorder`, 3:1), not a card's hairline.
 */
import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, TextInput } from "react-native";

import { isIsoDate, typedDate } from "../lib/exam";
import { colors, radius, space } from "./theme";

/** The browser's own date and number controls, dressed as the native field. */
const webInput: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: 16,
  color: colors.text,
  backgroundColor: colors.surfaceAlt,
  border: `1px solid ${colors.inputBorder}`,
  borderRadius: radius.md,
  padding: `${space.md}px ${space.lg}px`,
  width: "100%",
  boxSizing: "border-box",
};

/**
 * A date somebody actually picks.
 *
 * The exam is on a published day; rounding it to a month would make the
 * countdown that hangs off it wrong by up to a fortnight, which is the
 * difference between two more weekends of revision and none.
 *
 * On the web this is the browser's own date control, because that is the best
 * picker already on the device and it costs nothing to use. Everywhere else it
 * is a plain YYYY-MM-DD field: a wheel picker means a native module, and one
 * date on one screen does not earn a dependency. That field takes digits on
 * the number pad and writes the hyphens itself (`typedDate`), because the pad
 * has no hyphen key. Either way the value is only handed up once it is a real
 * day, and not before `min`, so a half-typed date never reaches the profile —
 * including the years a browser's field passes through while one is typed
 * into it (0002, 0020, 0202 on the way to 2026).
 */
export function DateField({
  value,
  onChange,
  placeholder,
  min,
  accessibilityLabel,
}: {
  value: string | null;
  onChange: (date: string | null) => void;
  placeholder: string;
  /** The earliest day worth offering, as YYYY-MM-DD. */
  min?: string;
  accessibilityLabel: string;
}) {
  const [text, setText] = React.useState(value ?? "");
  // Follows the profile when it is loaded or cleared from elsewhere on the
  // screen, without fighting what is being typed here.
  React.useEffect(() => setText(value ?? ""), [value]);

  function commit(next: string) {
    setText(next);
    if (next === "") {
      if (value !== null) onChange(null);
      return;
    }
    if (isIsoDate(next) && next !== value && (!min || next >= min)) onChange(next);
  }

  if (Platform.OS === "web") {
    return (
      <input
        type="date"
        value={text}
        min={min}
        aria-label={accessibilityLabel}
        onChange={(e) => commit(e.target.value)}
        style={webInput}
      />
    );
  }

  return (
    <TextInput
      value={text}
      onChangeText={(typed) => commit(typedDate(typed))}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      accessibilityLabel={accessibilityLabel}
      autoCapitalize="none"
      autoCorrect={false}
      inputMode="numeric"
      keyboardType="number-pad"
      maxLength={10}
      style={styles.input}
    />
  );
}

/**
 * A whole number somebody types, between two bounds.
 *
 * The same shape as DateField and for the same reason: on the web this is the
 * browser's own number control, because it is the best one already on the
 * device, and everywhere else a plain numeric field. The value is handed up
 * only when editing ends — the field loses focus, or Enter is pressed — and
 * only if it is a whole number inside the bounds. Saving on every keystroke
 * would store each step on the way — typing "15" saves 1 and then 15, and two
 * writes can land in either order — and some browsers step a focused number
 * box with the mouse wheel. A field left empty or out of range falls back to
 * the last good value instead of saving something nobody meant.
 *
 * There is exactly one of these in the app, on the account screen, and only
 * for an account the database says may size its own day. It is not a difficulty
 * or a level or a type: it is how long a sitting is.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  accessibilityLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  accessibilityLabel: string;
}) {
  const [text, setText] = useState(String(value));
  // Follows the profile when it is loaded or changed from elsewhere, without
  // fighting what is being typed here.
  useEffect(() => setText(String(value)), [value]);

  function parse(next: string): number | null {
    if (!/^\d+$/.test(next)) return null;
    const n = Number(next);
    return n >= min && n <= max ? n : null;
  }

  /** Editing is over: save a usable number, or put back what is saved. */
  function settle() {
    const n = parse(text);
    if (n === null) setText(String(value));
    else if (n !== value) onChange(n);
  }

  if (Platform.OS === "web") {
    return (
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={1}
        aria-label={accessibilityLabel}
        onChange={(e) => setText(e.target.value)}
        onBlur={settle}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        // Some browsers step a focused number box with the wheel; let it
        // scroll the page instead.
        onWheel={(e) => e.currentTarget.blur()}
        style={webInput}
      />
    );
  }

  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onBlur={settle}
      onSubmitEditing={settle}
      accessibilityLabel={accessibilityLabel}
      inputMode="numeric"
      keyboardType="number-pad"
      maxLength={5}
      style={styles.input}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
});
