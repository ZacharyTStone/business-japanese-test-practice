/**
 * The naturalness rules: the offline lint, the prompt every generator is given,
 * and the proofreader's naturalness questions.
 *
 * Every pattern here is tested against a line taken from a question that was
 * withdrawn for it (batches/withdrawn.txt), so a pattern that stops catching the
 * thing it was written for fails here — and against a line that must still pass,
 * so one that starts catching natural Japanese fails too.
 */
import { describe, expect, test } from "vitest";
import * as batch from "../bjt/batch.ts";
import * as fixtures from "../bjt/fixtures.ts";
import * as llm from "../bjt/llm.ts";
import { deepcopy, sorted } from "../bjt/py.ts";
import * as seedtable from "../bjt/seedtable.ts";
import * as withdrawn from "../bjt/withdrawn.ts";
import * as naturalness from "../bjt/fidelity/naturalness.ts";
import * as sanity from "../bjt/fidelity/sanity.ts";
import { GENERATORS, getGenerator } from "../bjt/generators/index.ts";
import { patch } from "./helpers.ts";

type Item = Record<string, any>;

function _item(itemType: string): Item {
  return deepcopy(fixtures.FIXTURES[itemType]);
}

function _withOption(itemType: string, text: string, opts: { role?: string | null; index?: number } = {}): Item {
  const index = opts.index ?? 1;
  const item = _item(itemType);
  item["options"][index]["text"] = text;
  if (opts.role) {
    item["options"][index]["role"] = opts.role;
  }
  return item;
}

