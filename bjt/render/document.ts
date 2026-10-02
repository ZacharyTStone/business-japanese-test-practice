/**
 * The document object model: what a reading item's stimulus actually *is*.
 *
 * Four of the nine item types put a business document in front of the learner —
 * an email, a schedule, a set of minutes, a quotation. The obvious way to produce
 * one is to ask an image model for a picture of an email. That is the wrong answer
 * twice over: image models mangle kanji, and a picture cannot be selected,
 * scaled, read by a screen reader, or checked by a test.
 *
 * So a document is **data**. The model emits this structure, and we render it
 * (`bjt/render/html.ts`). The template supplies the visual grammar; the generated
 * content supplies only the original business writing that goes in it.
 *
 * A document is a template id, a version, some metadata (the From/To/Subject of an
 * email, the date and attendees of a set of minutes) and an ordered list of
 * content blocks. Blocks are deliberately few — nine of them cover every template
 * in `templates.ts` — because every block type is a thing the renderer, the phone
 * layout, and the accessibility pass all have to handle.
 */
import { get, has, len, or, repr, sorted, str, strip, truthy, TypeError_ } from "../py.ts";
import * as chart from "./chart.ts";
import * as tpl from "./templates.ts";

/** Every block a document may contain.
 *
 *  Kept small on purpose. A block type is not free: each one has to render, wrap
 *  at phone width, survive large text, and mean something to a screen reader.
 *  `chart` earns its place because 資料聴読解 asks for a figure read off a graph
 *  as well as off a table, and a table is not a graph — the skill is reading a
 *  trend off bars. It is drawn from numbers and written out as text for every
 *  model that reads the document (see chart.ts). */
export const BLOCK_TYPES = [
  "heading",        // a section heading inside the document
  "paragraph",      // one run of prose
  "bullets",        // an unordered list
  "numbered",       // an ordered list — agenda items, procedure steps
  "table",          // rows and columns, with real header cells
  "key_values",     // 件名/日時/場所 — a labelled field block
  "quoted_message", // one message in a thread, with its own header
  "callout",        // a boxed notice: a deadline, a warning, a decision
  "chart",          // a bar or line graph, drawn from categories and figures
];

export const CALLOUT_TONES = ["info", "warning", "action"];
export const CHART_KINDS = chart.CHART_KINDS;

/** Every field a block can carry, `type` first. The schema requires all of them. */
export const _BLOCK_FIELDS = ["type", "text", "level", "items", "caption", "columns", "rows", "pairs",
                              "sender", "sent_at", "depth", "tone", "kind", "unit", "categories", "series"] as const;

/** The two numeric fields, and the value that means "not used": a heading's
 *  level and a quoted message's depth both read a missing field as their
 *  default (html.ts, the app's document.tsx), so a 0 says nothing a missing
 *  field does not. */
export const _UNUSED_NUMBERS = ["level", "depth"] as const;

