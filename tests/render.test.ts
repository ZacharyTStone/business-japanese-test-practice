/**
 * The document renderer: validation, escaping, and the semantics that make a
 * document readable with a screen reader rather than merely visible.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import * as chart from "../bjt/render/chart.ts";
import * as render from "../bjt/render/index.ts";
import * as tpl from "../bjt/render/templates.ts";
import { range, sorted } from "../bjt/py.ts";
import * as schemas from "../bjt/schemas.ts";
import { sameSet } from "./helpers.ts";

type Doc = Record<string, any>;

function _email(overrides: Doc = {}): Doc {
  const doc: Doc = {
    template: "email_external",
    title: "納品日変更のお願い",
    meta: [
      { label: "差出人", value: "山川商事 佐藤" },
      { label: "宛先", value: "みどり物産 田中様" },
      { label: "件名", value: "納品日変更のお願い" },
      { label: "日時", value: "4月8日 10:20" },
    ],
    blocks: [
      { type: "paragraph", text: "いつもお世話になっております。" },
      { type: "bullets", items: ["現行の納品日：4月15日", "希望する納品日：4月22日"] },
    ],
  };
  return { ...doc, ...overrides };
}

/** `set(a) == set(b)`, for lists of strings. */
// ----- validation ---------------------------------------------------------

describe("validation", () => {
  test("a well formed document validates", () => {
    expect(render.validateDocument(_email())).toEqual([]);
  });

  test("an unknown template is rejected", () => {
    const errors = render.validateDocument(_email({ template: "postcard" }));
    expect(errors.some((e) => e.includes("unknown template"))).toBe(true);
  });

  test("the template is an assignment not a suggestion", () => {
    // The seed cell assigns the template the same way it assigns a scene id.
    // Substituting one means the item is not the item we asked for.
    const errors = render.validateDocument(_email(), { template: "meeting_minutes" });
    expect(errors.some((e) => e.includes("does not match the assigned"))).toBe(true);
  });

  test("a missing header field is rejected", () => {
    // An email with no 件名 is not an email, and an item built on one would be
    // testing something other than what it claims.
    const doc = _email();
    doc.meta = doc.meta.filter((m: Doc) => m.label !== "件名");
    const errors = render.validateDocument(doc);
    expect(errors.some((e) => e.includes("件名"))).toBe(true);
  });

  test("a table row that does not match its header is rejected", () => {
    const doc = _email({
      blocks: [{
        type: "table",
        columns: ["品名", "数量", "単価"],
        rows: [["A4用紙", "10"]],
      }],
    });
    const errors = render.validateDocument(doc);
    expect(errors.some((e) => e.includes("cell(s), header has 3"))).toBe(true);
  });

  test("a block missing its content is rejected", () => {
    const errors = render.validateDocument(_email({ blocks: [{ type: "table", columns: ["品名"] }] }));
    expect(errors.some((e) => e.includes("missing rows"))).toBe(true);
  });

  test("blank text blocks are pruned and the rest validates", () => {
    // A blank heading or callout says nothing, so it is dropped rather than
    // failing the draft as 'missing text' on every attempt.
    let doc = _email({
      blocks: [
        { type: "heading", text: "  " },
        { type: "paragraph", text: "本文です。" },
        { type: "callout", tone: "warning" },
        { type: "bullets", items: ["一", "二"] },
      ],
    });
    expect(render.validateDocument(doc).some((e) => e.includes("missing text"))).toBe(true);
    expect(render.pruneEmptyBlocks(doc)).toBe(2);
    expect(doc.blocks.map((b: Doc) => b.type)).toEqual(["paragraph", "bullets"]);
    expect(render.validateDocument(doc)).toEqual([]);
    // A table with no rows is not a blank text block; the validator keeps its say.
    doc = _email({ blocks: [{ type: "table", columns: ["品名"] }] });
    expect(render.pruneEmptyBlocks(doc)).toBe(0);
    // And a document that was nothing but blanks still fails, as it should.
    doc = _email({ blocks: [{ type: "heading" }] });
    render.pruneEmptyBlocks(doc);
    expect(render.validateDocument(doc).some((e) => e.includes("no blocks"))).toBe(true);
    expect(render.pruneEmptyBlocks("not a document")).toBe(0);
  });

  test("a document with no blocks is rejected", () => {
    expect(render.validateDocument(_email({ blocks: [] })).some((e) => e.includes("no blocks"))).toBe(true);
  });
});

