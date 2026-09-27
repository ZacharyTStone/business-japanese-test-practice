/**
 * The practice reducer, and the bugs it exists to make impossible. Each of the
 * first four tests is a bug the screen shipped with at least once, written down
 * in the comments of the version before the reducer.
 */
import { describe, expect, it } from "vitest";

import {
  initialPractice,
  practiceReducer,
  thinkTime,
  type PracticeAction,
  type PracticeState,
} from "./practice";
import type { QueuedItem } from "./types";

function item(id: string, correct = 0): QueuedItem {
  return {
    id,
    item_type: "goi_bunpou",
    level: "J2",
    topic: id,
    stem: "空欄に入るものは。",
    scene_id: null,
    scene_image_path: null,
    speaker_role: null,
    listener_role: null,
    channel: null,
    seed_cell_id: null,
    correct_index: correct,
    explanation_ja: "",
    explanation_en: "",
    vocab_notes: [],
    documents: [],
    dialogue: [],
    narration_clip_id: null,
    narration_path: null,
    options: [0, 1, 2, 3].map((position) => ({
      position,
      text: `選択肢${position}`,
      role: position === correct ? "correct" : "register_too_casual",
      why: "",
      clip_id: null,
      audio_path: null,
    })),
    times_seen: 0,
    stands_for: null,
    lesson_trap: null,
  };
}

function run(actions: PracticeAction[], start?: PracticeState): PracticeState {
  return actions.reduce(practiceReducer, start ?? initialPractice(0));
}

const loaded = (n: number): PracticeAction => ({
  type: "loaded",
  items: Array.from({ length: n }, (_, i) => item(`q${i + 1}`)),
  now: 1000,
});

describe("one press, one move", () => {
  it("answers a question once however many presses arrive", () => {
    const s = run([
      loaded(3),
      { type: "choose", position: 1, stage: "answer", now: 2000 },
      { type: "choose", position: 2, stage: "answer", now: 2001 },
    ]);
    expect(s.chosen).toBe(1);
    expect(s.pending).toEqual({ index: 0, position: 1, at: 2000, stage: "answer" });
  });

  it("advances once, so the counter never skips a question", () => {
    const s = run([
      loaded(3),
      { type: "choose", position: 0, stage: "answer", now: 2000 },
      { type: "graded", verdict: { isCorrect: true, chosenRole: "correct" } },
      { type: "next", now: 3000 },
      { type: "next", now: 3001 },
    ]);
    expect(s.index).toBe(1);
    expect(s.chosen).toBeNull();
    expect(s.graded).toBeNull();
  });

  it("does not let the tail of a double tap on next answer the question after it", () => {
    const s = run([
      loaded(3),
      { type: "choose", position: 0, stage: "answer", now: 2000 },
      { type: "graded", verdict: { isCorrect: true, chosenRole: "correct" } },
      { type: "next", now: 3000 },
      { type: "next", now: 3080 },
      { type: "choose", position: 3, stage: "answer", now: 3090 },
    ]);
    expect(s.index).toBe(1);
    expect(s.chosen).toBeNull();
    // ...while a real answer, a moment later, is taken.
    expect(practiceReducer(s, { type: "choose", position: 2, stage: "answer", now: 4200 }).chosen).toBe(2);
  });

  it("always takes the clock's own timeout", () => {
    const s = run([loaded(1), { type: "choose", position: -1, stage: "answer", now: 1001 }]);
    expect(s.chosen).toBe(-1);
  });

  it("does not advance past a question nobody has answered", () => {
    const s = run([loaded(3), { type: "next", now: 3000 }]);
    expect(s.index).toBe(0);
  });
});

describe("the stage", () => {
  it("never backs out of a reveal when the audio finishes afterwards", () => {
    const s = run([
      loaded(2),
      { type: "stage", stage: "listen", now: 1500 },
      { type: "choose", position: 0, stage: "listen", now: 2000 },
      { type: "graded", verdict: { isCorrect: true, chosenRole: "correct" } },
      { type: "stage", stage: "answer", now: 2500 },
    ]);
    expect(s.stage).toBe("reveal");
  });

  it("starts the question after a veto from its first stage, not in the vetoed one's", () => {
    const s = run([
      loaded(3),
      { type: "stage", stage: "listen", now: 1500 },
      { type: "vetoed", now: 2000 },
    ]);
    expect(s.items.map((i) => i.id)).toEqual(["q2", "q3"]);
    expect(s.index).toBe(0);
    expect(s.stage).toBeNull();
  });

  it("marks when the question became answerable, once", () => {
    const s = run([
      loaded(1),
      { type: "stage", stage: "listen", now: 1500 },
      { type: "stage", stage: "answer", now: 4000 },
      { type: "stage", stage: "answer", now: 5000 },
    ]);
    expect(s.answerFrom).toBe(4000);
  });
});

