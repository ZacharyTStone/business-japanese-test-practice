/**
 * The word list: that a word's sentence is a line of a question and never a
 * wrong option, that furigana lines up with the kana it shares, and that the
 * search and the filters narrow the list the way the chips say.
 */
import { describe, expect, it } from "vitest";

import type { WordSourceItem } from "./words";
import {
  annotate,
  buildWordList,
  conjugationStem,
  filterWords,
  fold,
  furigana,
  linesOf,
  makeAnnotator,
  sentenceWith,
} from "./words";

function item(over: Partial<WordSourceItem>): WordSourceItem {
  return {
    id: "x",
    level: "J2",
    section: "dokkai",
    stem: "",
    dialogue: [],
    documents: [],
    vocab_notes: [],
    correct_text: null,
    ...over,
  };
}

describe("furigana", () => {
  it("gives each kanji run its own reading and leaves shared kana bare", () => {
    expect(furigana("引き継ぎ", "ひきつぎ")).toEqual([
      { text: "引", ruby: "ひ" },
      { text: "き" },
      { text: "継", ruby: "つ" },
      { text: "ぎ" },
    ]);
    expect(furigana("すり合わせる", "すりあわせる")).toEqual([
      { text: "すり" },
      { text: "合", ruby: "あ" },
      { text: "わせる" },
    ]);
  });

  it("puts the whole reading over the whole term when it cannot align", () => {
    expect(furigana("今日", "きょう")).toEqual([{ text: "今日", ruby: "きょう" }]);
    expect(furigana("見積もり", "みつもる")).toEqual([{ text: "見積もり", ruby: "みつもる" }]);
  });

  it("leaves a word with no kanji alone", () => {
    expect(furigana("スケジュール", "すけじゅーる")).toEqual([{ text: "スケジュール" }]);
  });
});

describe("annotate", () => {
  const notes = [
    { term: "引き継ぎ", reading: "ひきつぎ", meaning: "handover" },
    { term: "すり合わせる", reading: "すりあわせる", meaning: "to align" },
    { term: "事前に", reading: "じぜんに", meaning: "beforehand" },
  ];

  it("reads every noted word in a sentence, and a verb in its conjugated form", () => {
    const segs = annotate("事前にすり合わせてまいりました。", notes);
    expect(segs.map((s) => s.text).join("")).toBe("事前にすり合わせてまいりました。");
    expect(segs.filter((s) => s.ruby)).toEqual([
      { text: "事前", ruby: "じぜん" },
      { text: "合", ruby: "あ" },
    ]);
  });

  it("keeps a sentence with nothing noted as one bare run", () => {
    expect(annotate("よろしくお願いします。", notes)).toEqual([{ text: "よろしくお願いします。" }]);
  });

  it("finds a verb by its stem only where a kana ending follows it", () => {
    expect(conjugationStem("すり合わせる")).toBe("すり合");
    expect(conjugationStem("退職")).toBeNull();
    const meet = [{ term: "会う", reading: "あう", meaning: "to meet" }];
    expect(annotate("会って話す。", meet).filter((s) => s.ruby)).toEqual([{ text: "会", ruby: "あ" }]);
    expect(annotate("会議の会の話。", meet).filter((s) => s.ruby)).toEqual([]);
    expect(sentenceWith("会議です。明日伺っております。", "伺う")).toBe("明日伺っております。");
  });

  it("reads the longest word that starts at a place, not the first one noted", () => {
    const both = [
      { term: "引き継ぎ", reading: "ひきつぎ", meaning: "handover" },
      { term: "引き継ぎ書", reading: "ひきつぎしょ", meaning: "handover note" },
    ];
    expect(annotate("引き継ぎ書を送ります。", both).filter((s) => s.ruby)).toEqual([
      { text: "引", ruby: "ひ" },
      { text: "継", ruby: "つ" },
      { text: "書", ruby: "しょ" },
    ]);
    expect(annotate("引き継ぎの件です。", both).filter((s) => s.ruby)).toEqual([
      { text: "引", ruby: "ひ" },
      { text: "継", ruby: "つ" },
    ]);
  });

  it("gives the same answer from a kept annotator, and remembers a sentence", () => {
    const annotator = makeAnnotator(notes);
    const sentences = ["事前にすり合わせてまいりました。", "引き継ぎの件です。", "よろしくお願いします。"];
    for (const s of sentences) expect(annotator(s)).toEqual(annotate(s, notes));
    // The list redraws on every keystroke; the second ask is a lookup.
    expect(annotator(sentences[0])).toBe(annotator(sentences[0]));
  });

  it("drops a note's 〜 when looking for it", () => {
    expect(sentenceWith("田中に代わりましてご説明します。", "〜に代わりまして")).toBe(
      "田中に代わりましてご説明します。"
    );
  });
});