// ----- rendering ----------------------------------------------------------

describe("rendering", () => {
  test("content is escaped", () => {
    // Document content comes out of a model. It is data interpolated into
    // HTML, so there is no trusted path and no exception.
    const html = render.render(_email({ title: '<script>alert("x")</script>' }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("tables get real header cells", () => {
    const html = render.render(_email({
      blocks: [{
        type: "table",
        columns: ["品名", "数量"],
        rows: [["A4用紙", "10"]],
      }],
    }));
    expect(html).toContain('<th scope="col">品名</th>');
    // The first body cell is a row header, so a reader hears "A4用紙 — 10"
    // rather than a bare number.
    expect(html).toContain('<th scope="row">A4用紙</th>');
    expect(html).toContain("<td>10</td>");
  });

  test("header fields render as a definition list", () => {
    const html = render.render(_email());
    expect(html.includes("<dl") && html.includes("<dt>件名</dt>")).toBe(true);
  });

  test("heading depth is clamped", () => {
    // A document sits inside a screen that already owns h1.
    expect(render.render(_email({ blocks: [{ type: "heading", text: "件名", level: 1 }] }))).toContain("<h2");
    expect(render.render(_email({ blocks: [{ type: "heading", text: "件名", level: 9 }] }))).toContain("<h4");
  });

  test("an unknown block type drops rather than raising", () => {
    // A learner is in the middle of reading this. Losing one paragraph beats
    // losing the screen.
    const html = render.render(_email({
      blocks: [
        { type: "sparkline", text: "?" },
        { type: "paragraph", text: "残ります" },
      ],
    }));
    expect(html).toContain("残ります");
  });

  test("render never emits an image", () => {
    // A picture of a document cannot be selected, scaled, or read aloud — and
    // an image model cannot spell 御中 reliably either.
    const html = render.renderPage(_email());
    expect(!html.includes("<img") && !html.includes("background-image")).toBe(true);
  });

  test("the page declares japanese and a viewport", () => {
    const page = render.renderPage(_email());
    expect(page).toContain('lang="ja"');
    expect(page).toContain("width=device-width");
  });
});

// ----- text extraction ----------------------------------------------------

describe("text extraction", () => {
  test("text of reaches every corner of the document", () => {
    // The dedupe check and the answerability gate compare items as text. A
    // stimulus they cannot see would sail past near-duplicate detection however
    // many times we asked the same question about the same email.
    const doc = _email({
      blocks: [
        { type: "paragraph", text: "本文です" },
        { type: "table", columns: ["品名"], rows: [["A4用紙"]] },
        { type: "key_values", pairs: [{ label: "納期", value: "4月22日" }] },
        { type: "quoted_message", sender: "田中", text: "承知しました" },
      ],
    });
    const text = render.textOf(doc);
    for (const fragment of ["納品日変更のお願い", "本文です", "A4用紙", "納期", "4月22日", "田中", "承知しました"]) {
      expect(text).toContain(fragment);
    }
  });
});

// ----- the templates themselves -------------------------------------------

describe("the templates themselves", () => {
  test.each(sorted(Object.keys(tpl.TEMPLATES)))("every template declares what it needs [%s]", (templateId) => {
    const t = tpl.TEMPLATES[templateId];
    expect(t.required_meta.length, `${templateId} requires no header fields`).toBeGreaterThan(0);
    expect(t.suits.length, `${templateId} is not offered to any item type`).toBeGreaterThan(0);
    expect(render.spec(templateId)).toContain(templateId);
  });

  test("the app can draw every block and template the pipeline ships", () => {
    // Two renderers for one data model (html.ts here, document.tsx in the app),
    // and the app's drops a block it does not know rather than crashing — which
    // is right for a learner mid-question and silent for everybody else. A block
    // type or a template added here and not there would ship documents the app
    // shows with a hole in them, so the app's lists are held to these.
    const client = path.resolve(import.meta.dirname, "..", "client", "src");
    const typesTs = readFileSync(path.join(client, "lib", "types.ts"), "utf8");
    const union = /export type DocBlock = \{\s*type:([^;]*?);/s.exec(typesTs);
    expect(union, "types.ts no longer declares DocBlock's type union as expected").toBeTruthy();
    sameSet([...union![1].matchAll(/"(\w+)"/g)].map((m) => m[1]), render.BLOCK_TYPES);
    const documentTsx = readFileSync(path.join(client, "ui", "document.tsx"), "utf8");
    for (const table of ["TEMPLATE_KEY", "CHROME"]) {
      const body = new RegExp(`const ${table}: Record<string, \\w+> = \\{(.*?)\\n\\};`, "s").exec(documentTsx);
      expect(body, `document.tsx no longer declares ${table} as expected`).toBeTruthy();
      expect(sorted(new Set([...body![1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]))), table)
        .toEqual(sorted(Object.keys(tpl.TEMPLATES)));
    }
    const block = /function Block\(.*?\n\}\n/s.exec(documentTsx);
    expect(block).toBeTruthy();
    sameSet([...block![0].matchAll(/case "(\w+)":/g)].map((m) => m[1]), render.BLOCK_TYPES);
  });

  test("every document item type has at least one template", () => {
    for (const itemType of ["shiryou_choudokkai", "sougou_choudokkai", "sougou_dokkai",
                            "joukyou_haaku", "bamen_haaku"]) {
      expect(render.forItemType(itemType).length, `${itemType} has no template`).toBeGreaterThan(0);
    }
  });
});

// ----- the chart block ------------------------------------------------------


function _bar(overrides: Doc = {}): Doc {
  const block: Doc = {
    type: "chart", kind: "bar", caption: "月別 問い合わせ件数", unit: "件",
    categories: ["4月", "5月", "6月"],
    series: [{ name: "電話", values: [330, 410, 340] },
             { name: "メール", values: [150, 190, 250] }],
  };
  return { ...block, ...overrides };
}

function _figures(blocks: Doc[] = [], template: string = "figures"): Doc {
  return {
    template,
    title: "問い合わせ件数の推移",
    meta: [{ label: "期間", value: "4月〜6月" }, { label: "作成者", value: "山田" }],
    blocks: blocks.length ? [...blocks] : [_bar()],
  };
}

describe("the chart block", () => {
  test("a well formed chart validates", () => {
    expect(render.validateDocument(_figures())).toEqual([]);
    const line = _bar({
      kind: "line", categories: range(1, 13).map((m) => `${m}月`),
      series: [{ name: "", values: range(12).map((m) => 1.5 * m) }],
    });
    expect(render.validateDocument(_figures([line]))).toEqual([]);
  });

  test.each(["kind", "caption", "unit", "categories", "series"])("a chart needs every one of its fields [%s]", (field) => {
    // A chart with no title cannot be pointed at from the audio, one with no
    // unit is numbers that mean nothing, and one with no figures is nothing.
    const block = _bar();
    delete block[field];
    const errors = render.validateDocument(_figures([block]));
    expect(errors.some((e) => e.includes(`missing ${field}`)), String(errors)).toBe(true);
  });

  const unreadable: [Doc, string][] = [
    [{ kind: "pie" }, "one of ['bar', 'line']"],
    [{ categories: ["4月"], series: [{ name: "", values: [1] }] }, "takes 2–8"],
    [{ categories: range(1, 10).map((m) => `${m}月`),
       series: [{ name: "", values: range(1, 10) }] }, "takes 2–8"],
    [{ categories: ["4月", "5月", "6月"], series: [{ name: "", values: [1, 2] }] },
     "2 value(s) for 3 categories"],
    [{ categories: ["カスタマーセンター", "5月", "6月"] }, "longer than 8"],
    [{ categories: ["4月", "4月", "6月"] }, "repeats a category"],
    [{ categories: ["4月", " ", "6月"] }, "blank category"],
    [{ series: [{ name: "電話", values: [1, NaN, 3] }] }, "not a finite number"],
    [{ series: [{ name: "電話", values: [1, Infinity, 3] }] }, "not a finite number"],
    [{ series: [{ name: "電話", values: [1, "2", 3] }] }, "not a finite number"],
    [{ series: [{ name: "電話", values: [1, true, 3] }] }, "not a finite number"],
    [{ series: [{ name: "電話", values: [1, 12_500_000, 3] }] }, "more than six digits"],
    [{ series: [{ name: "電話", values: [1, 2.125, 3] }] }, "decimal places"],
    [{ series: [{ name: "電話", values: [0, 0, 0] }] }, "nothing but zeros"],
    [{ series: [..."ABCD"].map((n) => ({ name: n, values: [1, 2, 3] })) }, "at most 3"],
    [{ series: [{ name: "電話", values: [1, 2, 3] }, { name: "", values: [1, 2, 3] }] },
     "names every series"],
    [{ series: [{ name: "電話", values: [1, 2, 3] }, { name: "電話", values: [3, 2, 1] }] },
     "same name"],
    [{ caption: "あ".repeat(41) }, "caption longer than 40"],
    [{ unit: "あ".repeat(9) }, "unit longer than 8"],
  ];
  test.each(unreadable)("a chart that cannot be read on a phone is rejected [%j → %s]", (overrides, expected) => {
    const errors = render.validateDocument(_figures([_bar(overrides)]));
    expect(errors.some((e) => e.includes(expected)), String(errors)).toBe(true);
  });

  test("a line takes a year of months where bars take eight", () => {
    const months = [...range(4, 13).map((m) => `${m}月`), "1月", "2月", "3月"];
    const line = _bar({ kind: "line", categories: months, series: [{ name: "", values: range(1, 13) }] });
    expect(render.validateDocument(_figures([line]))).toEqual([]);
    expect(render.validateDocument(_figures([_bar({
      categories: months, series: [{ name: "", values: range(1, 13) }],
    })])).some((e) => e.includes("takes 2–8"))).toBe(true);
  });

  test("a chart goes only where its template carries one", () => {
    // A graph belongs on a handout of figures or in a progress report. In the
    // body of an email or on a sign it is not what arrives on a desk.
    expect(render.validateDocument({
      ..._figures([_bar()], "progress_report"),
      meta: [{ label: "報告者", value: "山田" }, { label: "報告日", value: "10月1日" },
             { label: "案件", value: "新システム導入" }],
    })).toEqual([]);
    const email = _email({ blocks: [_bar()] });
    const errors = render.validateDocument(email);
    expect(errors.some((e) => e.includes("does not carry one") && e.includes("figures")), String(errors)).toBe(true);
    const carriers = sorted(Object.entries(tpl.TEMPLATES).filter(([, v]) => v.charts).map(([t]) => t));
    expect(carriers).toEqual(["figures", "progress_report"]);
  });

  test("one chart to a document", () => {
    const errors = render.validateDocument(_figures([_bar(), _bar({ caption: "もう一つ" })]));
    expect(errors.some((e) => e.includes("2 charts")), String(errors)).toBe(true);
  });

  test("the figures template is a handout for the listening and reading types", () => {
    const t = tpl.TEMPLATES["figures"];
    expect(t.charts).toBe(true);
    sameSet(t.suits, ["shiryou_choudokkai", "sougou_choudokkai"]);
    expect(render.forItemType("shiryou_choudokkai").map((x) => x.id)).toContain("figures");
  });

  test.each(["shiryou_choudokkai", "sougou_choudokkai", "joukyou_haaku", "sougou_dokkai"])(
    "the document schema asks only for what structured output can enforce [%s]", (itemType) => {
      // The API's schema subset has no numeric bounds, no string lengths and no
      // maxItems, and a schema that uses one is refused outright — every shelf of
      // the night, not one item. The chart's bounds are therefore stated in words
      // and enforced by `chart.errors`; this holds the schema to that.
      const unsupported = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
                                   "multipleOf", "minLength", "maxLength", "maxItems", "pattern"]);
      for (const [p, node] of _walk(schemas.buildItemSchema(itemType))) {
        if (isDict(node) && !p.split(".").pop()!.includes("properties")) {
          const used = Object.keys(node).filter((k) => unsupported.has(k));
          expect(used, `${p} uses ${used}`).toEqual([]);
          if (node.type === "object") {
            expect(node.additionalProperties, p).toBe(false);
          }
          if ("minItems" in node) {
            expect([0, 1], p).toContain(node.minItems);
          }
        }
      }
    });

  test("text of writes every figure beside its label", () => {
    // Every model that reads a 資料 reads it through textOf — the gate's two
    // views, the proofreader, the difficulty probe, the discriminator. A chart
    // that reached them as its title alone would be 'unanswerable' exactly when
    // a learner could read the answer off it.
    const text = render.textOf(_figures());
    expect(text).toContain("【棒グラフ】月別 問い合わせ件数（単位：件）");
    expect(text).toContain("電話：4月 330 / 5月 410 / 6月 340");
    expect(text).toContain("メール：4月 150 / 5月 190 / 6月 250");
  });

  // JavaScript has one number type, so 1250 and 1250.0 are the same case here.
  test.each([
    [1250, "1,250"], [1250.0, "1,250"], [12.5, "12.5"], [-3, "-3"], [0.25, "0.25"],
    [999999, "999,999"], [NaN, "—"], [true, "—"],
  ] as [unknown, string][])("figures are printed the way print sets them [%s → %s]", (value, printed) => {
    expect(chart.formatValue(value)).toBe(printed);
  });

  test.each([
    [[330, 410, 460, 150], [0, 100, 200, 300, 400, 500]],
    [[-5, 12], [-5, 0, 5, 10, 15]],
    [[0.5, 1.2], [0, 0.25, 0.5, 0.75, 1, 1.25]],
    [[7, 7, 7], [0, 2, 4, 6, 8]],
    [[0, 0], [0, 0.2, 0.4, 0.6, 0.8, 1]],
  ])("the axis is round numbers from zero past every figure [%j]", (values, expected) => {
    const ticks = chart.axis(values);
    expect(ticks.length).toBe(expected.length);
    ticks.forEach((t, i) => expect(t).toBeCloseTo(expected[i], 6));
    expect(ticks.includes(0) && ticks[0] <= Math.min(...values) && ticks[ticks.length - 1] >= Math.max(...values)).toBe(true);
  });

  test("a chart renders as a figure with its figures in a table", () => {
    // Drawn for the eye, tabulated for the ear: the SVG is hidden from a
    // screen reader, which walks a real table of the same figures instead.
    const html = render.render(_figures());
    expect(html).toContain('<figure class="doc-chart" data-kind="bar">');
    expect(html.includes("<figcaption") && html.includes("月別 問い合わせ件数") && html.includes("（単位：件）")).toBe(true);
    expect(html.includes('<svg class="doc-chart-plot"') && html.includes('aria-hidden="true"')).toBe(true);
    expect(html.includes('<th scope="col">電話</th>') && html.includes('<th scope="row">5月</th>')).toBe(true);
    expect(html).toContain("<td>410</td>");
    expect(html.split("<rect").length - 1).toBeGreaterThanOrEqual(6);  // three months × two series, plus swatches
    expect(html).toContain('<ul class="doc-chart-legend">');
    expect(render.renderPage(_figures())).not.toContain("<img");
  });

  test("a line chart draws one line per series and says which is which", () => {
    const doc = _figures([_bar({ kind: "line" })]);
    const html = render.render(doc);
    expect(html.split("<polyline").length - 1).toBe(2);
    expect(html).toContain('stroke-dasharray="6 4"');  // the second series is dashed, not coloured
  });

  test("chart labels are escaped", () => {
    const html = render.render(_figures([_bar({
      caption: '<script>alert("x")</script>',
      categories: ["<b>", "5月", "6月"],
    })]));
    expect(!html.includes("<script>") && !html.includes("<b>")).toBe(true);
    expect(html.includes("&lt;script&gt;") && html.includes("&lt;b&gt;")).toBe(true);
  });

  test.each([
    { type: "chart", kind: "bar", caption: "空", unit: "件" },
    { type: "chart", kind: "donut", caption: "x", unit: "件", categories: ["a", "b"],
      series: [{ name: "", values: [1, NaN] }] },
    { type: "chart", categories: ["a", "b", "c"], series: [{ values: [1] }, "junk"] },
    { type: "chart", categories: "not a list", series: { values: 3 } },
  ] as Doc[])("a malformed chart draws what it can rather than raising [%j]", (block) => {
    // Validation runs before anything is published; a renderer is still the
    // one place a bad block must not take the screen down with it.
    const html = render.render(_figures([block]));
    expect(html).toContain("</article>");
    render.textOf(_figures([block]));
  });
});

function isDict(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function* _walk(schema: unknown, p: string = "schema"): Generator<[string, unknown]> {
  yield [p, schema];
  if (isDict(schema)) {
    for (const [key, value] of Object.entries(schema)) {
      yield* _walk(value, `${p}.${key}`);
    }
  } else if (Array.isArray(schema)) {
    for (let i = 0; i < schema.length; i++) {
      yield* _walk(schema[i], `${p}[${i}]`);
    }
  }
}

// ----- every block field required, the empties taken off ------------------

/** Every field a block can carry, as the schema sends it when unused. */
const _EMPTY_BLOCK: Doc = {
  text: "", level: 0, items: [], caption: "", columns: [], rows: [],
  pairs: [], sender: "", sent_at: "", depth: 0, tone: "", kind: "",
  unit: "", categories: [], series: [],
};

/** A block as the generator receives it now: every field present. */
function _padded(block: Doc): Doc {
  return structuredClone({ ..._EMPTY_BLOCK, ...block });
}

describe("every block field required, the empties taken off", () => {
  test.each(["shiryou_choudokkai", "sougou_choudokkai", "joukyou_haaku", "sougou_dokkai"])(
    "no generation schema has optional document fields [%s]", (itemType) => {
      // Optional fields are what make the API's compiled grammar grow. With the
      // chart's four added, the 総合聴読解 schema — documents and a dialogue, sixteen
      // optional fields — was refused as "Schema is too complex" every night from
      // 2026-09-28, before a token was written. Every block field is required now,
      // and nothing else in a document type's schema may be optional but the
      // scene id.
      const optional: string[] = [];
      for (const [p, node] of _walk(schemas.buildItemSchema(itemType))) {
        if (isDict(node) && node.type === "object") {
          const required = new Set(node.required ?? []);
          for (const k of Object.keys(node.properties ?? {})) {
            if (!required.has(k)) optional.push(`${p}.${k}`);
          }
        }
      }
      expect(optional.filter((p) => !p.endsWith(".scene_id")), String(optional)).toEqual([]);
      const block = render.documentSchema().properties.blocks.items;
      sameSet(block.required, Object.keys(block.properties));
      sameSet(Object.keys(block.properties), ["type", ...Object.keys(_EMPTY_BLOCK)]);
      // An enum field must be able to say "unused".
      expect(block.properties.tone.enum).toContain("");
      expect(block.properties.kind.enum).toContain("");
    });

  test("unused fields come off and the document is what it was", () => {
    // Stripped as the draft arrives, the padding never reaches the validator,
    // the renderers, the app or a bundle: each block is exactly the block an
    // optional schema would have produced.
    const plain = [
      { type: "heading", text: "日程", level: 2 },
      { type: "paragraph", text: "本文です。" },
      { type: "table", caption: "在庫", columns: ["品名", "数"], rows: [["A", "3"]] },
      { type: "quoted_message", sender: "佐藤", sent_at: "4月8日", text: "了解です。",
        depth: 2 },
      { type: "callout", text: "締切は4月10日です。", tone: "warning" },
      _bar(),
    ];
    const doc = _figures(plain.map(_padded));
    expect(render.dropUnusedFields(doc)).toBeGreaterThan(0);
    expect(doc.blocks).toEqual(plain);
    expect(render.dropUnusedFields(doc)).toBe(0);  // nothing left to take off
  });

  test("a newest quoted message reads the same without its zero", () => {
    // depth 0 is the newest message, and a missing depth reads as 0 in both
    // renderers, so the 0 goes with the rest of the padding.
    const doc = _email({ blocks: [_padded({ type: "quoted_message", sender: "佐藤", text: "了解です。" })] });
    render.dropUnusedFields(doc);
    expect(doc.blocks).toEqual([{ type: "quoted_message", sender: "佐藤", text: "了解です。" }]);
    expect(render.validateDocument(doc)).toEqual([]);
  });

  test("a block left empty still fails for what it lacks", () => {
    // Taking the empties off does not hide a block that is empty where it
    // matters: a chart with kind "" is a chart without a kind.
    const doc = _figures([_padded({ ..._bar(), kind: "" })]);
    render.dropUnusedFields(doc);
    expect(render.validateDocument(doc).some((e) => e.includes("missing kind"))).toBe(true);
    expect(render.dropUnusedFields("not a document")).toBe(0);
  });
});
