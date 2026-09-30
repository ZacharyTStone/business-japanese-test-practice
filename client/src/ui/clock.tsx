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
 * Three decisions worth stating:
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

import { clockFace, clockFor, newClock, pause, resume, tick, URGENT_AT, WARN_AT, type Clock } from "../lib/clock";
import { useLang } from "../lib/i18n";
import { colors, radius, space, tabular, type } from "./theme";

/** How often the number is redrawn. Four times a second is smooth enough that
 *  the seconds tick over on time, and rare enough to cost nothing. */
const TICK_MS = 250;

function barColor(share: number): string {
  if (share <= URGENT_AT) return colors.wrong;
  if (share <= WARN_AT) return colors.warn;
  return colors.accent;
}

/**
 * A countdown from `seconds`, restarted whenever `runKey` changes.
 *
 * `running` false holds the clock at its current reading rather than resetting
 * it — that is what an answered question needs, so the learner can see what
 * they had left. `onExpire` fires exactly once per run.
 *
 * The practice screen also keys this by the item, so a new question is a new
 * component; the clock value (src/lib/clock.ts) makes the same promise on its
 * own, so neither half depends on the other being remembered.
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
  // The clock lives in a ref, not in state: the interval reads and writes it
  // between renders, and a value that only lands on the next render is the
  // stale reading that once carried one question's time into the next. The
  // state below is only what is drawn.
  const clock = useRef<Clock>(newClock(runKey, totalMs));
  const [remaining, setRemaining] = useState(totalMs);

  // Held in a ref rather than taken as a dependency below. The parent rebuilds
  // its handler on every render — it closes over the current question — and an
  // interval that restarted with it would restart four times a second. The ref
  // means the clock does not care how stable the callback is.
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  });

  // One effect for the whole life of a run: a new question (or budget) is a new
  // clock at the full budget, then it counts while `running` and is held,
  // reading what was left, when it stops.
  useEffect(() => {
    const current = clockFor(clock.current, runKey, totalMs);
    clock.current = current;
    setRemaining(current.remainingMs);
    if (!running) return;
    clock.current = resume(current, Date.now());
    const id = setInterval(() => {
      const read = tick(clock.current, Date.now());
      clock.current = read.clock;
      setRemaining(read.clock.remainingMs);
      if (read.expired) expire.current();
    }, TICK_MS);
    return () => {
      clearInterval(id);
      clock.current = pause(clock.current, Date.now());
      setRemaining(clock.current.remainingMs);
    };
  }, [running, runKey, totalMs]);

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