describe("naturalness", () => {
  // ----- the lint ---------------------------------------------------------------

  test.each(sorted(Object.keys(fixtures.FIXTURES)))("every worked fixture is clean %s", (itemType) => {
    expect(naturalness.faults(_item(itemType))).toEqual([]);
  });

  test.each([
    "課長、会議室の鍵をお借りさせていただかせていただいてもよろしいでしょうか。",
    "ご希望に沿わせていただくことができかねさせていただきます。",
    "いつもお世話になっております。ABC商事の鈴木と申させていただきます。",
    "本日はお忙しい中、お時間をいただかれまして、ありがとうございました。",
  ])("invented keigo is caught %s", (line) => {
    const found = naturalness.faults(_withOption("hatsugen_choukai", line));
    expect(found.length > 0 && found[0].includes("keigo no speaker produces")).toBe(true);
  });

  test.each([
    // Real over-politeness: one common 二重敬語, or a formula out of its place.
    "恐れ入りますが、ただいまおっしゃられた期日をもう一度お聞かせ願えませんでしょうか。",
    "どうぞ、冷めないうちにお召し上がりになられてください。",
    "このたびは格別のご高配を賜りまして、誠にありがとうございました。",
    "差し支えなければ、設営のほうは私にお任せいただけませんでしょうか。",
    // And the ordinary uses of the words the patterns are built from.
    "お忙しいところ、確認させていただきました。",
    "お時間をいただき、ありがとうございました。",
  ])("real over politeness is left alone %s", (line) => {
    expect(naturalness.faults(_withOption("hatsugen_choukai", line))).toEqual([]);
  });

  test("a deliberate non word is exempt", () => {
    // 語彙・文法's nonexistent_form distractor is built not to be a word.
    const item = _item("goi_bunpou");
    const target = item["options"].find((o: Item) => o["role"] === "nonexistent_form");
    target["text"] = "いただかれ";
    expect(naturalness.faults(item)).toEqual([]);
  });

  test("a placeholder is caught anywhere", () => {
    const item = _withOption("hatsugen_choukai", "いつもお世話になっております。〇〇商事の田中です。");
    expect(naturalness.faults(item).some((f) => f.includes("placeholder"))).toBe(true);
    const doc = _item("sougou_dokkai");
    doc["document"]["title"] = "○○株式会社 御中";
    expect(naturalness.faults(doc).some((f) => f.includes("placeholder"))).toBe(true);
  });

  test("brackets are caught only where they are heard", () => {
    const heard = _item("joukyou_haaku");
    heard["stem"] = heard["stem"].replace("来客の男の人", "来客（男の人）");
    expect(heard["stem"]).toContain("（");
    expect(naturalness.faults(heard).some((f) => f.includes("cannot hear"))).toBe(true);

    // A 表現読解 stem is read, not heard: brackets on a page are fine.
    const read = _item("hyougen");
    read["stem"] = "（社外）" + read["stem"];
    expect(naturalness.faults(read)).toEqual([]);
  });

  test.each([
    "この度は私の不徳の致すところで、誠に慙愧に堪えない失態を演じてしまいましたこと、幾重にもお詫び申し上げます。",
    "誠に僭越ながら申し上げますが、御見積書の数量表記に些少の齟齬が生じておられるやに拝察いたしますゆえ、ご訂正賜れますと幸甚に存じます。",
    "誠に恐縮至極ではございますが、僭越ながら次回の商談の件、少々お時間を頂戴いたしたく、伏してお願い申し上げる次第でございます。",
  ])("a parody chain of set phrases is caught %s", (line) => {
    expect(naturalness.faults(_withOption("hatsugen_choukai", line)).some((f) => f.includes("parody"))).toBe(true);
  });

  test.each([
    // One formula out of its place is the over-polite distractor people produce.
    "私の不徳の致すところで、誠に申し訳ございません。",
    "僭越ながら、乾杯の音頭を取らせていただきます。",
    "大変僭越ながら申し上げますが、提案書に誤植が見受けられますので、ご確認いただければ幸いに存じます。",
  ])("one set phrase is left alone %s", (line) => {
    expect(naturalness.faults(_withOption("hatsugen_choukai", line))).toEqual([]);
  });

  test("a word only letters use is caught only where it is heard", () => {
    const heard = _withOption(
      "hatsugen_choukai",
      "大変僭越ながら申し上げますが、貴殿の提案書に誤植が見受けられますので、ご確認いただければ幸いに存じます。",
    );
    expect(naturalness.faults(heard).some((f) => f.includes("only letters use"))).toBe(true);

    // In a letter, 貴殿 is where it belongs.
    const read = _item("sougou_dokkai");
    read["document"]["title"] = "貴殿の益々のご清栄をお慶び申し上げます";
    expect(naturalness.faults(read)).toEqual([]);
  });

  test("an honorific on a thing is caught", () => {
    const item = _withOption(
      "hatsugen_choukai",
      "恐れ入ります。ただいま宅配便がお見えになりましたので、少々お時間を頂戴いたしたく存じます。",
    );
    expect(naturalness.faults(item).some((f) => f.includes("honorific on a thing"))).toBe(true);
    for (const line of ["恐れ入ります。宅配便が参りましたので、五分ほど席を外してもよろしいでしょうか。",
                        "山川商事の佐藤様がお見えになりました。"]) {
      expect(naturalness.faults(_withOption("hatsugen_choukai", line))).toEqual([]);
    }
  });

  test("a phrase that cancels itself is caught", () => {
    const item = _item("hyougen");
    item["stem"] = "前任の後任であることを伝えて、挨拶のメールを書きます。";
    expect(naturalness.faults(item).some((f) => f.includes("cancels itself"))).toBe(true);
    item["stem"] = "前任の佐藤の後任であることを伝えて、挨拶のメールを書きます。";
    expect(naturalness.faults(item)).toEqual([]);
  });

  test("役不足 said of oneself is caught unless it is the word-choice distractor", () => {
    const line = "せっかくのお申し出ではございますが、私では役不足でございますので、どうかご容赦くださいませ。";
    const item = _withOption("hatsugen_choukai", line, { role: "over_polite_misfit" });
    expect(naturalness.faults(item).some((f) => f.includes("役不足"))).toBe(true);
    // Marked wrong for being the misuse, it teaches the right word.
    expect(naturalness.faults(_withOption("hatsugen_choukai", line, { role: "real_form_wrong_context" }))).toEqual([]);
    for (const ok of ["申し訳ありません、私には荷が重く、力不足ですので。",
                      "この程度の仕事では、彼には役不足だろう。"]) {
      expect(naturalness.faults(_withOption("hatsugen_choukai", ok))).toEqual([]);
    }
  });

  test("a weekday passed on as hearsay is caught", () => {
    const item = _withOption(
      "hatsugen_choukai",
      "あの品物、結局いつ着くことになっているんですか。十八日が金曜だとかで、そのあと二十日の日曜も挟みますよね。",
    );
    expect(naturalness.faults(item).some((f) => f.includes("hearsay"))).toBe(true);
    for (const ok of ["十八日が金曜なので、発送は週明けになります。",
                      "会議は十八日だそうです。",
                      "先方の話では、納品は来週の金曜日になるそうです。"]) {
      expect(naturalness.faults(_withOption("hatsugen_choukai", ok))).toEqual([]);
    }
  });

  /** A 語彙・文法 item: the carrier sentence, its key, and one distractor. */
  function _blank(stem: string, key: string, other: string, role = "real_form_wrong_context"): Item {
    const item = _item("goi_bunpou");
    item["stem"] = stem;
    item["options"][0]["text"] = key;
    item["options"][1]["text"] = other;
    item["options"][1]["role"] = role;
    return item;
  }

  test.each([
    ["お見積書を同封いたしましたので、ご確認＿＿＿ようお願い申し上げます。", "いただきます", "くださいます"],
    ["本日の会議には、お客様が＿＿＿いらっしゃる予定です。", "三名", "三人"],
    ["先方の承認が＿＿＿、来月一日から新しい手順に切り替える。", "得られれば", "得られたら"],
  ])("a distractor that is the key with a standard swap is caught %s", (stem, key, other) => {
    expect(naturalness.faults(_blank(stem, key, other)).some((f) => f.includes("standard wording swapped"))).toBe(true);
  });

  test("a whole-sentence twin is caught as well", () => {
    const item = _item("hyougen");
    const key = item["options"].findIndex((o: Item) => o["role"] === "correct");
    const other = key === 0 ? 1 : 0;
    item["options"][key]["text"] = "お手数ですが、ご確認いただきますようお願いいたします。";
    item["options"][other]["text"] = "お手数ですが、ご確認くださいますようお願いいたします。";
    expect(naturalness.faults(item).some((f) => f.includes(`option ${other + 1}`))).toBe(true);
  });

  test.each([
    // A different form, not a swap of the same one.
    ["先方の承認が＿＿＿、来月一日から新しい手順に切り替える。", "得られれば", "得られるなら"],
    // たら does not fit 〜れば〜ほど or 〜ればこそ.
    ["＿＿＿考えるほど、分からなくなる。", "考えれば", "考えたら"],
    ["信頼して＿＿＿こそ、お任せするのです。", "いれば", "いたら"],
    // 何名様 is a formula; 何人様 is not its twin.
    ["いらっしゃいませ。＿＿＿でいらっしゃいますか。", "何名様", "何人様"],
    // ば is the narrower: a key in たら does not make a ば distractor right.
    ["会議が＿＿＿、すぐにご連絡します。", "終わったら", "終われば"],
  ])("a distractor that only looks like a twin is left alone %s", (stem, key, other) => {
    expect(naturalness.faults(_blank(stem, key, other))).toEqual([]);
  });

  test.each([
    ["f82e71e147", "役不足"],
    ["f760e4e239", "hearsay"],
    ["016554fd7e", "standard wording swapped"],
    ["a4d0177c61", "standard wording swapped"],
    ["c1e08d21fa", "standard wording swapped"],
  ])("the withdrawn question a pattern was written for is still caught %s", (id, says) => {
    let item: Item | undefined;
    for (const p of batch.bundles()) {
      item = (batch.load(p)["items"] as Item[]).find((it) => it["id"] === id);
      if (item !== undefined) {
        break;
      }
    }
    if (item === undefined) {
      throw new Error(`StopIteration: ${id} is in no bundle`);
    }
    expect(naturalness.faults(batch.asGeneratorShape(item)).some((f) => f.includes(says))).toBe(true);
  });

  test.each([
    ["受付の人は何をしていますか。", "来客が受付の人に行き方を教えています。"],
    ["ホワイトボードの前に立っている人は何をしていますか。", "座っている上司が立っている部下に指示を出しています。"],
    ["立っている人は何をしていますか。", "座っている人が立っている人に書類を渡しています。"],
    ["社員は何をしていますか。", "来客が社員に会議室までの道を尋ねています。"],
    ["左の人は何をしていますか。", "右の人がメモを取りながら話を聞いています。"],
  ])("a picture option about somebody else is caught %s", (stem, line) => {
    const item = _withOption("gazou_haaku", line, { role: "wrong_participants" });
    item["stem"] = stem;
    expect(naturalness.faults(item).some((f) => f.includes("is about"))).toBe(true);
  });

  test.each([
    // About the person asked after, wrong in what they do or to whom.
    ["受付の人は何をしていますか。", "来客から行き方を教わっています。"],
    // A clause with its own subject is not a sentence about somebody else.
    ["ホワイトボードの前に立っている人は何をしていますか。", "会議が終わってホワイトボードを消しています。"],
    // The person asked after, named as the subject.
    ["立っている人は何をしていますか。", "立っている人が座っている人に書類を渡しています。"],
  ])("a picture option about the person asked after is left alone %s", (stem, line) => {
    const item = _withOption("gazou_haaku", line, { role: "wrong_participants" });
    item["stem"] = stem;
    expect(naturalness.faults(item)).toEqual([]);
  });

  test("a narration that says the answer is caught", () => {
    const item = _item("bamen_haaku");
    const answer = item["options"][0];
    expect(answer["role"]).toBe("correct");
    item["stem"] = `${answer["text"]}ところです。` + item["stem"];
    expect(naturalness.faults(item).some((f) => f.includes("says the answer"))).toBe(true);
  });

  test("the first generated answer in the narration is the one withdrawn", () => {
    // The pattern was written for this item; it must keep catching it.
    let item: Item | undefined;
    for (const p of batch.bundles()) {
      item = (batch.load(p)["items"] as Item[]).find((it) => it["id"] === "c21b2af994");
      if (item !== undefined) {
        break;
      }
    }
    if (item === undefined) {
      throw new Error("StopIteration: c21b2af994 is in no bundle");
    }
    expect(naturalness.faults(batch.asGeneratorShape(item)).some((f) => f.includes("says the answer"))).toBe(true);
  });

  test("every item with a tell is withdrawn and every served item is clean", () => {
    // The ledger is compulsory: a committed item the lint catches is either in
    // batches/withdrawn.txt or failing CI.
    const ledger = withdrawn.ids();
    const caught = new Set<string>();
    const servedDirty: string[] = [];
    for (const p of batch.bundles()) {
      for (const it of batch.load(p)["items"] as Item[]) {
        if (naturalness.faults(batch.asGeneratorShape(it)).length > 0) {
          caught.add(it["id"]);
          if (!ledger.has(it["id"])) {
            servedDirty.push(it["id"]);
          }
        }
      }
    }
    expect(servedDirty).toEqual([]);
    expect(caught.size > 0, "the lint catches nothing in the library — did a pattern stop working?").toBe(true);
  });

  // ----- the generator ----------------------------------------------------------

  test.each(sorted(Object.keys(GENERATORS)))("every generator is told the rules %s", (itemType) => {
    expect(getGenerator(itemType).systemPrompt("J2")).toContain(naturalness.PROMPT);
  });

  test("a draft with a tell is sent back with the reason", async () => {
    const cell = seedtable.load("hatsugen_choukai").cells({ level: "J2" })[0];
    const prompts: string[] = [];

    const fake = async (system: string, user: string, schema: Record<string, unknown>) => {
      prompts.push(user);
      const item = _item("hatsugen_choukai");
      item["scene_id"] = cell.scenes[0];
      item["channel"] = cell.channel;
      if (prompts.length === 1) {
        item["options"][1]["text"] = "課長、少し体調が悪いので、早退させていただかせていただいてもよろしいでしょうか。";
      }
      return item;
    };

    patch(llm, "generateStructured", fake);
    const item = await getGenerator("hatsugen_choukai").generate({ cell, seed: 0 });
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toContain("keigo no speaker produces");
    expect(naturalness.faults(item)).toEqual([]);
  });

  // ----- the proofreader ------------------------------------------------------

  test("the proofreader is asked about naturalness", () => {
    for (const rule of ["unnatural_japanese", "situation_incoherent"]) {
      expect(Object.keys(sanity.RULES)).toContain(rule);
    }
  });

  test("the proofreader sees each options role", () => {
    // Without it a deliberate non-word and a mistake look the same.
    const item = _item("goi_bunpou");
    const text = sanity.renderForSanity(item);
    for (const o of item["options"] as Item[]) {
      expect(text).toContain(`${o["text"]}　［${o["role"]}］`);
    }
  });
});
