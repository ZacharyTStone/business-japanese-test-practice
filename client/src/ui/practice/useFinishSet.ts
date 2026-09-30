/**
 * The end of a set: the session closed, and the way to the result.
 */
import { useRouter } from "expo-router";
import { useEffect, useRef, type RefObject } from "react";

import { flushAnswersWithin } from "../../lib/answers";
import { finishSession } from "../../lib/db";
import { settleAnswers, type PracticeState } from "../../lib/practice";
import { setSummary } from "../../lib/session";
import type { SectionLevel } from "../../lib/types";

export function useFinishSet({
  state,
  userId,
  sessionReady,
  levelsBefore,
}: {
  state: PracticeState;
  userId: string | null;
  sessionReady: RefObject<Promise<string | null> | null>;
  levelsBefore: RefObject<SectionLevel[]>;
}) {
  const router = useRouter();
  const startedAt = useRef(Date.now());
  /** Whether the session has been closed, and how many answers it holds, for
   *  closing it when the screen is left part-way through a set. */
  const closed = useRef(false);
  const answered = useRef(0);
  answered.current = state.answers.length;

  /** Close the session, once, if it holds anything. */
  const close = useRef(() => {
    if (closed.current || answered.current === 0) return;
    closed.current = true;
    void sessionReady.current?.then((id) => (id ? finishSession(id) : undefined)).catch(() => undefined);
  }).current;

  // Left part-way through — the back button, a tab closed — is still a sitting
  // that happened, and it ends when the screen does.
  useEffect(() => () => close(), [close]);

  // The end of the set: the result screen, or home when a veto left nothing.
  // The day's done screen, when the database closed the day before anything
  // was answered, is drawn by the screen rather than navigated to.
  useEffect(() => {
    if (!state.done || state.done === "day") return;
    if (state.done === "home") {
      router.replace("/");
      return;
    }
    close();
    const finishedAt = Date.now();
    (async () => {
      // One more try for anything still waiting, so the result lists what the
      // database has — but not a long one: a connection that is not back in a
      // few seconds is not worth holding the result for, and the outbox keeps
      // what it has either way.
      const flushed = userId ? await flushAnswersWithin(userId, 3000) : null;
      setSummary({
        answers: flushed ? settleAnswers(state.answers, flushed) : state.answers,
        startedAt: startedAt.current,
        finishedAt,
        levelsBefore: levelsBefore.current,
      });
      router.replace("/result");
    })();
    // Once, when the set ends; the answers are read as they stand then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done]);
}