describe("the example sentence", () => {
  it("fills a blank with the correct option and never a wrong one", () => {
    const it_ = item({ stem: "事前に＿＿＿ので、確認します。", correct_text: "すり合わせてまいりました" });
    expect(linesOf(it_)).toContain("事前にすり合わせてまいりましたので、確認します。");
    expect(linesOf(it_)).not.toContain("すり合わせてまいりました");
    const spoken = item({ stem: "何と言いますか。", correct_text: "少々お待ちください。" });
    expect(linesOf(spoken).at(-1)).toBe("少々お待ちください。");
  });

  it("is the one sentence of a line that uses the word", () => {
    expect(sentenceWith("お世話になっております。引き継ぎの件です。よろしく。", "引き継ぎ")).toBe(
      "引き継ぎの件です。"
    );
    expect(sentenceWith("別の話です。", "引き継ぎ")).toBeNull();
    expect(sentenceWith("「あいにく切れてしまいまして。ご了承ください」", "あいにく")).toBe(
      "あいにく切れてしまいまして。"
    );
  });

  it("comes from a question that noted the word before any other", () => {
    const noted = item({
      id: "a",
      vocab_notes: [{ term: "退職", reading: "たいしょく", meaning: "resignation" }],
      dialogue: [{ text: "担当の方が退職されまして。" }],
    });
    const other = item({ id: "b", stem: "退職の手続きです。" });
    const [word] = buildWordList([other, noted]);
    expect(word.sentence).toBe("担当の方が退職されまして。");
  });

  it("falls back to another question, and to none", () => {
    const words = buildWordList([
      item({
        id: "a",
        vocab_notes: [
          { term: "退職", reading: "たいしょく", meaning: "resignation" },
          { term: "稟議", reading: "りんぎ", meaning: "approval" },
        ],
      }),
      item({ id: "b", stem: "退職の手続きです。" }),
    ]);
    expect(words.find((w) => w.term === "退職")?.sentence).toBe("退職の手続きです。");
    expect(words.find((w) => w.term === "稟議")?.sentence).toBeNull();
  });
});

describe("the list", () => {
  const words = buildWordList([
    item({
      id: "a",
      level: "J1",
      section: "choukai",
      vocab_notes: [{ term: "引き継ぎ", reading: "ひきつぎ", meaning: "handover" }],
    }),
    item({
      id: "b",
      level: "J3",
      section: "dokkai",
      vocab_notes: [
        { term: "引き継ぎ", reading: "ひきつぎ", meaning: "handover" },
        { term: "会議", reading: "かいぎ", meaning: "meeting" },
      ],
    }),
  ]);

  it("has one entry per word, carrying every level and section it appears at, in reading order", () => {
    expect(words.map((w) => w.term)).toEqual(["会議", "引き継ぎ"]);
    expect(words[1].levels).toEqual(["J1", "J3"]);
    expect(words[1].sections).toEqual(["choukai", "dokkai"]);
  });

  it("searches the word, its reading in either kana, and its meaning", () => {
    const q = (query: string) => filterWords(words, { query, level: null, section: null }).map((w) => w.term);
    expect(q("引き")).toEqual(["引き継ぎ"]);
    expect(q("ヒキツギ")).toEqual(["引き継ぎ"]);
    expect(q("MEETING")).toEqual(["会議"]);
    expect(q("")).toHaveLength(2);
    expect(fold("ＡＢＣ")).toBe("abc");
  });

  it("narrows by level and by section together", () => {
    expect(filterWords(words, { query: "", level: "J1", section: null }).map((w) => w.term)).toEqual(["引き継ぎ"]);
    expect(filterWords(words, { query: "", level: "J3", section: "dokkai" })).toHaveLength(2);
    expect(filterWords(words, { query: "", level: "J1", section: "dokkai" })).toHaveLength(0);
  });
});
