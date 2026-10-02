/**
 * Discriminator loop (fidelity #3). The judge is faked so scoring is
 * deterministic.
 */
import { describe, expect, test } from "vitest";
import * as fixtures from "../bjt/fixtures.ts";
import * as llm from "../bjt/llm.ts";
import { deepcopy, ValueError } from "../bjt/py.ts";
import * as textutil from "../bjt/textutil.ts";
import * as discriminator from "../bjt/fidelity/discriminator.ts";
import { patch } from "./helpers.ts";

function _makeItems(prefix: string, n: number): Record<string, any>[] {
  return Array.from({ length: n }, (_, i) => (
    { item_type: "goi_bunpou", level: "J2", stem: `${prefix}-${i}`,
      options: [{ text: "a" }], explanation_ja: "e" }
  ));
}

async function _perfectJudge(rendered: string[]): Promise<Record<string, any>> {
  // Generated stems contain 'GEN', official contain 'OFF'.
  const labels = rendered.map((r) => (r.includes("GEN") ? "synthetic" : "official"));
  return { labels: labels, reasons: ["stems differ"] };
}

async function _blindJudge(rendered: string[]): Promise<Record<string, any>> {
  return { labels: rendered.map(() => "official"), reasons: ["cannot tell"] };
}

describe("discriminator", () => {
  test("perfect judge scores 1", async () => {
    patch(llm, "judgeSynthetic", _perfectJudge);
    const gen = _makeItems("GEN", 4);
    const off = _makeItems("OFF", 4);
    const res = await discriminator.runDiscriminator("goi_bunpou", gen, off, { seed: 1 });
    expect(res.discrimination_rate).toBe(1.0);
    expect(res.n_generated === 4 && res.n_official === 4).toBe(true);
  });

  test("blind judge scores chance", async () => {
    // A judge that labels everything 'official' scores exactly the official
    // fraction — 50% with a balanced mix.
    patch(llm, "judgeSynthetic", _blindJudge);
    const gen = _makeItems("GEN", 5);
    const off = _makeItems("OFF", 5);
    const res = await discriminator.runDiscriminator("goi_bunpou", gen, off, { seed: 1 });
    expect(res.discrimination_rate).toBe(0.5);
  });

  test("requires both sides", async () => {
    await expect(discriminator.runDiscriminator("goi_bunpou", [], _makeItems("OFF", 2))).rejects.toThrow(ValueError);
  });

  test("misaligned label count scored on prefix", async () => {
    patch(llm, "judgeSynthetic", async (rendered: string[]) => {
      const first = rendered[0].includes("GEN") ? "synthetic" : "official";
      return { labels: [first], reasons: [] };
    });
    const res = await discriminator.runDiscriminator(
      "goi_bunpou", _makeItems("GEN", 2), _makeItems("OFF", 2), { seed: 1 },
    );
    // One right label: scored over the aligned prefix it is 1.0; counting the
    // three unlabelled items as wrong would make it 0.25.
    expect(res.discrimination_rate).toBe(1.0);
  });

  // ----- the judge sees the whole stimulus ---------------------------------

  function _documentItem(prefix: string, withDocument: boolean = true): Record<string, any> {
    const item: Record<string, any> = {
      item_type: "joukyou_haaku", level: "J2", stem: `${prefix}-stem`,
      options: [{ text: "a" }], explanation_ja: "e",
    };
    if (withDocument) {
      item["document"] = {
        template: "schedule", title: "会議室 予約状況",
        meta: [], blocks: [{ type: "table", columns: ["会議室", "10時〜12時"],
                             rows: [["第一会議室", "空き"]] }],
      };
    }
    return item;
  }

  test("the rendering carries the document", () => {
    // Without it, the four types whose stimulus is mostly a 資料 would be
    // judged on the stem and the options alone.
    const rendered = textutil.renderForDiscriminator(_documentItem("GEN"));
    expect(rendered).toContain("--- 資料 ---");
    expect(rendered).toContain("会議室 予約状況");
    expect(rendered).toContain("10時〜12時");
    expect(rendered).toContain("GEN-stem");
  });

  test("the rendering carries a charts figures", () => {
    // The discriminator sees what the learner sees, and a learner sees the
    // bars. A graph that reached the judge as its title alone could neither
    // lower the score nor be named as a tell.
    const rendered = textutil.renderForDiscriminator(deepcopy(fixtures.CHART_FIXTURE));
    expect(rendered).toContain("--- 資料 ---");
    expect(rendered).toContain("【棒グラフ】月別 問い合わせ件数（単位：件）");
    expect(rendered).toContain("電話：4月 330 / 5月 410");
  });

  test("the rendering carries the dialogue", () => {
    const item = _documentItem("GEN", false);
    item["dialogue"] = [{ speaker_role: "manager_m", text: "お願いします。" }];
    const rendered = textutil.renderForDiscriminator(item);
    expect(rendered).toContain("--- 会話 ---");
    expect(rendered).toContain("お願いします。");
  });

  test("an item with no document renders as before", () => {
    // No section markers for a type that has neither — 語彙・文法 is a stem and
    // four options, and dressing it up would be a tell of its own.
    const rendered = textutil.renderForDiscriminator(_makeItems("GEN", 1)[0]);
    expect(rendered.replaceAll("[goi_bunpou / J2]", "")).not.toContain("---");
  });

  test("refuses to score documents against samples that have none", async () => {
    // The official seed files arrive without the 資料 transcribed, so this
    // comparison is winnable on the shape of the seed file. Scoring it would put
    // a bogus 100% on the dashboard AND fold "has a 資料" into the generator
    // prompt as a tell to avoid.
    patch(llm, "judgeSynthetic", _perfectJudge);
    const err = await discriminator.runDiscriminator(
      "joukyou_haaku",
      [_documentItem("GEN")],
      [_documentItem("OFF", false)],
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValueError);
    expect((err as Error).message).toMatch(/資料/);
  });

  test("scores normally when both sides carry the document", async () => {
    patch(llm, "judgeSynthetic", _perfectJudge);
    const res = await discriminator.runDiscriminator(
      "joukyou_haaku", [_documentItem("GEN")], [_documentItem("OFF")], { seed: 1 },
    );
    expect(res.discrimination_rate).toBe(1.0);
  });

  test("official extras do not trip the guard", async () => {
    // The guard is about a stimulus WE add and the samples lack. An official
    // sample richer than our items is not a tell we created, so it scores.
    patch(llm, "judgeSynthetic", _blindJudge);
    const res = await discriminator.runDiscriminator(
      "joukyou_haaku",
      [_documentItem("GEN", false)],
      [_documentItem("OFF")], { seed: 1 },
    );
    expect(res.n_generated === 1 && res.n_official === 1).toBe(true);
  });
});
