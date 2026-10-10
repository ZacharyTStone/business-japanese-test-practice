/**
 * A ref that always holds the value from the last committed render.
 *
 * For a handler or a list that is rebuilt on every render but read later — by
 * a listener, a timer, another player — where taking it as a dependency would
 * restart the thing reading it. Written in a layout effect rather than during
 * render, so a render React throws away never leaves its value behind, and
 * still before any effect of the same commit reads it.
 *
 * The ref is the same object for the life of the component, so listing it as
 * a dependency never re-runs anything.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";

export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
