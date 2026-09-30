/**
 * Keeping a screen about today about today.
 *
 * Home is read when it comes into focus, and that is not enough: a phone left
 * on home overnight, or a browser tab left open on it, is never re-focused,
 * and the next morning it still says the day is done — with the one button
 * that would help missing, because a finished day has none. So home also
 * reads again when the app or the tab comes back to the front, if the day has
 * turned over in Japan since or the numbers are simply old (`shouldRefresh`),
 * and at midnight in Japan itself while it is on screen.
 */
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { nextJstMidnight, shouldRefresh } from "../lib/day";

/** A second past midnight, so the database has turned over by the time it is asked. */
const PAST_MIDNIGHT_MS = 1000;

export function useFreshToday(loadedAt: number | null, reload: () => void) {
  const latest = useRef({ loadedAt, reload });
  latest.current = { loadedAt, reload };

  // Coming back: the app to the foreground on a phone, the tab to the front
  // in a browser. AppState does not say either on the web, where a hidden tab
  // is still "active".
  useEffect(() => {
    const back = () => {
      const { loadedAt: at, reload: again } = latest.current;
      if (at !== null && shouldRefresh(at, Date.now())) again();
    };
    if (Platform.OS === "web") {
      if (typeof document === "undefined") return;
      const onVisibility = () => {
        if (document.visibilityState === "visible") back();
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => document.removeEventListener("visibilitychange", onVisibility);
    }
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") back();
    });
    return () => sub.remove();
  }, []);

  // Midnight in Japan, while the screen is in front. A phone in the
  // background does not run the timer; coming back, above, covers that.
  useFocusEffect(
    useCallback(() => {
      if (loadedAt === null) return;
      const now = Date.now();
      const timer = setTimeout(() => latest.current.reload(), nextJstMidnight(now) - now + PAST_MIDNIGHT_MS);
      return () => clearTimeout(timer);
    }, [loadedAt])
  );
}
