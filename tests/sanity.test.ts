/**
 * The cheap proofreading pass (fidelity #6). The model call is faked, so what is
 * tested is the verdict logic, what the checker is shown, and — the part that
 * actually saves money — that a flagged item never reaches the answerability gate.
 */
import { beforeEach, describe, expect, test } from "vitest";
import * as fixtures from "../bjt/fixtures.ts";
import * as llm from "../bjt/llm.ts";
import * as pipeline from "../bjt/pipeline.ts";
import { deepcopy } from "../bjt/py.ts";
import * as schemas from "../bjt/schemas.ts";
import * as answerability from "../bjt/fidelity/answerability.ts";
import * as sanity from "../bjt/fidelity/sanity.ts";
import { goiItem, store } from "./conftest.ts";
import { patch, setConfig, tmpPath } from "./helpers.ts";

type SanityCheck = (rendered: string, rules: Record<string, string>, opts?: { model?: string | null }) => Promise<Record<string, any>>;

/** A stand-in for llm.sanityCheck that reports no fault unless told to. */
function _clean(overrides: Record<string, unknown> = {}): SanityCheck {
  const verdict: Record<string, any> = {};
  for (const rule of Object.keys(sanity.RULES)) {
    verdict[rule] = false;
  }
  verdict["notes"] = "";
  Object.assign(verdict, overrides);
  return async () => verdict;
}

describe("sanity", () => {
  // sanity_on (autouse)
  beforeEach(() => {
    setConfig({ SANITY_ENABLED: true });
  });

  // ----- the verdict --------------------------------------------------------

  test("clean item passes", async () => {
    patch(llm, "sanityCheck", _clean());
    const res = await sanity.runCheck(goiItem());
    expect(res.ok && res.checked).toBe(true);
    expect(res.faults).toEqual([]);
  });

  test("every rule can fail the item", async () => {
    const item = goiItem();
    for (const rule of Object.keys(sanity.RULES)) {
      patch(llm, "sanityCheck", _clean({ [rule]: true }));
      const res = await sanity.runCheck(item);
      expect(res.ok, rule).toBe(false);
      expect(res.faults).toEqual([rule]);
    }
  });

  test("unreachable model is not a pass", async () => {
    // An outage must not read as a clean item. `checked` is how the caller
    // tells 'nothing wrong with it' from 'nobody looked'.
    const boom = async () => {
      throw new llm.LLMError("api down");
    };

    patch(llm, "sanityCheck", boom);
    const res = await sanity.runCheck(goiItem());
    expect(res.checked).toBe(false);
    expect(res.ok).toBe(true);  // not discarded — the expensive gate still gets its turn
    expect(res.notes).toContain("did not run");
  });

  test("disabled does not call the model", async () => {
    const called: number[] = [];
    setConfig({ SANITY_ENABLED: false });
    patch(llm, "sanityCheck", async (rendered: string, rules: Record<string, string>) => {
      called.push(1);
      return _clean()(rendered, rules);
    });
    const res = await sanity.runCheck(goiItem());
    expect(called).toEqual([]);
    expect(res.checked).toBe(false);
  });

  // ----- what the checker is shown -----------------------------------------

  test("render shows the answer key and the explanation", () => {
    const item = goiItem();
    const text = sanity.renderForSanity(item);
    const ci = schemas.correctIndex(item["options"]);
    expect(text).toContain(item["stem"]);
    expect(text).toContain(`正解として印がついているのは: ${ci}.`);
    expect(text).toContain(item["explanation_ja"]);
    for (const o of item["options"]) {
      expect(text).toContain(o["text"]);
    }
  });

  test("render includes a document stimulus", () => {
    // A reading item whose document was invisible to the checker would be
    // proofread without the thing that makes its answer right.
    const item = deepcopy(fixtures.FIXTURES["sougou_dokkai"]);
    const text = sanity.renderForSanity(item);
    expect(text).toContain("--- 資料 ---");
    expect(text).toContain(item["document"]["title"]);
  });

  test("render includes a charts figures", () => {
    // A proofreader checking that the key is right needs the figures the key
    // was read from: a chart shown as its title would make every graph item look
    // like one whose marked answer cannot be checked.
    const item = deepcopy(fixtures.CHART_FIXTURE);
    const text = sanity.renderForSanity(item);
    expect(text).toContain("【棒グラフ】月別 問い合わせ件数（単位：件）");
    expect(text.includes("電話：4月 330 / 5月 410") && text.includes("メール：4月 150 / 5月 190")).toBe(true);
  });

  test("render includes a dialogue stimulus", () => {
    const item = deepcopy(fixtures.FIXTURES["sougou_choukai"]);
    const text = sanity.renderForSanity(item);
    expect(text).toContain("--- 会話 ---");
    expect(text).toContain(item["dialogue"][0]["text"]);
  });

  // ----- the saving ---------------------------------------------------------

  test("a flagged item never reaches the gate", async () => {
    // The whole point of running first: six calls to a strong model are not
    // spent on an item a one-call proofreader already condemned.
    const s = store(tmpPath());
    const gateCalls: unknown[] = [];
    patch(llm, "generateStructured", async () => deepcopy(fixtures.FIXTURES["hyougen"]));
    patch(llm, "sanityCheck", _clean({ explanation_mismatch: true }));
    patch(answerability, "runGate", async (item: Record<string, any>) => {
      gateCalls.push(item);
      return null as unknown as answerability.GateResult;
    });

    const [, , kept, detail] = await pipeline.generateAndGate(s, "hyougen", "J2", { gate: true });

    expect(gateCalls).toEqual([]);
    expect(kept).toBe(false);
    expect(detail).toContain("sanity=explanation_mismatch");
  });

  test("a clean item goes on to the gate", async () => {
    const s = store(tmpPath());
    const gateCalls: unknown[] = [];

    const fakeGate = async (item: Record<string, any>) => {
      gateCalls.push(item);
      return { cold_success_rate: 0.0, full_success_rate: 1.0,
               verdict: "kept", trials: [] } as unknown as answerability.GateResult;
    };

    patch(llm, "generateStructured", async () => deepcopy(fixtures.FIXTURES["hyougen"]));
    patch(llm, "sanityCheck", _clean());
    patch(answerability, "runGate", fakeGate);
    // The probe off, so the prior below is the gate's own full-view rate.
    setConfig({ DIFFICULTY_ENABLED: false });

    const [item, , kept] = await pipeline.generateAndGate(s, "hyougen", "J2", { gate: true });

    expect(gateCalls.length).toBe(1);
    expect(kept).toBe(true);
    expect(item["model_p_correct"]).toBe(1.0);
  });
});
