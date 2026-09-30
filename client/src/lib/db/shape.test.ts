/**
 * The data layer's own arithmetic, without a client: the review list's join,
 * the missed words' tally, and the spoken numbers' all-or-none.
 */
import { describe, expect, it } from "vitest";

import { allOrNone, joinHistory, missedWords, type AttemptRow, type HistoryItemRow, type OptionRow } from "./shape";

const attempt = (id: string, item_id: string, is_correct = false): AttemptRow => ({
  id,
  item_id,
  answered_at: `2026-09-2${id}T00:00:00Z`,
  is_correct,
  chosen_index: 1,
  chosen_role: is_correct ? "correct" : "register_too_casual",
});

const item = (id: string, explanation_en: string | null = "Because."): HistoryItemRow => ({
  id,
  item_type: "hatsugen_choukai",
  level: "J2",
  topic: "",
  stem: `stem ${id}`,
  correct_index: 0,
  explanation_ja: "説明",
  explanation_en,
});

const option = (item_id: string, position: number): OptionRow => ({
  item_id,
  position,
  text: `option ${position}`,
  role: position === 0 ? "correct" : "register_too_casual",
  why: "",
});

describe("the review list", () => {
  it("puts each answer beside its question, in the answers' order, options in printed order", () => {
    const rows = joinHistory(
      [attempt("3", "b"), attempt("2", "a", true), attempt("1", "b")],
      [item("a"), item("b", null)],
      [option("b", 2), option("b", 0), option("b", 1), option("a", 0)],
      [{ id: "hatsugen_choukai", label_ja: "発言聴解問題" }]
    );
    expect(rows.map((r) => r.attempt_id)).toEqual(["3", "2", "1"]);
    expect(rows[0].options.map((o) => o.position)).toEqual([0, 1, 2]);
    expect(rows[0].options[0]).toMatchObject({ clip_id: null, audio_path: null });
    expect(rows[0].label_ja).toBe("発言聴解問題");
    // A question with no English explanation reads as empty, not "null".
    expect(rows[0].explanation_en).toBe("");
  });

  it("skips an answer whose question has been unpublished, rather than showing it broken", () => {
    const rows = joinHistory([attempt("1", "gone"), attempt("2", "a")], [item("a")], [], []);
    expect(rows.map((r) => r.item_id)).toEqual(["a"]);
    // With no label to find, the type's id stands in.
    expect(rows[0].label_ja).toBe("hatsugen_choukai");
  });
});

describe("the missed words", () => {
  const notes = new Map([
    ["a", [{ term: "引き継ぎ", reading: "ひきつぎ", meaning: "handover" }]],
    [
      "b",
      [
        { term: "引き継ぎ", reading: "ひきつぎ", meaning: "handover" },
        { term: "稟議", reading: "りんぎ", meaning: "approval" },
      ],
    ],
  ]);

  it("keeps one entry per word, pointing at its latest miss, and counts every miss", () => {
    const words = missedWords(
      [
        { item_id: "b", answered_at: "2026-09-29T00:00:00Z" },
        { item_id: "a", answered_at: "2026-09-20T00:00:00Z" },
      ],
      notes
    );
    const handover = words.find((w) => w.term === "引き継ぎ");
    expect(handover).toMatchObject({ misses: 2, item_id: "b", last_missed_at: "2026-09-29T00:00:00Z" });
    expect(words.find((w) => w.term === "稟議")).toMatchObject({ misses: 1, item_id: "b" });
  });

  it("is empty for a question with no notes", () => {
    expect(missedWords([{ item_id: "none", answered_at: "x" }], notes)).toEqual([]);
  });
});

describe("the spoken numbers", () => {
  const labels = ["いち", "に", "さん", "よん"];
  const url = (path: string | null) => (path ? `https://clips/${path}` : null);

  it("come back in 1-4 order when all four exist", () => {
    const paths = new Map([
      ["よん", "4.mp3"],
      ["いち", "1.mp3"],
      ["さん", "3.mp3"],
      ["に", "2.mp3"],
    ]);
    expect(allOrNone(labels, paths, url)).toEqual([
      "https://clips/1.mp3",
      "https://clips/2.mp3",
      "https://clips/3.mp3",
      "https://clips/4.mp3",
    ]);
  });

  it("do not come back at all while one is missing or not yet synthesised", () => {
    expect(allOrNone(labels, new Map([["いち", "1.mp3"], ["に", "2.mp3"], ["さん", "3.mp3"]]), url)).toBeNull();
    expect(
      allOrNone(labels, new Map<string, string | null>([["いち", "1.mp3"], ["に", "2.mp3"], ["さん", "3.mp3"], ["よん", null]]), url)
    ).toBeNull();
  });
});