/** `isinstance(v, dict)` for parsed JSON. */
function isDict(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** `for x in (value or [])`, as Python iterates it: a list's elements, a
 *  string's characters, a dict's keys. */
function iterOr(v: unknown): any[] {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [...v];
  if (isDict(v)) return Object.keys(v);
  throw new TypeError_(`'${typeof v}' object is not iterable`);
}

/** `len(value)`: a list's elements, a string's characters, a dict's keys. */
function pyLen(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (typeof v === "string") return len(v);
  if (isDict(v)) return Object.keys(v).length;
  throw new TypeError_(`object of type '${typeof v}' has no len()`);
}

/** One JSON schema covering every block type.
 *
 *  Structured output has no discriminated unions we can rely on across
 *  providers, so this is one object covering every type, and
 *  `validateDocument` enforces which fields each type actually needs. That
 *  keeps the model's job simple and puts the strictness on our side, which is
 *  the same split the item schema uses.
 *
 *  Every field is *required*, and one a block does not use is sent empty
 *  ("", [], 0, or "" for an enum). Optional fields are what make the API's
 *  compiled grammar grow: with the chart's four added (2026-09-27) the
 *  総合聴読解 schema — documents and a dialogue — was refused outright as "Schema
 *  is too complex", every night, before a token was written. Required fields
 *  compile to one fixed sequence. `dropUnusedFields` strips the empties as
 *  the draft arrives, so nothing downstream ever sees them. */
export function _blockSchema(): Record<string, any> {
  return {
    "type": "object",
    "additionalProperties": false,
    "required": [..._BLOCK_FIELDS],
    "description": "Every field is present on every block. A field this block's " +
    "type does not use is left empty: \"\" for text, [] for a list, 0 for a number.",
    "properties": {
      "type": { "type": "string", "enum": BLOCK_TYPES },
      "text": {
        "type": "string",
        "description": "The content, for heading / paragraph / callout blocks.",
      },
      "level": {
        "type": "integer",
        "description": "Heading depth within the document, 2 or 3; 0 for any " +
        "other block.",
      },
      "items": {
        "type": "array",
        "items": { "type": "string" },
        "description": "List entries, for bullets / numbered blocks.",
      },
      "caption": {
        "type": "string",
        "description": "A table's caption, or a chart's title as printed above " +
        "it (「月別 問い合わせ件数」) — required for a chart, at most " +
        `${chart.CAPTION_MAX_CHARS} characters.`,
      },
      "columns": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Table header cells.",
      },
      "rows": {
        "type": "array",
        "items": { "type": "array", "items": { "type": "string" } },
        "description": "Table body rows; each row has one cell per column.",
      },
      "pairs": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["label", "value"],
          "properties": {
            "label": { "type": "string" },
            "value": { "type": "string" },
          },
        },
        "description": "Labelled fields, for a key_values block.",
      },
      "sender": { "type": "string", "description": "Who wrote a quoted message." },
      "sent_at": { "type": "string", "description": "When a quoted message was sent." },
      "depth": {
        "type": "integer",
        "description": "How deep in the reply chain a quoted message sits; 0 is the " +
        "newest, and 0 for any other block.",
      },
      "tone": {
        "type": "string",
        "enum": [...CALLOUT_TONES, ""],
        "description": "What a callout is for: information, a warning, or an action " +
        "to take. \"\" for any other block.",
      },
      // The chart's own fields. Bounds the API's schema subset cannot
      // state (no minimum/maximum, no maxItems) are stated in words here
      // and enforced by `chart.errors`, as the rest of this schema does.
      "kind": {
        "type": "string",
        "enum": [...CHART_KINDS, ""],
        "description": "For a chart: `bar` to compare a few groups (branches, " +
        "products, this year against last), `line` to follow one quantity " +
        "through time. \"\" for any other block.",
      },
      "unit": {
        "type": "string",
        "description": "For a chart: the unit every figure is in, as printed on " +
        "its axis (件, 人, 万円, 千円, %). Choose it so no figure needs more than " +
        "six digits — 1,250万円, never 12,500,000円. The unit goes here and " +
        "not into the caption.",
      },
      "categories": {
        "type": "array",
        "items": { "type": "string" },
        "description": "For a chart: the labels along its axis, in order — " +
        "months, branches, products. " +
        `${chart.MIN_CATEGORIES}–${chart.MAX_CATEGORIES["bar"]} for a bar chart, ` +
        `${chart.MIN_CATEGORIES}–${chart.MAX_CATEGORIES["line"]} for a line; each ` +
        `at most ${chart.CATEGORY_MAX_CHARS} characters (4月, 第1四半期, 大阪支店).`,
      },
      "series": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["name", "values"],
          "properties": {
            "name": {
              "type": "string",
              "description": "What this series is, as its legend says it " +
              "(電話, 前年度, 計画). May be empty only when there is one " +
              `series; at most ${chart.SERIES_NAME_MAX_CHARS} characters.`,
            },
            "values": {
              "type": "array",
              "items": { "type": "number" },
              "description": "One figure per category, in the same order: " +
              "plain numbers in the chart's unit, at most two decimal " +
              "places.",
            },
          },
        },
        "description": `For a chart: one to ${chart.MAX_SERIES} series of figures. ` +
        "The figures are numbers here, never text.",
      },
    },
  };
}

/** The schema handed to the model for a document stimulus. */
export function documentSchema(): Record<string, any> {
  return {
    "type": "object",
    "additionalProperties": false,
    "required": ["template", "title", "meta", "blocks"],
    "properties": {
      "template": {
        "type": "string",
        "description": "Which template renders this document. Assigned by the " +
        "seed cell — do not substitute a different one.",
      },
      "title": {
        "type": "string",
        "description": "The document's own title as it appears at the top: an " +
        "email subject line, a memo heading, the name of a report. Numbers " +
        "in Arabic digits (「10月 新人研修 予定表」, not 「十月 …」).",
      },
      "meta": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["label", "value"],
          "properties": {
            "label": { "type": "string" },
            "value": { "type": "string" },
          },
        },
        "description": "The template's header fields — From/To/Date for an " +
        "email, 日時/場所/出席者 for minutes. Labels in Japanese. Dates and " +
        "times in Arabic digits (「9月9日（火）10時〜12時」).",
      },
      "blocks": {
        "type": "array",
        "items": _blockSchema(),
        "description": "The body, in reading order. Write every number " +
        "with Arabic digits, as a real business document does: 9月9日" +
        "（火）, 10時〜12時, 200個, 800万円 — never 九月九日, 十時, 二百個. " +
        "Kanji numerals stay only in the names of things (第一会議室, " +
        "第三回, 一覧). A `chart` block, where the template allows one, " +
        "carries its figures as numbers in `series`, never as text.",
      },
    },
  };
}

