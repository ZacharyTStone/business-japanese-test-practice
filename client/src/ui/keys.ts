/**
 * Answering with the keyboard, on the one platform that has one.
 *
 * The app is one codebase for three platforms, and on the web it is a drill
 * somebody does at a desk between two other tabs. Reaching for the mouse four
 * times a question is the difference between a set of five taking two minutes
 * and taking five, and a drill that is slower than it needs to be is a drill
 * people stop doing. On a phone there is no keyboard and this compiles to
 * nothing.
 *
 * The handler returns `false` for a key it did not use, and that is the whole
 * contract: anything it did not use keeps its normal behaviour, so Tab still
 * moves focus and the browser's own shortcuts still work. Swallowing every key
 * because four of them are interesting is how a web page stops being a web page.
 */
import { useEffect, useRef } from "react";
import { Platform } from "react-native";

/** True where a physical keyboard is the normal way to use the app. */
export const HAS_KEYBOARD = Platform.OS === "web";

/**
 * Call `handler` on every key press, unless the person is typing into something.
 *
 * The handler is kept in a ref so the listener is attached once rather than on
 * every render — a screen that re-renders on each tick of an audio player would
 * otherwise add and remove a listener thirty times a second.
 */
export function useKeys(handler: (key: string) => boolean | void, enabled = true): void {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!HAS_KEYBOARD || !enabled) return;
    if (typeof document === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      // A shortcut with a modifier belongs to the browser or the OS.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (latest.current(event.key) !== false) event.preventDefault();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/**
 * Which option a key press means, or -1.
 *
 * Both rows, because people reach for whichever is nearer: the digits printed
 * on the options themselves, and the letters the options used to carry.
 */
export function optionForKey(key: string, count: number): number {
  const k = key.toLowerCase();
  const digit = "1234".indexOf(k);
  const letter = "abcd".indexOf(k);
  const index = digit >= 0 ? digit : letter;
  return index >= 0 && index < count ? index : -1;
}
