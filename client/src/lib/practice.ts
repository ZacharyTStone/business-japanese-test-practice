/**
 * The practice screen's state, as one reducer.
 *
 * State set in a press handler is not visible until the next render, so two
 * presses landing in one tick would both read the old value and both go
 * through: two attempts written for one question, or a question stepped over
 * without being asked. A reducer sees its actions one after another, each
 * against the state the last one left, so a second press in the same tick
 * finds the question already answered and changes nothing — by construction
 * rather than by a ref somebody remembered to set. And the transitions are a
 * pure function, which is what `practice.test.ts` checks.
 *
 * Network calls stay in the screen. An answer is `pending` here from the press
 * until the database's verdict arrives as `graded`; the screen posts it from an
 * effect keyed on that value, so it is posted once however many presses there
 * were.
 */
import { NO_ANSWER, type AnsweredItem, type QueuedItem } from "./types";

/**
 * How soon after a question appears a press on one of its options is taken as
 * an answer. A double tap on "next" advances once — but its second tap lands on
 * whatever the next question put under the finger. Nobody reads a question and
 * answers it in a third of a second, so a press that early is the tail of the
 * last one.
 * The clock's own timeout is never refused.
 */
const SETTLE_MS = 350;

export type Stage = "scene" | "listen" | "answer" | "reveal";

/** The database's verdict on an answer — or, with `saved` false, the phone's
 *  reading of the answer key while the answer waits to be sent (see
 *  src/lib/outbox.ts). That reading is drawn on the card and never written. */
export type Verdict = { isCorrect: boolean; chosenRole: string; saved: boolean };

/** An answer on its way to the database. */
export type PendingAnswer = {
  index: number;
  position: number;
  /** When it was given. */
  at: number;
  /** The stage it was given in: a spoken option can be answered in "listen". */
  stage: Stage;
};

export type PracticeState = {
  items: QueuedItem[];
  index: number;
  /** Null until the question has moved: the screen supplies the natural first
   *  stage (the scene, or straight to the answer for a bare reading item). */
  stage: Stage | null;
  chosen: number | null;
  pending: PendingAnswer | null;
  graded: Verdict | null;
  showDetails: boolean;
  /** The learner asked to see spoken options as text before answering. */
  optionsAsText: boolean;
  answers: AnsweredItem[];
  /** When this question appeared. */
  shownAt: number;
  /** When it became answerable with nothing left to hear, if it has moved to
   *  the answer stage; null for a question that started there. */
  answerFrom: number | null;
  /** Help the exam does not give: another listen, the options read. */
  replays: number;
  peeked: boolean;
  /** Where the set ends up: the result screen, home when a veto emptied it,
   *  or the day's done screen when the database closed the day before this
   *  set had an answer to show. */
  done: "result" | "home" | "day" | null;
};

export type PracticeAction =
  | { type: "loaded"; items: QueuedItem[]; now: number }
  | { type: "stage"; stage: Stage; now: number }
  | { type: "choose"; position: number; stage: Stage; now: number }
  | { type: "graded"; verdict: Verdict }
  | { type: "replayed" }
  | { type: "toggleOptionsText" }
  | { type: "toggleDetails" }
  | { type: "next"; now: number }
  | { type: "vetoed"; now: number }
  /** The database refused the pending answer: the question is out of the bank. */
  | { type: "unavailable"; now: number }
  /** The database refused the pending answer: the day's ceiling is reached. */
  | { type: "dayOver" }
  /** An answer that waited in the outbox has reached the database. */
  | { type: "synced"; itemId: string; verdict: { isCorrect: boolean; chosenRole: string } }
  /** An answer that waited was refused when it was sent: it is not counted. */
  | { type: "dropped"; itemId: string };

export function initialPractice(now: number): PracticeState {
  return {
    items: [],
    index: 0,
    stage: null,
    chosen: null,
    pending: null,
    graded: null,
    showDetails: false,
    optionsAsText: false,
    answers: [],
    shownAt: now,
    answerFrom: null,
    replays: 0,
    peeked: false,
    done: null,
  };
}

/** Everything that belongs to one question, put back for the next. */
function nextQuestion(state: PracticeState, now: number): PracticeState {
  return {
    ...state,
    stage: null,
    chosen: null,
    pending: null,
    graded: null,
    showDetails: false,
    optionsAsText: false,
    shownAt: now,
    answerFrom: null,
    replays: 0,
    peeked: false,
  };
}

/** Take the question on screen out of the set — a veto, or a question the
 *  database says is gone — and start the one after it from its first stage. */
function removeCurrent(state: PracticeState, now: number): PracticeState {
  const items = state.items.filter((_, i) => i !== state.index);
  if (items.length === 0) return { ...state, items, pending: null, done: "home" };
  if (state.index >= items.length) {
    return { ...state, items, pending: null, done: state.answers.length > 0 ? "result" : "home" };
  }
  // `index` stays put, which is now the question after the removed one — and
  // every per-question field starts again, the stage included.
  return { ...nextQuestion(state, now), items };
}

