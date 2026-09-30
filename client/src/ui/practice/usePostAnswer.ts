/**
 * Posting an answer, and what becomes of it.
 *
 * **Correctness comes back from the insert.** The item carries `correct_index`,
 * so the screen could grade locally and feel a few hundred milliseconds faster —
 * but then the app's opinion and the database's could drift apart, and the
 * database's is the one the weakness profile is built on. The round trip is the
 * price of those two never disagreeing. When it cannot be made, the card shows
 * the phone's reading of the key marked unsent, and the insert itself — never a
 * grade — waits in the outbox (src/lib/outbox.ts) until it can be.
 */
import { useEffect, useState, type Dispatch, type RefObject } from "react";
import { AppState, Platform, Vibration } from "react-native";

import { flushAnswers, sendAnswer, type AttemptArgs, type FlushResult, type SendOutcome } from "../../lib/answers";
import { clipUrl } from "../../lib/db";
import { friendlyError } from "../../lib/errors";
import { useLang } from "../../lib/i18n";
import type { TypePace } from "../../lib/pace";
import { playlistFor } from "../../lib/playlist";
import { thinkTime, type PracticeAction, type PracticeState } from "../../lib/practice";
import { NO_ANSWER, type QueuedItem } from "../../lib/types";

/** An answer the database answered with an error — not a lost connection,
 *  which the outbox deals with by itself. Kept with the insert, so the card can
 *  offer to send exactly that again. */
export type SendError = {
  itemId: string;
  args: AttemptArgs;
  message: string;
  detail: string;
  busy: boolean;
};

/** A tap you can feel. Pattern durations are ignored on iOS, which is fine —
 *  the point is that something happened, not how long it lasted. */
function buzz(pattern: number | number[]) {
  try {
    Vibration.vibrate(pattern);
  } catch {
    // Web without vibration support, or a simulator. Silence is correct.
  }
}

export function usePostAnswer({
  state,
  dispatch,
  userId,
  pace,
  labels,
  audioFailedFor,
  sessionReady,
}: {
  state: PracticeState;
  dispatch: Dispatch<PracticeAction>;
  userId: string | null;
  pace: Record<string, TypePace>;
  labels: string[] | null;
  /** The question whose audio would not play, if any. */
  audioFailedFor: string | null;
  sessionReady: RefObject<Promise<string | null> | null>;
}): { sendError: SendError | null; resend: () => void } {
  const { t } = useLang();
  const [sendError, setSendError] = useState<SendError | null>(null);

  /** An outbox flush, told to the reducer: an answer that waited and has now
   *  landed takes the database's verdict, one it refused is no longer counted. */
  function applyFlush(result: FlushResult) {
    for (const s of result.saved) dispatch({ type: "synced", itemId: s.itemId, verdict: s.graded });
    for (const d of result.dropped) dispatch({ type: "dropped", itemId: d.itemId });
  }

  // The connection is likelier to be back when the app is: send what waited.
  // On the web the browser also says so outright.
  useEffect(() => {
    if (!userId) return;
    const retry = () => void flushAnswers(userId).then(applyFlush);
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") retry();
    });
    const web = Platform.OS === "web" && typeof window !== "undefined" ? window : null;
    web?.addEventListener("online", retry);
    return () => {
      sub.remove();
      web?.removeEventListener("online", retry);
    };
    // `applyFlush` only dispatches, and `dispatch` is the reducer's own,
    // stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /**
   * What became of an answer, on the screen. The database's verdict when it
   * landed. When it did not, the phone reads the answer key for the card —
   * drawn, marked unsent, and never written anywhere — and the insert itself
   * waits in the outbox (a lost connection) or behind a button (an error).
   * The database's two refusals change the set instead of the card.
   */
  function settle(outcome: SendOutcome, it: QueuedItem, args: AttemptArgs) {
    const ranOut = args.chosenIndex === NO_ANSWER;
    const local = () => {
      const option = it.options.find((o) => o.position === args.chosenIndex);
      return {
        isCorrect: !ranOut && args.chosenIndex === it.correct_index,
        chosenRole: ranOut ? "timed_out" : (option?.role ?? ""),
        saved: false,
      };
    };
    switch (outcome.kind) {
      case "saved":
        dispatch({ type: "graded", verdict: { ...outcome.graded, saved: true } });
        buzz(outcome.graded.isCorrect ? [0, 18, 60, 18] : 40);
        return;
      case "queued":
        dispatch({ type: "graded", verdict: local() });
        return;
      case "failed":
        dispatch({ type: "graded", verdict: local() });
        setSendError({ itemId: it.id, args, ...friendlyError(outcome.error, t), busy: false });
        return;
      case "day_over":
        dispatch({ type: "dayOver" });
        return;
      case "unavailable":
        dispatch({ type: "unavailable", now: Date.now() });
        return;
    }
  }

  // An answer, posted once. The reducer accepts one `choose` per question, so
  // however many presses arrived there is one pending answer, and this runs
  // once for it. The database grades it; see `settle` for when it cannot.
  useEffect(() => {
    const pending = state.pending;
    if (!pending || !userId) return;
    const it = state.items[pending.index];
    if (!it) return;
    // A longer single buzz for the clock: it is the one verdict that arrives
    // without anybody having pressed anything, so it announces itself.
    buzz(pending.position === NO_ANSWER ? 60 : 12);
    const args: AttemptArgs = {
      itemId: it.id,
      chosenIndex: pending.position,
      sessionId: null,
      elapsedMs: pending.at - state.shownAt,
      thinkMs: thinkTime(state, pending, {
        selfPaced: Boolean(pace[it.item_type]),
        // Audio that would not play left the item to be read, with no audio to
        // time from: the same as an item with no clips.
        listenable: playlistFor(it, labels, clipUrl).length > 0 && audioFailedFor !== it.id,
      }),
      replays: state.replays,
      peeked: state.peeked,
      standsFor: it.stands_for ?? null,
    };
    (async () => {
      const sessionId = (await sessionReady.current) ?? null;
      // What waited goes first, in the order it was given.
      applyFlush(await flushAnswers(userId));
      const sent = { ...args, sessionId };
      settle(await sendAnswer(userId, sent), it, sent);
    })();
    // Keyed on the pending answer alone: everything else is read as it stands
    // at the moment of the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pending]);

  /** "Send again", after an error the database gave rather than a lost line. */
  async function resendNow() {
    if (!sendError || sendError.busy || !userId) return;
    const { itemId, args } = sendError;
    setSendError({ ...sendError, busy: true });
    applyFlush(await flushAnswers(userId));
    const outcome = await sendAnswer(userId, args);
    switch (outcome.kind) {
      case "saved":
        dispatch({ type: "synced", itemId, verdict: outcome.graded });
        setSendError(null);
        return;
      case "queued":
        setSendError(null);
        return;
      case "failed":
        setSendError({ itemId, args, ...friendlyError(outcome.error, t), busy: false });
        return;
      case "day_over":
        dispatch({ type: "dropped", itemId });
        dispatch({ type: "dayOver" });
        setSendError(null);
        return;
      case "unavailable":
        dispatch({ type: "dropped", itemId });
        setSendError(null);
        return;
    }
  }

  return { sendError, resend: () => void resendNow() };
}
