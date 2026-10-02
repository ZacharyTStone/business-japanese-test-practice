/**
 * The Arabic-numeral rule for printed text (bjt/render/numerals.ts).
 *
 * The cases here are the ones that decide whether the rule is safe to run over
 * the whole library: the words that merely contain a numeral character, the names
 * that keep their kanji, and idempotence — the offline check works by re-running
 * the converter, so a converter that moved on its own output would fail every
 * clean batch and corrupt every money value it touched.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as batch from "../bjt/batch.ts";
import { get, or, sorted } from "../bjt/py.ts";
import * as numerals from "../bjt/render/numerals.ts";
import * as schemas from "../bjt/schemas.ts";

const BATCHES = path.join(import.meta.dirname, "..", "batches");

// ----- what is a number -------------------------------------------------

describe("what is a number", () => {
  test.each([
    ["九月九日（火）", "9月9日（火）"],
    ["十時〜十二時", "10時〜12時"],
    ["九時三十分〜十六時三十分", "9時30分〜16時30分"],
    ["九月九日 九時十分", "9月9日 9時10分"],
    ["数量二百個の場合", "数量200個の場合"],
    ["椅子六十脚", "椅子60脚"],
    ["二十台から十六台に減らす", "20台から16台に減らす"],
    ["午前九時から午後三時まで", "午前9時から午後3時まで"],
    ["三階および四階", "3階および4階"],
    ["週二日までとする", "週2日までとする"],
    ["納期を一か月延ばし", "納期を1か月延ばし"],
    ["納品前に二週間", "納品前に2週間"],
    ["基礎研修 一日目", "基礎研修 1日目"],
    ["進行中（八割）", "進行中（8割）"],
    ["五十パーセント", "50パーセント"],
    ["一脚につき一枚ずつ", "1脚につき1枚ずつ"],
    ["二〇二六年", "2026年"],
    ["八月二十八日 十七時二十分", "8月28日 17時20分"],
    ["正午から一時は閉室", "正午から1時は閉室"],
  ])("numbers become digits [%s → %s]", (before, after) => {
    expect(numerals.toArabicText(before)).toBe(after);
  });

  /** 800万円, never 8000000円 — which is how a Japanese accountant writes it. */
  test.each([
    ["一万円以上の支出", "1万円以上の支出"],
    ["三十万円", "30万円"],
    ["予算は八百万円", "予算は800万円"],
    ["二十四万四千円", "24万4000円"],
    ["単価は千五百円まで", "単価は1500円まで"],
  ])("money keeps its myriad word [%s → %s]", (before, after) => {
    expect(numerals.toArabicText(before)).toBe(after);
  });
});

// ----- what is not a number ---------------------------------------------

describe("what is not a number", () => {
  test.each([
    ["九月分 発注一覧", "一覧"],      // 覧 is not a counter
    ["資料が一部足りません", "一部"],   // a copy, not one 部
    ["十分な時間がある", "十分な"],     // not ten minutes
    ["一時的な措置", "一時的"],        // not one o'clock
    ["一般のお客様", "一般"],
    ["一方の案", "一方"],
  ])("words that merely contain a numeral are left alone [%s / %s]", (text, word) => {
    expect(numerals.toArabicText(text)).toContain(word);
  });

  test("a real number beside such a word still moves", () => {
    expect(numerals.toArabicText("九月分 発注一覧")).toBe("9月分 発注一覧");
  });

  /** Without the 第 guard, 回 and 部 would renumber every meeting room in the
   *  library and the options naming them would stop matching the table. */
  test.each([
    "第一会議室", "第二会議室", "第一研修室",
    "第三回 設備改修 打ち合わせ 議事録", "第四回 案件N", "第二部",
  ])("ordinals in names keep their kanji [%s]", (name) => {
    expect(numerals.toArabicText(name)).toBe(name);
  });

  /** 二〇二六 concatenates because the 〇 says it is positional. 二三 does not:
   *  a multi-digit run with no 〇 in it is a Japanese speaker saying "two or
   *  three", so it is left alone rather than guessed at. */
  test.each([
    "二三日で終わります",   // two or three days, not the 23rd
    "四五人",            // four or five people
  ])("an approximate pair is not a multi digit number [%s]", (text) => {
    expect(numerals.toArabicText(text)).toBe(text);
  });

  /** Only the second half is followed by a counter, so without the guard this
   *  would produce 「二、3日」 — half an idiom, worse than no change at all. */
  test.each(["二、三日", "二，三名", "三、四か月"])("an approximate pair split by a comma is left whole [%s]", (text) => {
    expect(numerals.toArabicText(text)).toBe(text);
  });

  test.each(["案一", "案二", "案三"])("a bare label is not a number [%s]", (label) => {
    expect(numerals.toArabicText(label)).toBe(label);
  });
});