export function practiceReducer(state: PracticeState, action: PracticeAction): PracticeState {
  if (state.done && action.type !== "loaded") return state;
  switch (action.type) {
    case "loaded":
      return { ...initialPractice(action.now), items: action.items };

    case "stage":
      // Never back out of a reveal: an answer given while the clips were still
      // playing is not undone by the playlist finishing afterwards.
      if (state.stage === "reveal" && action.stage !== "reveal") return state;
      return {
        ...state,
        stage: action.stage,
        // The first time the options are reachable with nothing left to hear:
        // the moment the time to answer starts.
        answerFrom:
          action.stage === "answer" && state.answerFrom === null && state.chosen === null
            ? action.now
            : state.answerFrom,
      };

    case "choose":
      // One answer per question, however many presses arrive.
      if (state.chosen !== null || state.pending || !state.items[state.index]) return state;
      if (action.position !== NO_ANSWER && action.now - state.shownAt < SETTLE_MS) return state;
      return {
        ...state,
        chosen: action.position,
        pending: { index: state.index, position: action.position, at: action.now, stage: action.stage },
      };

    case "graded": {
      const pending = state.pending;
      if (!pending) return state;
      const item = state.items[pending.index];
      return {
        ...state,
        pending: null,
        graded: action.verdict,
        stage: "reveal",
        // The explanation is where a miss teaches: open after one, folded after
        // a right answer for whoever wants it.
        showDetails: !action.verdict.isCorrect,
        answers: [
          ...state.answers,
          {
            item,
            chosenIndex: pending.position,
            isCorrect: action.verdict.isCorrect,
            role: action.verdict.chosenRole,
            saved: action.verdict.saved,
          },
        ],
      };
    }

    case "synced": {
      // The database's verdict replaces the phone's, on the card if the
      // question is still on screen and in the list the result is built from.
      const onScreen = state.items[state.index]?.id === action.itemId && state.graded?.saved === false;
      return {
        ...state,
        answers: settleAnswers(state.answers, { saved: [{ itemId: action.itemId, graded: action.verdict }] }),
        graded: onScreen ? { ...action.verdict, saved: true } : state.graded,
      };
    }

    case "dropped":
      return { ...state, answers: settleAnswers(state.answers, { dropped: [{ itemId: action.itemId }] }) };

    case "unavailable":
      // The database would not take the answer because the question has left
      // the bank since the set was built. Nothing was recorded, so nothing is
      // counted: it goes the way a veto does.
      if (!state.pending) return state;
      return removeCurrent(state, action.now);

    case "dayOver":
      // The ceiling was reached — on another device, most likely — and the
      // pending answer was refused. The set stops where it is: the result of
      // what was answered, or the day's done screen if nothing was.
      return { ...state, pending: null, done: state.answers.length > 0 ? "result" : "day" };

    case "replayed":
      return state.chosen === null ? { ...state, replays: state.replays + 1 } : state;

    case "toggleOptionsText":
      return {
        ...state,
        optionsAsText: !state.optionsAsText,
        peeked: state.peeked || (!state.optionsAsText && state.chosen === null),
      };

    case "toggleDetails":
      return { ...state, showDetails: !state.showDetails };

    case "next":
      // Only from a verdict, so a second press — which finds the next question
      // unanswered — does nothing, rather than stepping over it.
      if (!state.graded) return state;
      if (state.index + 1 >= state.items.length) return { ...state, done: "result" };
      return { ...nextQuestion(state, action.now), index: state.index + 1 };

    case "vetoed":
      // Instead of answering, never after: nothing is recorded for a veto.
      if (state.chosen !== null) return state;
      return removeCurrent(state, action.now);
  }
}

/**
 * The set's answers with an outbox flush's news applied: one that has reached
 * the database carries the database's verdict, one it refused is no longer
 * counted. Only unsent answers are touched — a set asks a question once, so the
 * item is enough to find it. The screen runs this on the way to the result, so
 * the list handed over is the one the database now agrees with.
 */
export function settleAnswers(
  answers: AnsweredItem[],
  news: {
    saved?: { itemId: string; graded: { isCorrect: boolean; chosenRole: string } }[];
    dropped?: { itemId: string }[];
  }
): AnsweredItem[] {
  const saved = new Map((news.saved ?? []).map((s) => [s.itemId, s.graded]));
  const dropped = new Set((news.dropped ?? []).map((d) => d.itemId));
  return answers
    .filter((a) => !(a.saved === false && dropped.has(a.item.id)))
    .map((a) => {
      const graded = a.saved === false ? saved.get(a.item.id) : undefined;
      return graded ? { ...a, isCorrect: graded.isCorrect, role: graded.chosenRole, saved: true } : a;
    });
}

/**
 * How long the learner took once the question could be answered — what the
 * ladder calls slow or not (attempts.think_ms).
 *
 * A self-paced reading type is timed from the moment it was answerable: its
 * answer stage, or its appearance if it started there. A listening type is timed
 * from the end of its audio, and an answer given before the audio ended took no
 * time at all. A listening item with no clips is being read rather than heard,
 * and has no think time: the database falls back to its two-minute rule.
 */
export function thinkTime(
  state: Pick<PracticeState, "answerFrom" | "shownAt">,
  answer: Pick<PendingAnswer, "at" | "stage">,
  kind: { selfPaced: boolean; listenable: boolean }
): number | null {
  const from = state.answerFrom ?? state.shownAt;
  if (kind.selfPaced) return Math.max(0, answer.at - from);
  if (kind.listenable) return answer.stage === "answer" ? Math.max(0, answer.at - from) : 0;
  return null;
}
