/**
 * Generator loop: validation, retry-on-invalid, shuffle, finalize. The model
 * call is faked.
 */
import { describe, expect, test } from "vitest";
import * as fixtures from "../bjt/fixtures.ts";
import * as llm from "../bjt/llm.ts";
import * as phrasebook from "../bjt/phrasebook.ts";
import { deepcopy, replace, rstrip, sorted, truthy, ValueError, KeyError } from "../bjt/py.ts";
import * as schemas from "../bjt/schemas.ts";
import * as seedtable from "../bjt/seedtable.ts";
import * as roles from "../bjt/fidelity/roles.ts";
import * as answerability from "../bjt/fidelity/answerability.ts";
import { GENERATORS, getGenerator } from "../bjt/generators/index.ts";
import {
  _SENTENCE,
  dropSentencesAbout,
  Generator,
  repairSurplusOptions,
} from "../bjt/generators/base.ts";
import { fixtureItem, goiCell, goiItem, store } from "./conftest.ts";
import { patch } from "./helpers.ts";

type Item = Record<string, any>;

/** `"".join(_SENTENCE.findall(t))`. */
function _findall(re: RegExp, t: string): string[] {
  return [...t.matchAll(re)].map((m) => m[0]);
}

describe("generators", () => {
  test("a valid draft becomes an item on its cell with exactly one correct option", async () => {
    const cell = goiCell();
    patch(llm, "generateStructured", async () => fixtureItem("goi_bunpou"));
    const item = await getGenerator("goi_bunpou").generate({ cell, seed: 0 });
    expect(item["level"]).toBe("J2");
    expect(item["seed_cell"]["id"]).toBe(cell.id);
    expect(item["item_type"]).toBe("goi_bunpou");
    expect(item["options"].length).toBe(4);
    // exactly one correct survives the shuffle
    expect(item["options"].filter((o: Item) => o["role"] === roles.CORRECT).length).toBe(1);
    expect(schemas.validateItem("goi_bunpou", item)).toEqual([]);
  });

  test("retries on invalid then succeeds", async () => {
    const cell = goiCell();
    const calls = { n: 0 };

    const fake = async () => {
      calls.n += 1;
      if (calls.n === 1) {
        const bad = fixtureItem("goi_bunpou");
        bad["options"][1]["role"] = "correct"; // now two correct -> invalid
        return bad;
      }
      return fixtureItem("goi_bunpou");
    };

    patch(llm, "generateStructured", fake);
    const item = await getGenerator("goi_bunpou").generate({ cell, seed: 0 });
    expect(calls.n).toBe(2);
    expect(schemas.validateItem("goi_bunpou", item)).toEqual([]);
  });

  test("raises after max attempts", async () => {
    const cell = goiCell();
    const alwaysBad = async () => {
      const bad = fixtureItem("goi_bunpou");
      bad["options"] = bad["options"].slice(0, 3); // only 3 options -> always invalid
      return bad;
    };

    patch(llm, "generateStructured", alwaysBad);
    await expect(getGenerator("goi_bunpou").generate({ cell, maxAttempts: 2 })).rejects.toThrow(llm.LLMError);
  });

  test("rejects bad level", async () => {
    const bad = replace(goiCell(), { level: "J9" });
    const err = await getGenerator("goi_bunpou").generate({ cell: bad }).catch((e) => e);
    expect(err).toBeInstanceOf(ValueError);
    expect(err.message).toMatch(/invalid level/);
  });

  test.each(sorted(Object.keys(GENERATORS)))("every generator refuses to run without its cell %s", async (itemType) => {
    // Variety is a property of the seed table, not of the prompt. A generator
    // that will quietly write an item without an assignment is one that will
    // produce the same three scenarios forever, so every type declares a table and
    // refuses without a cell from it.
    const gen = getGenerator(itemType);
    expect(gen.requires_cell, `${itemType} has no seed table backing it`).toBe(true);
    await expect(gen.generate({ level: "J2" })).rejects.toThrow(ValueError);
  });

  test("avoid topics flow into prompt", async () => {
    const s = store();
    const item0 = goiItem();
    const cell = goiCell();
    item0["topic"] = "納期の連絡";
    s.insertItem("goi_bunpou", "J2", item0, "m");
    const gen = getGenerator("goi_bunpou", { store: s });
    const captured: Record<string, string> = {};

    const fake = async (system: string, user: string) => {
      captured["user"] = user;
      return fixtureItem("goi_bunpou");
    };

    patch(llm, "generateStructured", fake);
    await gen.generate({ cell, seed: 0 });
    expect(captured["user"]).toContain("納期の連絡"); // recent topic fed back as do-not-repeat
  });

  test("system prompt contains role spec and fewshot", () => {
    const sp = getGenerator("hyougen").systemPrompt("J2");
    expect(sp).toContain("wrong_honorific_direction");
    expect(sp.toLowerCase()).toContain("distractor role");
  });

  test("unknown item type", () => {
    expect(() => getGenerator("nope")).toThrow(KeyError);
  });

  test("finalize shuffle is deterministic with seed", () => {
    class G extends Generator {
      override item_type = "goi_bunpou";
    }
    const a = new G()._finalize(fixtureItem("goi_bunpou"), "J2", 42);
    const b = new G()._finalize(fixtureItem("goi_bunpou"), "J2", 42);
    expect(a["options"].map((o: Item) => o["text"])).toEqual(b["options"].map((o: Item) => o["text"]));
  });

  test("blank document block is pruned not retried", async () => {
    // The model's output does not carry item_type (the schema has no such
    // field); the generator stamps it. The pruning of blank headings and callouts
    // looks a document up by type, so it must run after the stamp; otherwise
    // every blank callout costs the full three attempts and produces nothing.
    const cell = seedtable.load("joukyou_haaku").cells({ level: "J2" })[0];
    const calls = { n: 0 };

    const fake = async () => {
      calls.n += 1;
      const item = fixtureItem("joukyou_haaku");
      delete item["item_type"]; // as the model returns it
      item["document"]["blocks"].splice(1, 0, { "type": "callout", "text": "" });
      return item;
    };

    patch(llm, "generateStructured", fake);
    const item = await getGenerator("joukyou_haaku").generate({ cell, seed: 0 });
    expect(calls.n).toBe(1);
    expect(item["item_type"]).toBe("joukyou_haaku");
    expect(
      item["document"]["blocks"].filter((b: Item) => b["type"] === "callout").every((b: Item) => truthy(b["text"])),
    ).toBe(true);
    expect(schemas.validateItem("joukyou_haaku", item)).toEqual([]);
  });

  // ----- cheaper drafts: repair, feedback, stock lines ---------------------------

  test("a fifth option is trimmed not regenerated", async () => {
    // The schema cannot say maxItems, so a spare distractor is the one shape
    // fault the model can still produce. Regenerating for it can cost three
    // generations for a shelf that then writes nothing, so the spare is dropped
    // and the draft goes on to the checks.
    const cell = goiCell();
    const calls = { n: 0 };

    const fake = async () => {
      calls.n += 1;
      const item = fixtureItem("goi_bunpou");
      const spare = { ...item["options"][1] };
      spare["text"] = "余分な選択肢";
      item["options"].push(spare); // a duplicate role, so it is the one to drop
      return item;
    };

    patch(llm, "generateStructured", fake);
    const item = await getGenerator("goi_bunpou").generate({ cell, seed: 0 });
    expect(calls.n).toBe(1);
    expect(item["options"].length).toBe(4);
    expect(item["options"].map((o: Item) => o["text"])).not.toContain("余分な選択肢");
    expect(schemas.validateItem("goi_bunpou", item)).toEqual([]);

    // Fewer than four, or two correct, is left for the validator to reject.
    const short = fixtureItem("goi_bunpou"); short["options"].pop();
    expect(repairSurplusOptions(short)).toEqual([]);
    expect(short["options"].length).toBe(3);
    const two = fixtureItem("goi_bunpou"); two["options"].push({ ...two["options"][0], text: "x" });
    expect(repairSurplusOptions(two)).toEqual([]);
    expect(two["options"].length).toBe(5);
  });

  test("the explanation loses what it said about a trimmed option", () => {
    // The 解説 is written about all five options, so a trimmed option's
    // sentences go with it. Left in, they described an option the item no longer
    // has, and the proofreader rejected every 表現読解 J3 draft as
    // explanation_mismatch — the trim saved nothing.
    const item = fixtureItem("goi_bunpou");
    const spare = { ...item["options"][1], text: "本日は遅れられまして申し訳ございません。" };
    item["options"].push(spare); // a duplicate role, so it is the one dropped
    const correct = item["options"].find((o: Item) => o["role"] === roles.CORRECT)["text"];
    item["explanation_ja"] = (`正解は「${rstrip(correct, "。")}」。`
                              + "「遅れられまして」は二重敬語で、誤り。\n"
                              + "ほかの選択肢は場面に合わない。");
    item["explanation_en"] = "The key fits. 「遅れられまして」 is a double honorific. Others misfit.";
    expect(repairSurplusOptions(item)).toEqual([spare["text"]]);
    expect(item["explanation_ja"]).not.toContain("遅れられまして");
    expect(item["explanation_ja"].startsWith("正解は「") && item["explanation_ja"].includes("ほかの選択肢")).toBe(true);
    expect(item["explanation_en"]).toBe("The key fits. Others misfit.");
  });

  test("a sentence about a kept option stays and text is never rewritten", () => {
    const [kept, dropped] = [["明日は10時に伺います。"], ["明日伺えますか。"]];
    // 「明日」 is in both, so a sentence quoting only that is not about the dropped one.
    const text = "「明日」の言い方に注意。「伺えますか」は依頼になっている。";
    expect(dropSentencesAbout(text, dropped, kept)).toBe("「明日」の言い方に注意。");
    // Nothing about a dropped option: the text comes back untouched, 1.5 and all.
    const same = "Option A fits, at 1.5 times the cost.\nB is rude.";
    expect(dropSentencesAbout(same, dropped, kept)).toBe(same);
    // Every sentence about the dropped option: kept as it was, for the proofreader.
    expect(dropSentencesAbout("「伺えますか」は依頼。", dropped, kept)).toBe("「伺えますか」は依頼。");
    for (const t of ["一。二！三？", "A. B.\nC", "1.5 stays", ""]) {
      expect(_findall(_SENTENCE, t).join("")).toBe(t);
    }
  });

  test("the prompt asks for four options whatever the role count", () => {
    // Every type offers four or more distractor roles; told only to use three
    // distinct ones, the model wrote one option per role — five — often enough
    // that 表現読解 lost whole nights to it.
    for (const itemType of ["hyougen", "goi_bunpou", "hatsugen_choukai", "gazou_haaku"]) {
      const sp = getGenerator(itemType).systemPrompt("J2");
      expect(sp.includes("exactly FOUR options") && sp.includes("never write one option per role")).toBe(true);
    }
  });

  test("review feedback reaches the next prompt", async () => {
    const cell = goiCell();
    const seen: Record<string, string> = {};

    const fake = async (system: string, user: string) => {
      seen["user"] = user;
      return fixtureItem("goi_bunpou");
    };

    patch(llm, "generateStructured", fake);
    await getGenerator("goi_bunpou").generate({ cell, seed: 0,
                                                feedback: "the distractors gave the answer away" });
    expect(seen["user"]).toContain("REJECTED by review: the distractors gave the answer away");
    await getGenerator("goi_bunpou").generate({ cell, seed: 0 });
    expect(seen["user"]).not.toContain("REJECTED");
  });

  test("the stock lines are shown to the spoken types only", () => {
    const spoken = getGenerator("hatsugen_choukai").systemPrompt("J2");
    expect(spoken).toContain(phrasebook.STOCK_LINES[0]);
    const read = getGenerator("goi_bunpou").systemPrompt("J2");
    expect(read).not.toContain(phrasebook.STOCK_LINES[0]);
    expect(read).not.toContain("Stock phrases");
  });

  test("library lines are the ones the bank already repeats", () => {
    for (const line of phrasebook.libraryLines({ minCount: 2 })) {
      expect(phrasebook.STOCK_LINES).not.toContain(line);
    }
    // With the bar at one, every spoken line of the bank qualifies, and the
    // list is capped so the prompt stays small.
    expect(phrasebook.libraryLines({ minCount: 1, limit: 5 }).length).toBeLessThanOrEqual(5);
  });

  // ----- graphs in the 資料 ------------------------------------------------------

  const CHART_GUIDANCE = "A `chart` block draws figures";

  function _cell(itemType: string, setting: string): seedtable.Cell {
    const cell = seedtable.load(itemType).cells({ level: "J2" }).find((c) => c.setting === setting);
    if (cell === undefined) {
      throw new Error(`StopIteration: no J2 cell of ${itemType} in ${setting}`);
    }
    return cell;
  }

  test.each([
    ["shiryou_choudokkai", "figures_meeting", true],     // figures only
    ["shiryou_choudokkai", "meeting_handout", true],     // figures among others
    ["shiryou_choudokkai", "quotation", false],          // a quotation cannot carry one
    ["sougou_choudokkai", "regular_meeting", true],      // figures and a progress report
    ["sougou_choudokkai", "client_review", true],        // a progress report
    ["sougou_choudokkai", "negotiation", false],
    ["sougou_dokkai", "project_update", false],          // a reading type is never told
  ] as [string, string, boolean][])(
    "the chart guidance reaches a cell that can draw one and no other %s %s %s",
    (itemType, setting, told) => {
      // Telling a writer about graphs on a cell that assigns an email is asking
      // for a draft the validator will send back.
      const cell = _cell(itemType, setting);
      const prompt = getGenerator(itemType).userPrompt("J2", [], { cell });
      expect(prompt.includes(CHART_GUIDANCE)).toBe(told);
      if (told) {
        expect(prompt).toContain("neither the chart nor the audio answers alone");
        const carriers = cell.templates.filter((t) => ["figures", "progress_report"].includes(t));
        expect(prompt.split(CHART_GUIDANCE)[1]).toContain(`\`${carriers[0]}\``);
      }
    },
  );

  test("the listening and reading tables offer a graph at every level", () => {
    for (const itemType of ["shiryou_choudokkai", "sougou_choudokkai"]) {
      const table = seedtable.load(itemType);
      for (const level of table.levels) {
        expect(table.cells({ level }).some((c) => c.templates.includes("figures")), `${itemType} ${level}`).toBe(true);
      }
    }
  });

  function _chartDraft(changes: Item = {}): Item {
    const item = deepcopy(fixtures.CHART_FIXTURE);
    delete item["item_type"];          // as the model returns it
    Object.assign(item, changes);
    return item;
  }

  test("a generated chart is written like print before anyone judges it", async () => {
    // The generator normalises numbers before the gate, the proofreader and
    // the discriminator see a draft — a chart's labels included — so all three
    // judge the item as it will ship.
    const cell = _cell("shiryou_choudokkai", "figures_meeting");
    const draft = _chartDraft();
    const chart = draft["document"]["blocks"][0];
    chart["categories"] = ["四月", "五月", "六月", "七月", "八月", "九月"];
    chart["caption"] = "月別 問い合わせ件数（四月〜九月）";
    patch(llm, "generateStructured", async () => draft);
    const item = await getGenerator("shiryou_choudokkai").generate({ cell, seed: 0 });
    const got = item["document"]["blocks"][0];
    expect(got["categories"]).toEqual(["4月", "5月", "6月", "7月", "8月", "9月"]);
    expect(got["caption"]).toBe("月別 問い合わせ件数（4月〜9月）");
    expect(schemas.validateItem("shiryou_choudokkai", item)).toEqual([]);
  });

  test("a chart the template cannot carry is sent back with the reason", async () => {
    const cell = _cell("shiryou_choudokkai", "meeting_handout");
    const first = _chartDraft();
    first["document"]["template"] = "quote_order";
    first["document"]["meta"] = [{ "label": "宛先", "value": "みどり物産 御中" },
                                 { "label": "発行者", "value": "山川商事" },
                                 { "label": "発行日", "value": "10月1日" }];
    const drafts = [first, _chartDraft()][Symbol.iterator]();
    const prompts: string[] = [];

    const fake = async (system: string, user: string) => {
      prompts.push(user);
      return drafts.next().value!;
    };

    patch(llm, "generateStructured", fake);
    const item = await getGenerator("shiryou_choudokkai").generate({ cell, seed: 0 });
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toContain("does not carry one");
    expect(item["document"]["template"]).toBe("figures");
  });

  test("the picture options are told not to orbit the key", () => {
    // 画像把握 J1 lost every draft on three nights to the cold gate: each
    // distractor was the key with one thing changed, so the key was the core the
    // other three shared and a reader picked it without the picture.
    const sp = getGenerator("gazou_haaku").systemPrompt("J1");
    expect(sp).toContain("must not orbit the correct one");
    expect(sp).toContain("no element of the correct description may appear in all three distractors");
  });

  /** 2026-10-02 to 10-06: 15 of 22 nightly drafts leaked at the cold view.
   *  Every generator is told how the cold test guesses and how to write for
   *  it, in the words of the half its own cold view hides. */
  test("every generator is told how to pass the cold test", () => {
    for (const itemType of Object.keys(GENERATORS)) {
      const sp = getGenerator(itemType).systemPrompt("J2");
      expect(sp, itemType).toContain("The reviewer's cold test.");
      expect(sp, itemType).toContain(`with ${answerability.withheldHalf(itemType)} hidden`);
      // A tie, never "the key is the unlikely one": that would be a tell.
      expect(sp, itemType).toContain("At least one distractor must be an equally good guess");
    }
  });

});
