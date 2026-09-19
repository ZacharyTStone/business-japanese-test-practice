/**
 * The question clock — the one thing on this screen that is about the exam
 * rather than about the Japanese.
 *
 * The reading section of the BJT is self-paced inside a fixed block: nobody
 * tells you to move on, and the usual way to lose marks is to spend four
 * minutes on a 総合読解 passage and then meet the last six questions with two
 * minutes left. A practice app that lets a person sit on one question for as
 * long as they like teaches the reading and not the pacing, so this counts the
 * seconds that question would be allowed in the exam and stops when they are
 * gone (see `src/lib/pace.ts` for where the number comes from).
 *
 * Three decisions worth stating, because all three were the other way first:
 *
 * **It counts against a deadline, not against ticks.** A phone that sleeps, a
 * browser tab in the background, a slow render — every one of them drops
 * intervals, and a clock that subtracts 200ms per tick would quietly give a
 * backgrounded learner more time than the exam does. The deadline is a
 * timestamp; the tick only decides how often the number is redrawn.
 *
 * **It never animates.** `ProgressBar` eases to its value over 640ms, which is
 * right for a figure that has changed and wrong for one that is changing: a
 * countdown drawn that way is always a little behind itself, and at the end it
 * is still sliding when the time is up. This draws the width it has.
 *
 * **Running out is not a failure state to be shouted about.** The bar warms to
 * amber and then red, the number keeps counting, and that is all — no flashing
 * and no noise. Somebody is reading Japanese; the clock is furniture.
 */
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useLang } from "../lib/i18n";
import { colors, radius, space, tabular, type } from "./theme";

/** How often the number is redrawn. Four times a second is smooth enough that
 *  the seconds tick over on time, and rare enough to cost nothing. */
const TICK_MS = 250;

/** Below this share of the budget the bar goes amber, and below the second it
 *  goes red. Roughly "a quarter left" and "nearly gone", which is what a person
 *  glancing at it needs to know. */
const WARN_AT = 0.25;
const URGENT_AT = 0.1;

function barColor(share: number): string {
  if (share <= URGENT_AT) return colors.wrong;
  if (share <= WARN_AT) return colors.warn;
  return colors.accent;
}

/** mm:ss, floored at zero. Seconds are rounded UP so the clock reads 1:00 for
 *  the whole first second rather than flicking to 0:59 immediately. */
export function clockFace(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * A countdown from `seconds`, restarted whenever `runKey` changes.
 *
 * `running` false holds the clock at its current reading rather than resetting
 * it — that is what an answered question needs, so the learner can see what
 * they had left. `onExpire` fires exactly once per run.
 */
export function QuestionClock({
  seconds,
  running,
  runKey,
  onExpire,
}: {
  seconds: number;
  running: boolean;
  /** Changing this starts a new countdown. The item id, in practice. */
  runKey: string;
  onExpire: () => void;
}) {
  const { t } = useLang();
  const totalMs = Math.max(1, seconds) * 1000;
  const deadline = useRef(Date.now() + totalMs);
  const fired = useRef(false);
  const [remaining, setRemaining] = useState(totalMs);

  // Held in a ref rather than taken as a dependency below. The parent rebuilds
  // its handler on every render — it closes over the current question — and an
  // interval that restarted with it would rebuild the deadline from a rounded
  // reading four times a second, which is the drift this design exists to
  // avoid. The ref means the clock does not care how stable the callback is.
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  });

  // A new question is a new clock. Done in an effect rather than during render
  // because it resets two refs as well as the state, and it is declared before
  // the interval below so that a new question is reset before it is counted.
  useEffect(() => {
    deadline.current = Date.now() + totalMs;
    fired.current = false;
    setRemaining(totalMs);
  }, [runKey, totalMs]);

  useEffect(() => {
    if (!running) return;
    // The deadline moves with the pause: time spent not running is not spent.
    deadline.current = Date.now() + remaining;
    const id = setInterval(() => {
      const left = deadline.current - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0 && !fired.current) {
        fired.current = true;
        expire.current();
      }
    }, TICK_MS);
    return () => clearInterval(id);
    // `remaining` is read once, when the clock starts or resumes, and is not a
    // dependency: it changes on every tick, and restarting the interval for
    // each one is exactly the drift described above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, runKey]);

  const share = remaining / totalMs;
  const out = remaining <= 0;

  return (
    <View
      style={styles.row}
      accessible
      // Not a live region: a screen reader announcing a new number every second
      // would make the question unreadable. It is here to be asked, not to
      // interrupt — and `t("time_up")` is announced by the verdict card, which
      // is a live region, at the moment it actually matters.
      accessibilityLabel={
        out ? t("time_up") : t("time_left", { time: clockFace(remaining) })
      }
    >
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${Math.max(0, Math.min(1, share)) * 100}%`, backgroundColor: barColor(share) },
          ]}
        />
      </View>
      <Text
        style={[type.small, tabular, styles.face, out && { color: colors.wrong, fontWeight: "700" }]}
      >
        {clockFace(remaining)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  track: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  fill: { height: 6, borderRadius: radius.pill },
  // Wide enough for "10:00" so the row does not shuffle as the digits change.
  face: { minWidth: 42, textAlign: "right" },
});