/** Which fields each block type cannot do without. The schema above lets the
 *  model send anything; this is where a block that says `table` and carries no
 *  rows gets rejected. */
export const REQUIRED_BY_TYPE: Record<string, readonly string[]> = {
  "heading": ["text"],
  "paragraph": ["text"],
  "bullets": ["items"],
  "numbered": ["items"],
  "table": ["columns", "rows"],
  "key_values": ["pairs"],
  "quoted_message": ["sender", "text"],
  "callout": ["text"],
  // A chart with no title cannot be pointed at from the audio （「グラフを
  // 見てください」 — which one?）, and one with no unit is a row of numbers
  // that mean nothing.
  "chart": ["kind", "caption", "unit", "categories", "series"],
};

/** Take off the empty fields every generated block carries. Returns how
 *  many were dropped.
 *
 *  The schema requires every field on every block (see `_blockSchema`), so a
 *  paragraph arrives with `"rows": []`, `"tone": ""` and `"level": 0`. Removed
 *  here, a document is exactly what it was when those fields were optional —
 *  the validator, the renderers, the app and the bundles never see the
 *  padding. A field with something in it is left alone, whatever the block's
 *  type, as it always was. */
export function dropUnusedFields(doc: unknown): number {
  if (!isDict(doc) || !Array.isArray(get(doc, "blocks"))) {
    return 0;
  }
  let dropped = 0;
  for (const block of doc["blocks"] as unknown[]) {
    if (!isDict(block)) {
      continue;
    }
    for (const key of Object.keys(block).filter((k) => k !== "type")) {
      const value = block[key];
      if (value === null || value === undefined || value === "" ||
          (Array.isArray(value) && value.length === 0) ||
          ((_UNUSED_NUMBERS as readonly string[]).includes(key) && (value === 0 || value === false))) {
        delete block[key];
        dropped += 1;
      }
    }
  }
  return dropped;
}

/** Block types whose whole content is one text field. A block of one of these
 *  with nothing in that field is nothing, and can be dropped without changing
 *  what the document says. */
export const _TEXT_ONLY = ["heading", "paragraph", "callout"] as const;

/** Drop text blocks the model left blank. Returns how many were dropped.
 *
 *  The generator sends a heading, a callout or a paragraph with no text often
 *  enough, and a retry prompt cures it rarely enough, that rejecting the draft
 *  for it would cost whole shelves. A blank heading carries no information, so
 *  removing it loses none; a document that was nothing but blanks still fails
 *  validation, as it should. Blocks of every other type are left for the
 *  validator, which knows what a table without rows means. */
export function pruneEmptyBlocks(doc: unknown): number {
  if (!isDict(doc) || !Array.isArray(get(doc, "blocks"))) {
    return 0;
  }
  const blocks = doc["blocks"] as unknown[];
  const kept = blocks.filter(
    (b) => !(isDict(b)
             && (_TEXT_ONLY as readonly unknown[]).includes(get(b, "type"))
             && !strip(str(or(get(b, "text"), "")))),
  );
  const dropped = blocks.length - kept.length;
  doc["blocks"] = kept;
  return dropped;
}

/** Problems with a document (empty list == valid).
 *
 *  Runs before an item is stored, in the same spirit as `schemas.validateItem`:
 *  the structured-output schema constrains the shape, and the things it cannot
 *  say — a table whose rows are the wrong width, a document assigned one
 *  template that claims another — are enforced here. */
