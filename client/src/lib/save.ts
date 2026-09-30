/**
 * One setting, saved one write at a time.
 *
 * A setting on the account screen answers a press at once — the chip lights,
 * the date changes — and the write follows. Two things go wrong with the
 * obvious version of that. Two presses close together make two writes, which
 * can land in either order, so the database can end up holding the one that
 * was pressed first. And a write that fails leaves the screen showing a value
 * the database never took, which the learner has no reason to doubt.
 *
 * So there is never more than one write in flight: a press made while one is
 * out is held, and only the newest held value is written next — the last
 * press is the one that counts, and nothing in between is sent. A write that
 * fails puts the screen back to the last value the database confirmed, drops
 * anything held behind it, and says why.
 *
 * Plain functions, no React, so `npm test` can drive it with promises it
 * resolves by hand.
 */
export type SettingSaver<T> = {
  /** The value the database holds, as just read from it. */
  confirm: (value: T) => void;
  /** A press: shown at once, written when nothing else is being written. */
  set: (value: T) => void;
  /** Whether a write is out. */
  busy: () => boolean;
};

export function settingSaver<T>(hooks: {
  write: (value: T) => Promise<void>;
  /** Put a value on screen. */
  show: (value: T) => void;
  /** A value the database took. */
  saved?: (value: T) => void;
  /** A write that failed; the screen is already back on the confirmed value. */
  failed: (error: unknown) => void;
}): SettingSaver<T> {
  let confirmed: { value: T } | null = null;
  let inFlight = false;
  let held: { value: T } | null = null;

  function run(value: T) {
    inFlight = true;
    hooks.write(value).then(
      () => {
        inFlight = false;
        confirmed = { value };
        hooks.saved?.(value);
        const next = held;
        held = null;
        if (next && !Object.is(next.value, value)) run(next.value);
      },
      (error: unknown) => {
        inFlight = false;
        held = null;
        if (confirmed) hooks.show(confirmed.value);
        hooks.failed(error);
      }
    );
  }

  return {
    confirm(value) {
      confirmed = { value };
    },
    set(value) {
      hooks.show(value);
      if (inFlight) held = { value };
      else if (!confirmed || !Object.is(confirmed.value, value)) run(value);
    },
    busy: () => inFlight,
  };
}