// ----- idempotence ------------------------------------------------------

describe("idempotence", () => {
  /** `20万円` read again offers its 万 as a fresh number; taking it would give
   *  `201万円`, and then `2011万円`. The check re-runs the converter, so this is
   *  the property that makes the check usable at all. */
  test.each([
    "20万円", "800万円", "24万4000円", "1万8000円×12", "21万6000円",
    "9月9日 9時10分", "10時〜12時", "万円",
  ])("converting twice changes nothing [%s]", (text) => {
    const once = numerals.toArabicText(text);
    expect(numerals.toArabicText(once)).toBe(once);
  });

  test("a bare myriad is not a quantity", () => {
    expect(numerals._value("万")).toBeNull();
    expect(numerals.toArabicText("万円")).toBe("万円");
  });
});

// ----- the document walk ------------------------------------------------

function _doc(): Record<string, any> {
  return {
    "template": "schedule",
    "title": "会議室 予約状況（九月九日）",
    "meta": [{ "label": "期間", "value": "九月九日（火）" }],
    "blocks": [
      { "type": "table",
        "columns": ["会議室", "十時〜十二時"],
        "rows": [["第一会議室", "空き"]] },
      { "type": "callout", "tone": "info",
        "text": "十七時までにお返しください。" },
    ],
  };
}

function _chartDoc(): Record<string, any> {
  return {
    "template": "figures",
    "title": "十月の実績",
    "meta": [],
    "blocks": [{
      "type": "chart", "kind": "bar", "caption": "上期（四月〜九月）の件数", "unit": "千件",
      "categories": ["四月", "五月", "第一四半期"],
      "series": [{ "name": "十月入社", "values": [3, 4, 5] },
                 { "name": "一覧", "values": [1, 2, 3] }],
    }],
  };
}

describe("the document walk", () => {
  test("to arabic reaches every printed field", () => {
    const doc = _doc();
    const moved = numerals.toArabic(doc);
    expect(moved).toBe(4);  // title, meta value, one column, the callout
    expect(doc["title"]).toBe("会議室 予約状況（9月9日）");
    expect(doc["meta"][0]["value"]).toBe("9月9日（火）");
    expect(doc["blocks"][0]["columns"]).toEqual(["会議室", "10時〜12時"]);
    expect(doc["blocks"][0]["rows"]).toEqual([["第一会議室", "空き"]]);
    expect(doc["blocks"][1]["text"]).toBe("17時までにお返しください。");
  });

  test("document faults names what is left", () => {
    expect(numerals.documentFaults(_doc())).toEqual(["九", "十", "十七", "十二"]);
    const clean = _doc();
    numerals.toArabic(clean);
    expect(numerals.documentFaults(clean)).toEqual([]);
  });

  test("to arabic survives a malformed document", () => {
    expect(numerals.toArabic("not a document")).toBe(0);
    expect(numerals.toArabic({ "title": "九月", "blocks": [null, { "type": "table" }] })).toBe(1);
    expect(numerals.toArabic({ "title": "", "blocks": [
      { "type": "chart", "categories": "九月", "series": [null, { "values": [1] }] }] })).toBe(0);
  });

  /** The labels under the bars are column headings by another name, the
   *  caption is a title, the legend is printed: 「四月」 there is the same fault
   *  it is anywhere on the page. The figures are numbers and never text. */
  test("a charts printed labels follow the rule and its figures are left alone", () => {
    const doc = _chartDoc();
    expect(numerals.documentFaults(doc)).toEqual(["九", "五", "十", "四"]);
    numerals.toArabic(doc);
    const block = doc["blocks"][0];
    expect(doc["title"]).toBe("10月の実績");
    expect(block["caption"]).toBe("上期（4月〜9月）の件数");
    expect(block["categories"]).toEqual(["4月", "5月", "第一四半期"]);   // an ordinal keeps its kanji
    expect(block["series"].map((s: any) => s["name"])).toEqual(["10月入社", "一覧"]);
    expect(block["series"].map((s: any) => s["values"])).toEqual([[3, 4, 5], [1, 2, 3]]);
    expect(numerals.documentFaults(doc)).toEqual([]);
  });

  /** 「単位：千円」 is thousands of yen. Read as a number it is 「単位：1000円」,
   *  which is a different and wrong sentence, so the unit is neither rewritten
   *  nor flagged. */
  test.each(["千件", "千円", "百万円", "万円", "%"])("a charts unit is a scale word and is left alone [%s]", (unit) => {
    const doc = _chartDoc();
    [doc["title"], doc["blocks"][0]["unit"]] = ["実績", unit];
    [doc["blocks"][0]["caption"], doc["blocks"][0]["categories"]] = ["件数", ["4月", "5月", "6月"]];
    doc["blocks"][0]["series"] = [{ "name": "", "values": [1, 2, 3] }];
    expect(numerals.documentFaults(doc)).toEqual([]);
    expect(numerals.toArabic(doc)).toBe(0);
    expect(doc["blocks"][0]["unit"]).toBe(unit);
  });

  /** `batch.normaliseNumerals` is the one funnel every item passes through;
   *  it reaches a chart because `toArabic` does. */
  test("the bundle normalises a chart on the way in", () => {
    const item = _item("shiryou_choudokkai", { document: _chartDoc() });
    batch.normaliseNumerals(item);
    expect(item["document"]["blocks"][0]["categories"].slice(0, 2)).toEqual(["4月", "5月"]);
    expect(batch.normaliseNumerals(item)).toBe(0);
  });
});