export function validateDocument(doc: unknown, opts: { template?: string | null } = {}): string[] {
  const template = opts.template ?? null;

  const errors: string[] = [];
  if (!isDict(doc)) {
    return ["document must be an object"];
  }

  const name = get(doc, "template");
  const known = typeof name === "string" && has(tpl.TEMPLATES, name);
  if (!known) {
    errors.push(`unknown template ${repr(name)}; known: ${repr(sorted(Object.keys(tpl.TEMPLATES)))}`);
  } else if (template !== null && name !== template) {
    // The template is an assignment from the seed cell, exactly like the
    // scene id is for 発言聴解. A model that substitutes a different one has
    // written a different item from the one we asked for.
    errors.push(`template ${repr(name)} does not match the assigned ${repr(template)}`);
  }

  if (!truthy(get(doc, "title"))) {
    errors.push("document is missing a title");
  }

  const meta = iterOr(get(doc, "meta"));
  const labels = new Set(meta.filter(isDict).map((m) => get(m, "label")));
  if (known) {
    const missing = tpl.TEMPLATES[name].required_meta.filter((f) => !labels.has(f));
    if (missing.length > 0) {
      errors.push(`template ${repr(name)} is missing header field(s): ${repr(missing)}`);
    }
  }

  const blocks = get(doc, "blocks");
  if (!Array.isArray(blocks) || blocks.length === 0) {
    errors.push("document has no blocks");
    return errors;
  }

  let charts = 0;
  blocks.forEach((block: unknown, i: number) => {
    if (!isDict(block)) {
      errors.push(`block ${i} is not an object`);
      return;
    }
    const btype = get(block, "type");
    if (!BLOCK_TYPES.includes(btype)) {
      errors.push(`block ${i} has unknown type ${repr(btype)}`);
      return;
    }
    for (const field of REQUIRED_BY_TYPE[btype]) {
      if (!truthy(get(block, field))) {
        errors.push(`block ${i} (${btype}) is missing ${field}`);
      }
    }
    if (btype === "table") {
      const width = pyLen(or(get(block, "columns"), []));
      iterOr(get(block, "rows")).forEach((row: unknown, r: number) => {
        if (pyLen(row) !== width) {
          errors.push(
            `block ${i} row ${r} has ${pyLen(row)} cell(s), header has ${width}`,
          );
        }
      });
    }
    if (btype === "chart") {
      charts += 1;
      for (const e of chart.errors(block)) errors.push(`block ${i} (chart) ${e}`);
      // A graph belongs on a handout of figures or in a report. In an
      // email body, on a sign or on a quotation it is not what arrives on
      // a desk, and the template is the thing that says what does.
      if (known && !tpl.TEMPLATES[name].charts) {
        const carriers = sorted(Object.entries(tpl.TEMPLATES).filter(([, v]) => v.charts).map(([t]) => t));
        errors.push(`block ${i} is a chart, and template ${repr(name)} does not carry ` +
                    `one; only ${repr(carriers)} do`);
      }
    }
  });
  if (charts > chart.MAX_PER_DOCUMENT) {
    errors.push(`document has ${charts} charts; at most ${chart.MAX_PER_DOCUMENT} ` +
                "fits on a phone screen beside everything else");
  }

  return errors;
}

/** Every word in the document, flattened.
 *
 *  The gates and the dedupe check compare items as text. A document item whose
 *  stimulus was invisible to them would sail past near-duplicate detection no
 *  matter how many times we asked the same question about the same email.
 *
 *  It is also the whole of what a model reading the document sees: the
 *  answerability gate's full and cold views, the proofreader, the difficulty
 *  probe and the discriminator all read a 資料 through this function. So a
 *  chart is written out here figure by figure (`chart.text`) — a graph that
 *  reached them as its title alone would be judged unanswerable exactly when
 *  the learner could read the answer off it — and a table's caption is here
 *  too, because it is printed above the table. */
export function textOf(doc: Record<string, any>): string {
  const parts: string[] = [str(get(doc, "title", ""))];
  for (const m of iterOr(get(doc, "meta"))) {
    parts.push(`${str(get(m, "label", ""))}${str(get(m, "value", ""))}`);
  }
  for (const block of iterOr(get(doc, "blocks"))) {
    if (!isDict(block)) {
      continue;
    }
    if (get(block, "type") === "chart") {
      parts.push(chart.text(block));
      continue;
    }
    if (truthy(get(block, "caption"))) {
      parts.push(str(block["caption"]));
    }
    if (truthy(get(block, "text"))) {
      parts.push(str(block["text"]));
    }
    for (const x of iterOr(get(block, "items"))) parts.push(str(x));
    for (const c of iterOr(get(block, "columns"))) parts.push(str(c));
    for (const row of iterOr(get(block, "rows"))) {
      for (const c of iterOf(row)) parts.push(str(c));
    }
    for (const pair of iterOr(get(block, "pairs"))) {
      parts.push(`${str(get(pair, "label", ""))}${str(get(pair, "value", ""))}`);
    }
    if (truthy(get(block, "sender"))) {
      parts.push(str(block["sender"]));
    }
  }
  return parts.filter((p) => p).join("\n");
}

/** `for x in value`: a list's elements, a string's characters, a dict's keys. */
function iterOf(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [...v];
  if (isDict(v)) return Object.keys(v);
  throw new TypeError_(`'${typeof v}' object is not iterable`);
}