describe("the end of the set", () => {
  it("goes to the result after the last question", () => {
    const s = run([
      loaded(1),
      { type: "choose", position: 2, stage: "answer", now: 2000 },
      { type: "graded", verdict: { isCorrect: false, chosenRole: "register_too_casual" } },
      { type: "next", now: 3000 },
    ]);
    expect(s.done).toBe("result");
    expect(s.answers).toHaveLength(1);
    expect(s.answers[0]).toMatchObject({ chosenIndex: 2, isCorrect: false, role: "register_too_casual" });
  });

  it("goes to the result when the last question is vetoed, and home when a veto empties the set", () => {
    const last = run([
      loaded(2),
      { type: "choose", position: 0, stage: "answer", now: 2000 },
      { type: "graded", verdict: { isCorrect: true, chosenRole: "correct" } },
      { type: "next", now: 3000 },
      { type: "vetoed", now: 3500 },
    ]);
    expect(last.done).toBe("result");
    expect(run([loaded(1), { type: "vetoed", now: 2000 }]).done).toBe("home");
  });

  it("ignores a veto once the question is answered: an answer is not taken back", () => {
    const s = run([
      loaded(2),
      { type: "choose", position: 0, stage: "answer", now: 2000 },
      { type: "vetoed", now: 2100 },
    ]);
    expect(s.items).toHaveLength(2);
    expect(s.pending).not.toBeNull();
  });
});

describe("the verdict", () => {
  it("opens the explanation after a miss and leaves it folded after a right answer", () => {
    const miss = run([
      loaded(2),
      { type: "choose", position: 3, stage: "answer", now: 2000 },
      { type: "graded", verdict: { isCorrect: false, chosenRole: "register_too_casual" } },
    ]);
    expect(miss.showDetails).toBe(true);
    const right = run([
      loaded(2),
      { type: "choose", position: 0, stage: "answer", now: 2000 },
      { type: "graded", verdict: { isCorrect: true, chosenRole: "correct" } },
    ]);
    expect(right.showDetails).toBe(false);
  });

  it("ignores a verdict with no answer waiting for it", () => {
    const s = run([loaded(1), { type: "graded", verdict: { isCorrect: true, chosenRole: "correct" } }]);
    expect(s.graded).toBeNull();
    expect(s.answers).toHaveLength(0);
  });
});

describe("help the exam does not give", () => {
  it("counts replays before the answer, and not after", () => {
    const s = run([
      loaded(1),
      { type: "replayed" },
      { type: "replayed" },
      { type: "choose", position: 0, stage: "answer", now: 2000 },
      { type: "replayed" },
    ]);
    expect(s.replays).toBe(2);
  });

  it("notes the spoken options being read, but not being hidden again", () => {
    const s = run([loaded(1), { type: "toggleOptionsText" }, { type: "toggleOptionsText" }]);
    expect(s.optionsAsText).toBe(false);
    expect(s.peeked).toBe(true);
    const after = run([
      loaded(1),
      { type: "choose", position: 0, stage: "answer", now: 2000 },
      { type: "toggleOptionsText" },
    ]);
    expect(after.peeked).toBe(false);
  });

  it("starts every question with none of it", () => {
    const s = run([
      loaded(2),
      { type: "replayed" },
      { type: "toggleOptionsText" },
      { type: "choose", position: 0, stage: "answer", now: 2000 },
      { type: "graded", verdict: { isCorrect: true, chosenRole: "correct" } },
      { type: "next", now: 3000 },
    ]);
    expect(s.replays).toBe(0);
    expect(s.peeked).toBe(false);
    expect(s.optionsAsText).toBe(false);
  });
});

describe("think time", () => {
  const listening = { selfPaced: false, listenable: true };
  const reading = { selfPaced: true, listenable: false };
  const unheard = { selfPaced: false, listenable: false };

  it("times a reading question from the moment it could be answered", () => {
    expect(thinkTime({ answerFrom: null, shownAt: 1000 }, { at: 31000, stage: "answer" }, reading)).toBe(30000);
    expect(thinkTime({ answerFrom: 5000, shownAt: 1000 }, { at: 31000, stage: "answer" }, reading)).toBe(26000);
  });

  it("times a listening question from the end of its audio, not from its start", () => {
    expect(thinkTime({ answerFrom: 91000, shownAt: 1000 }, { at: 95000, stage: "answer" }, listening)).toBe(4000);
  });

  it("gives an answer during the audio no think time at all", () => {
    expect(thinkTime({ answerFrom: null, shownAt: 1000 }, { at: 40000, stage: "listen" }, listening)).toBe(0);
  });

  it("has none for a listening item read as text", () => {
    expect(thinkTime({ answerFrom: null, shownAt: 1000 }, { at: 40000, stage: "answer" }, unheard)).toBeNull();
  });
});