// ----- the item-level policy --------------------------------------------

function _item(itemType: string, over: Record<string, any> = {}): Record<string, any> {
  const item: Record<string, any> = {
    "item_type": itemType,
    "stem": "九時に始めます。",
    "options": [{ "text": "十時から", "role": "correct", "why": "十時が正しい理由。" }],
    "explanation_ja": "十時が答え。",
    "explanation_en": "ten.",
    "document": _doc(),
  };
  Object.assign(item, over);
  return item;
}

describe("the item-level policy", () => {
  /** joukyou_haaku narrates its stem, and a clip id hashes its text. */
  test("a spoken stem is never rewritten", () => {
    const item = _item("joukyou_haaku");
    batch.normaliseNumerals(item);
    expect(item["stem"]).toBe("九時に始めます。");          // spoken — untouched
    expect(item["options"][0]["text"]).toBe("10時から");   // printed — moved
    expect(item["options"][0]["why"]).toBe("10時が正しい理由。");
    expect(item["explanation_ja"]).toBe("10時が答え。");
    expect(item["document"]["title"]).toBe("会議室 予約状況（9月9日）");
  });

  /** sougou_dokkai has no audio at all, so its stem is on the screen. */
  test("a printed stem is rewritten", () => {
    const item = _item("sougou_dokkai");
    batch.normaliseNumerals(item);
    expect(item["stem"]).toBe("9時に始めます。");
  });

  /** 表現読解's options are utterances, and 語彙・文法's are the question being
   *  asked (「十二台」 against 「十二枚」). Nothing on screen contradicts them. */
  test("a type with no document is out of scope", () => {
    const item = _item("hyougen", { document: null });
    delete item["document"];
    expect(batch.normaliseNumerals(item)).toBe(0);
    expect(item["stem"]).toBe("九時に始めます。");
    expect(item["options"][0]["text"]).toBe("十時から");
  });

  test("normalising twice moves nothing the second time", () => {
    const item = _item("joukyou_haaku");
    expect(batch.normaliseNumerals(item)).toBeGreaterThan(0);
    expect(batch.normaliseNumerals(item)).toBe(0);
  });
});

// ----- the library ------------------------------------------------------

const COMMITTED = sorted(readdirSync(BATCHES).filter((n) => n.endsWith(".json") && !n.endsWith(".source.json")))
  .map((n) => path.join(BATCHES, n));

describe("the library", () => {
  /** The whole point, asserted over the library rather than over a sample. */
  test.each(COMMITTED.map((p) => [path.basename(p), p]))("every committed bundle reads like print [%s]", (_name, p) => {
    const bundle = JSON.parse(readFileSync(p, "utf8"));
    const report = batch.checkBundle(bundle);
    const numeralChecks = report.checks.filter((c) => c.name === "numbers are written as digits");
    expect(numeralChecks.every((c) => c.status === "pass"),
           JSON.stringify(numeralChecks.filter((c) => c.status !== "pass").map((c) => c.detail))).toBe(true);
  });

  test.each(COMMITTED.map((p) => [path.basename(p), p]))("no committed document spells a number out [%s]", (_name, p) => {
    const bundle = JSON.parse(readFileSync(p, "utf8"));
    for (const item of or(get(bundle, "items"), []) as Record<string, any>[]) {
      for (const doc of schemas.documentsOf(batch.asGeneratorShape(item))) {
        expect(numerals.documentFaults(doc), `${item["id"]}: ${get(doc, "title")}`).toEqual([]);
      }
    }
  });
});
