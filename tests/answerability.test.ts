/**
 * Two-sided answerability gate (fidelity #2). The model call is faked so the
 * verdict logic is tested deterministically.
 */
import { beforeEach, describe, expect, test } from "vitest";
import * as fixtures from "../bjt/fixtures.ts";
import * as llm from "../bjt/llm.ts";
import { deepcopy, splitlines } from "../bjt/py.ts";
import * as schemas from "../bjt/schemas.ts";
import * as answerability from "../bjt/fidelity/answerability.ts";
import * as difficulty from "../bjt/fidelity/difficulty.ts";
import * as document from "../bjt/render/document.ts";
import { fixtureItem, goiItem } from "./conftest.ts";
import { patch, setConfig } from "./helpers.ts";

// These tests exercise the pass-rate probe ("trials"); the confidence
// probe, the default since 2026-10-10, has its own in confidence.test.ts.
beforeEach(() => {
  setConfig({ DIFFICULTY_METHOD: "trials" });
});

type Answer = (question: string, options: string[], opts?: { model?: string | null }) => Promise<Record<string, any>>;

/** Return a stand-in for llm.answerChoice that answers full vs cold views
 *  differently. The cold view's question contains the word 'withheld'. */
function _fakeAnswerer(fullChoice: number, coldChoice: number): Answer {
  return async (question) => {
    const isCold = question.includes("withheld");
    return { choice: isCold ? coldChoice : fullChoice, reason: "x" };
  };
}

