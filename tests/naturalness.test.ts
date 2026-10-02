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