describe("answerability", () => {
  // fixed_trials (autouse)
  beforeEach(() => {
    setConfig({ GATE_TRIALS: 3 });
  });

  test("kept when full succeeds cold fails", async () => {
    const item = goiItem();
    const ci = schemas.correctIndex(item["options"]);
    const wrong = (ci + 1) % 4;
    patch(llm, "answerChoice", _fakeAnswerer(ci, wrong));
    const res = await answerability.runGate(item);
    expect(res.full_success_rate).toBe(1.0);
    expect(res.cold_success_rate).toBe(0.0);
    expect(res.verdict).toBe("kept");
    expect(res.kept).toBe(true);
  });

  test("discarded leaky when cold succeeds", async () => {
    // A 聴読解 type: the answer must need the audio, so a leak discards.
    const item = fixtureItem("shiryou_choudokkai");
    const ci = schemas.correctIndex(item["options"]);
    // Cold picks the right answer from the page alone -> the audio is decorative.
    patch(llm, "answerChoice", _fakeAnswerer(ci, ci));
    const res = await answerability.runGate(item);
    expect(res.cold_success_rate).toBe(1.0);
    expect(res.verdict).toBe("discarded:leaky");
    expect(res.kept).toBe(false);
    // The cold side decides, so the full side is never asked: no full trials,
    // no full rate. And two right answers of a planned three already settle
    // "leaky", so the third cold call is not made either.
    expect(res.full_success_rate).toBeNull();
    expect(res.trials.map((t) => t.side)).toEqual(["cold", "cold"]);
  });

  test("the cold side runs first and alone when it leaks", async () => {
    const item = fixtureItem("shiryou_choudokkai");
    const ci = schemas.correctIndex(item["options"]);
    const asked: string[] = [];

    patch(llm, "answerChoice", async (question: string) => {
      asked.push(question.includes("withheld") ? "cold" : "full");
      return { choice: ci, reason: "x" };
    });
    await answerability.runGate(item);
    expect(asked).toEqual(["cold", "cold"]);
  });

  /** Outside 聴読解 a leak makes a question easier than meant, not wrong
   *  (2026-10-10): the cold rate is recorded and the full side decides. */
  test("a leak outside 聴読解 is recorded, not discarded", async () => {
    const item = goiItem();
    const ci = schemas.correctIndex(item["options"]);
    const asked: string[] = [];
    patch(llm, "answerChoice", async (question: string) => {
      asked.push(question.includes("withheld") ? "cold" : "full");
      return { choice: ci, reason: "x" };
    });
    const res = await answerability.runGate(item);
    expect(res.verdict).toBe("kept");
    expect(res.cold_success_rate).toBe(1.0);
    expect(res.full_success_rate).toBe(1.0);
    expect(asked).toEqual(["cold", "cold", "full", "full"]);
  });

  test("a leak outside 聴読解 is still discarded when the full side fails", async () => {
    const item = goiItem();
    const ci = schemas.correctIndex(item["options"]);
    // Cold right, full wrong: the key is a guess the stem does not support.
    patch(llm, "answerChoice", _fakeAnswerer((ci + 1) % 4, ci));
    const res = await answerability.runGate(item);
    expect(res.cold_success_rate).toBe(1.0);
    expect(res.verdict).toBe("discarded:ambiguous");
  });

  test("only the 聴読解 types discard a leak", () => {
    expect([...answerability.COLD_DISCARDS].sort()).toEqual(
      ["joukyou_haaku", "shiryou_choudokkai", "sougou_choudokkai"]);
    for (const t of ["goi_bunpou", "hyougen", "bamen_haaku", "hatsugen_choukai",
                     "gazou_haaku", "sougou_choukai", "sougou_dokkai"]) {
      expect(answerability.leakDiscards(t), t).toBe(false);
    }
  });

  test("discarded ambiguous when full fails", async () => {
    const item = goiItem();
    const ci = schemas.correctIndex(item["options"]);
    const wrong = (ci + 1) % 4;
    // Full can't pick the answer even with the stem -> ambiguous.
    patch(llm, "answerChoice", _fakeAnswerer(wrong, wrong));
    const res = await answerability.runGate(item);
    expect(res.full_success_rate).toBe(0.0);
    expect(res.verdict).toBe("discarded:ambiguous");
  });

  test("trial count recorded", async () => {
    // Two of three settle each side when the answers agree; a split pair
    // needs the third. Every trial that ran is recorded.
    const item = goiItem();
    const ci = schemas.correctIndex(item["options"]);
    patch(llm, "answerChoice", _fakeAnswerer(ci, (ci + 1) % 4));
    const res = await answerability.runGate(item);
    expect(res.trials.filter((t) => t.side === "full").length).toBe(2);
    expect(res.trials.filter((t) => t.side === "cold").length).toBe(2);
  });

  test("a split pair asks the third", async () => {
    const item = goiItem();
    const ci = schemas.correctIndex(item["options"]);
    const cold = [ci, (ci + 1) % 4, (ci + 1) % 4][Symbol.iterator]();   // right, wrong, wrong → clean
    const full = [ci, (ci + 1) % 4, ci][Symbol.iterator]();             // right, wrong, right → kept

    patch(llm, "answerChoice", async (question: string) => {
      return { choice: question.includes("withheld") ? cold.next().value : full.next().value, reason: "x" };
    });
    const res = await answerability.runGate(item);
    expect(res.verdict).toBe("kept");
    expect(res.trials.filter((t) => t.side === "cold").length).toBe(3);
    expect(res.trials.filter((t) => t.side === "full").length).toBe(3);
    expect(res.cold_success_rate).toBeCloseTo(1 / 3);
  });

  const OUTCOMES: [number, number, number][] = [];
  for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) OUTCOMES.push([a, b, c]);

  test.each(OUTCOMES)("early stopping never changes a verdict %s %s %s", (...outcomes) => {
    // For every sequence of three answers, stopping early gives the verdict
    // the full three would have. The saving is calls, never accuracy.
    const planned = 3;
    const pairs: [answerability.Decided, (c: number, p: number) => boolean, string][] = [
      [answerability.coldDecided, answerability.isLeaky, "coldDecided"],
      [answerability.fullDecided, answerability.isAmbiguous, "fullDecided"],
    ];
    for (const [decided, judge, name] of pairs) {
      const fullVerdict = judge(outcomes.reduce((x, y) => x + y, 0), planned);
      let seen = 0;
      for (let n = 1; n <= outcomes.length; n++) {
        seen += outcomes[n - 1];
        if (decided(seen, n, planned)) {
          break;
        }
      }
      expect(judge(seen, planned), `${outcomes} ${name}`).toBe(fullVerdict);
    }
  });

  // ----- the two views, per type -----------------------------------------------

  function _docItem(itemType: string): Record<string, any> {
    return deepcopy(fixtures.FIXTURES[itemType]);
  }

  test.each(["joukyou_haaku", "shiryou_choudokkai", "sougou_dokkai"])("the full view carries the document %s", (itemType) => {
    // Shown the narration alone, the judge would call an item whose answer
    // needs the page 'ambiguous' and keep one whose audio is decorative. Both
    // halves reach the full view.
    const item = _docItem(itemType);
    const [full, cold] = answerability.questions(item);
    const docText = document.textOf(item["document"]);
    const firstLine = splitlines(docText)[0];
    expect(full).toContain(firstLine);
    expect(full).toContain(item["stem"]);
    expect(cold).toContain("withheld");
  });

  test("the document types withhold the audio not the document", () => {
    const item = _docItem("joukyou_haaku");
    const [, cold] = answerability.questions(item);
    expect(cold).toContain(splitlines(document.textOf(item["document"]))[0]);
    expect(cold.includes(item["stem"]), "the spoken request is the withheld half").toBe(false);
  });

  test("the dialogue types carry the conversation in the full view only", () => {
    const item = _docItem("sougou_choukai");
    const [full, cold] = answerability.questions(item);
    const firstTurn = item["dialogue"][0]["text"];
    expect(full).toContain(firstTurn);
    expect(cold).not.toContain(firstTurn);
    expect(cold.includes(item["stem"]), "the question is shown; the conversation is withheld").toBe(true);
  });

  test("the reading type withholds the passage", () => {
    const item = _docItem("sougou_dokkai");
    const [, cold] = answerability.questions(item);
    expect(cold).not.toContain(splitlines(document.textOf(item["document"]))[0]);
    expect(cold).toContain(item["stem"]);
  });

  test("the integrated type carries both documents and every turn", () => {
    const item = _docItem("sougou_choudokkai");
    const [full, cold] = answerability.questions(item);
    for (const doc of item["documents"]) {
      expect(full).toContain(splitlines(document.textOf(doc))[0]);
      expect(cold).toContain(splitlines(document.textOf(doc))[0]);
    }
    for (const turn of item["dialogue"]) {
      expect(full).toContain(turn["text"]);
      expect(cold).not.toContain(turn["text"]);
    }
  });

  const CHART_LINES = ["【棒グラフ】月別 問い合わせ件数（単位：件）",
                       "電話：4月 330 / 5月 410 / 6月 340 / 7月 260 / 8月 240 / 9月 460",
                       "メール：4月 150 / 5月 190 / 6月 250 / 7月 320 / 8月 340 / 9月 370"];

  test("a chart reaches both views figure by figure", () => {
    // The gate sees the whole stimulus, and a graph is part of it. A chart that
    // reached the judge as its caption alone would make an item whose answer is
    // read off the bars 'ambiguous' on the full side, and would hide from the
    // cold side a graph that answers the question by itself.
    const item = deepcopy(fixtures.CHART_FIXTURE);
    const [full, cold] = answerability.questions(item);
    for (const line of CHART_LINES) {
      expect(full.includes(line) && cold.includes(line)).toBe(true);
    }
    expect(full.includes(item["stem"]) && !cold.includes(item["stem"])).toBe(true);
  });

  test("the difficulty probe reads the chart too", async () => {
    // The probe sits the gate's full view on a weaker model, so the difficulty
    // of reading a graph is measured on the graph's figures, not its title.
    setConfig({ DIFFICULTY_ENABLED: true });
    const seen: string[] = [];

    patch(llm, "answerChoice", async (question: string) => {
      seen.push(question);
      return { choice: 0, reason: "x" };
    });
    await difficulty.measure(deepcopy(fixtures.CHART_FIXTURE));
    expect(seen.length > 0 && seen.every((q) => CHART_LINES.every((line) => q.includes(line)))).toBe(true);
  });

  test("a stem only type keeps the options only cold view", () => {
    const item = goiItem();
    const [full, cold] = answerability.questions(item);
    expect(full).toContain(item["stem"]);
    expect(!cold.includes(item["stem"]) && cold.includes("withheld")).toBe(true);
  });

  test("the judges reason is kept and fed back", async () => {
    const item = fixtureItem("shiryou_choudokkai");
    const ci = schemas.correctIndex(item["options"]);
    patch(llm, "answerChoice", async () => ({ choice: ci, reason: "the only polite one" }));
    const res = await answerability.runGate(item);
    expect(res.verdict).toBe("discarded:leaky");
    expect(res.trials.every((t) => t.reason === "the only polite one")).toBe(true);
    const text = answerability.leakDescription("shiryou_choudokkai", { result: res });
    expect(text.includes("the only polite one") && text.split("the only polite one").length - 1 === 1).toBe(true);
    expect(text).toContain("without the spoken prompt");
    // No result, or no cold reasons: the plain sentence.
    expect(answerability.leakDescription("goi_bunpou")).not.toContain("own words");
  });

  /** The next draft is a new item: it is told how to defeat the guess, not
   *  to rewrite options it never saw, and named the half to lean on. */
  test("the leak feedback tells the next draft how to beat the guess", async () => {
    const item = goiItem();
    const ci = schemas.correctIndex(item["options"]);
    patch(llm, "answerChoice", async () => ({ choice: ci, reason: "the most typical one" }));
    const res = await answerability.runGate(item);
    const text = answerability.leakDescription("sougou_dokkai", { result: res });
    expect(text).toContain("next draft");
    expect(text).toContain("without the passage, and let the passage be what rules it out");
    expect(text).not.toContain("Rewrite the options");
  });

  test("every type names the half its cold view hides", () => {
    expect(answerability.withheldHalf("sougou_choukai")).toBe("the conversation");
    expect(answerability.withheldHalf("hatsugen_choukai")).toBe("the situation");
    expect(answerability.withheldHalf("gazou_haaku")).toBe("the picture");
    expect(answerability.withheldHalf("goi_bunpou")).toBe("the stem");
  });
});
