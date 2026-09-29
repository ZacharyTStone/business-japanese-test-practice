"""The document object model: what a reading item's stimulus actually *is*.

Four of the nine item types put a business document in front of the learner —
an email, a schedule, a set of minutes, a quotation. The obvious way to produce
one is to ask an image model for a picture of an email. That is the wrong answer
twice over: image models mangle kanji, and a picture cannot be selected,
scaled, read by a screen reader, or checked by a test.

So a document is **data**. The model emits this structure, and we render it
(``bjt.render.html``). The template supplies the visual grammar; the generated
content supplies only the original business writing that goes in it.

A document is a template id, a version, some metadata (the From/To/Subject of an
email, the date and attendees of a set of minutes) and an ordered list of
content blocks. Blocks are deliberately few — nine of them cover every template
in the roadmap — because every block type is a thing the renderer, the phone
layout, and the accessibility pass all have to handle.
"""
from __future__ import annotations

from typing import Any

from . import chart

#: Every block a document may contain.
#:
#: Kept small on purpose. A block type is not free: each one has to render, wrap
#: at phone width, survive large text, and mean something to a screen reader.
#: `chart` earns its place because 資料聴読解 asks for a figure read off a graph
#: as well as off a table, and a table is not a graph — the skill is reading a
#: trend off bars. It is drawn from numbers and written out as text for every
#: model that reads the document (see chart.py).
BLOCK_TYPES = [
    "heading",        # a section heading inside the document
    "paragraph",      # one run of prose
    "bullets",        # an unordered list
    "numbered",       # an ordered list — agenda items, procedure steps
    "table",          # rows and columns, with real header cells
    "key_values",     # 件名/日時/場所 — a labelled field block
    "quoted_message", # one message in a thread, with its own header
    "callout",        # a boxed notice: a deadline, a warning, a decision
    "chart",          # a bar or line graph, drawn from categories and figures
]

CALLOUT_TONES = ["info", "warning", "action"]
CHART_KINDS = chart.CHART_KINDS


def _block_schema() -> dict:
    """One JSON schema covering every block type.

    Structured output has no discriminated unions we can rely on across
    providers, so this is one object with a required `type` and everything else
    optional; `validate_document` enforces which fields each type actually
    needs. That keeps the model's job simple and puts the strictness on our
    side, which is the same split the item schema uses.
    """
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["type"],
        "properties": {
            "type": {"type": "string", "enum": BLOCK_TYPES},
            "text": {
                "type": "string",
                "description": "The content, for heading / paragraph / callout blocks.",
            },
            "level": {
                "type": "integer",
                "description": "Heading depth within the document, 2 or 3.",
            },
            "items": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List entries, for bullets / numbered blocks.",
            },
            "caption": {
                "type": "string",
                "description": "A table's caption, or a chart's title as printed above "
                "it (「月別 問い合わせ件数」) — required for a chart, at most "
                f"{chart.CAPTION_MAX_CHARS} characters.",
            },
            "columns": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Table header cells.",
            },
            "rows": {
                "type": "array",
                "items": {"type": "array", "items": {"type": "string"}},
                "description": "Table body rows; each row has one cell per column.",
            },
            "pairs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["label", "value"],
                    "properties": {
                        "label": {"type": "string"},
                        "value": {"type": "string"},
                    },
                },
                "description": "Labelled fields, for a key_values block.",
            },
            "sender": {"type": "string", "description": "Who wrote a quoted message."},
            "sent_at": {"type": "string", "description": "When a quoted message was sent."},
            "depth": {
                "type": "integer",
                "description": "How deep in the reply chain a quoted message sits; 0 is the newest.",
            },
            "tone": {
                "type": "string",
                "enum": CALLOUT_TONES,
                "description": "What a callout is for: information, a warning, or an action to take.",
            },
            # The chart's own fields. Bounds the API's schema subset cannot
            # state (no minimum/maximum, no maxItems) are stated in words here
            # and enforced by `chart.errors`, as the rest of this schema does.
            "kind": {
                "type": "string",
                "enum": CHART_KINDS,
                "description": "For a chart: `bar` to compare a few groups (branches, "
                "products, this year against last), `line` to follow one quantity "
                "through time.",
            },
            "unit": {
                "type": "string",
                "description": "For a chart: the unit every figure is in, as printed on "
                "its axis (件, 人, 万円, 千円, %). Choose it so no figure needs more than "
                "six digits — 1,250万円, never 12,500,000円. The unit goes here and "
                "not into the caption.",
            },
            "categories": {
                "type": "array",
                "items": {"type": "string"},
                "description": "For a chart: the labels along its axis, in order — "
                "months, branches, products. "
                f"{chart.MIN_CATEGORIES}–{chart.MAX_CATEGORIES['bar']} for a bar chart, "
                f"{chart.MIN_CATEGORIES}–{chart.MAX_CATEGORIES['line']} for a line; each "
                f"at most {chart.CATEGORY_MAX_CHARS} characters (4月, 第1四半期, 大阪支店).",
            },
            "series": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["name", "values"],
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "What this series is, as its legend says it "
                            "(電話, 前年度, 計画). May be empty only when there is one "
                            f"series; at most {chart.SERIES_NAME_MAX_CHARS} characters.",
                        },
                        "values": {
                            "type": "array",
                            "items": {"type": "number"},
                            "description": "One figure per category, in the same order: "
                            "plain numbers in the chart's unit, at most two decimal "
                            "places.",
                        },
                    },
                },
                "description": f"For a chart: one to {chart.MAX_SERIES} series of figures. "
                "The figures are numbers here, never text.",
            },
        },
    }


def document_schema() -> dict:
    """The schema handed to the model for a document stimulus."""
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["template", "title", "meta", "blocks"],
        "properties": {
            "template": {
                "type": "string",
                "description": "Which template renders this document. Assigned by the "
                "seed cell — do not substitute a different one.",
            },
            "title": {
                "type": "string",
                "description": "The document's own title as it appears at the top: an "
                "email subject line, a memo heading, the name of a report. Numbers "
                "in Arabic digits (「10月 新人研修 予定表」, not 「十月 …」).",
            },
            "meta": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["label", "value"],
                    "properties": {
                        "label": {"type": "string"},
                        "value": {"type": "string"},
                    },
                },
                "description": "The template's header fields — From/To/Date for an "
                "email, 日時/場所/出席者 for minutes. Labels in Japanese. Dates and "
                "times in Arabic digits (「9月9日（火）10時〜12時」).",
            },
            "blocks": {
                "type": "array",
                "items": _block_schema(),
                "description": "The body, in reading order. Write every number "
                "with Arabic digits, as a real business document does: 9月9日"
                "（火）, 10時〜12時, 200個, 800万円 — never 九月九日, 十時, 二百個. "
                "Kanji numerals stay only in the names of things (第一会議室, "
                "第三回, 一覧). A `chart` block, where the template allows one, "
                "carries its figures as numbers in `series`, never as text.",
            },
        },
    }


#: Which fields each block type cannot do without. The schema above lets the
#: model send anything; this is where a block that says `table` and carries no
#: rows gets rejected.
REQUIRED_BY_TYPE: dict[str, tuple[str, ...]] = {
    "heading": ("text",),
    "paragraph": ("text",),
    "bullets": ("items",),
    "numbered": ("items",),
    "table": ("columns", "rows"),
    "key_values": ("pairs",),
    "quoted_message": ("sender", "text"),
    "callout": ("text",),
    # A chart with no title cannot be pointed at from the audio （「グラフを
    # 見てください」 — which one?）, and one with no unit is a row of numbers
    # that mean nothing.
    "chart": ("kind", "caption", "unit", "categories", "series"),
}


#: Block types whose whole content is one text field. A block of one of these
#: with nothing in that field is nothing, and can be dropped without changing
#: what the document says.
_TEXT_ONLY = ("heading", "paragraph", "callout")


def prune_empty_blocks(doc: Any) -> int:
    """Drop text blocks the model left blank. Returns how many were dropped.

    The generator sends a heading, a callout or a paragraph with no text often
    enough, and a retry prompt cures it rarely enough, that rejecting the draft
    for it would cost whole shelves. A blank heading carries no information, so
    removing it loses none; a document that was nothing but blanks still fails
    validation, as it should. Blocks of every other type are left for the
    validator, which knows what a table without rows means.
    """
    if not isinstance(doc, dict) or not isinstance(doc.get("blocks"), list):
        return 0
    kept = [
        b for b in doc["blocks"]
        if not (isinstance(b, dict)
                and b.get("type") in _TEXT_ONLY
                and not str(b.get("text") or "").strip())
    ]
    dropped = len(doc["blocks"]) - len(kept)
    doc["blocks"] = kept
    return dropped


def validate_document(doc: Any, *, template: str | None = None) -> list[str]:
    """Problems with a document (empty list == valid).

    Runs before an item is stored, in the same spirit as ``schemas.validate_item``:
    the structured-output schema constrains the shape, and the things it cannot
    say — a table whose rows are the wrong width, a document assigned one
    template that claims another — are enforced here.
    """
    from . import templates as tpl

    errors: list[str] = []
    if not isinstance(doc, dict):
        return ["document must be an object"]

    name = doc.get("template")
    if name not in tpl.TEMPLATES:
        errors.append(f"unknown template {name!r}; known: {sorted(tpl.TEMPLATES)}")
    elif template is not None and name != template:
        # The template is an assignment from the seed cell, exactly like the
        # scene id is for 発言聴解. A model that substitutes a different one has
        # written a different item from the one we asked for.
        errors.append(f"template {name!r} does not match the assigned {template!r}")

    if not doc.get("title"):
        errors.append("document is missing a title")

    meta = doc.get("meta") or []
    labels = {m.get("label") for m in meta if isinstance(m, dict)}
    if name in tpl.TEMPLATES:
        missing = [f for f in tpl.TEMPLATES[name].required_meta if f not in labels]
        if missing:
            errors.append(f"template {name!r} is missing header field(s): {missing}")

    blocks = doc.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        errors.append("document has no blocks")
        return errors

    charts = 0
    for i, block in enumerate(blocks):
        if not isinstance(block, dict):
            errors.append(f"block {i} is not an object")
            continue
        btype = block.get("type")
        if btype not in BLOCK_TYPES:
            errors.append(f"block {i} has unknown type {btype!r}")
            continue
        for field in REQUIRED_BY_TYPE[btype]:
            if not block.get(field):
                errors.append(f"block {i} ({btype}) is missing {field}")
        if btype == "table":
            width = len(block.get("columns") or [])
            for r, row in enumerate(block.get("rows") or []):
                if len(row) != width:
                    errors.append(
                        f"block {i} row {r} has {len(row)} cell(s), header has {width}"
                    )
        if btype == "chart":
            charts += 1
            errors.extend(f"block {i} (chart) {e}" for e in chart.errors(block))
            # A graph belongs on a handout of figures or in a report. In an
            # email body, on a sign or on a quotation it is not what arrives on
            # a desk, and the template is the thing that says what does.
            if name in tpl.TEMPLATES and not tpl.TEMPLATES[name].charts:
                carriers = sorted(t for t, v in tpl.TEMPLATES.items() if v.charts)
                errors.append(f"block {i} is a chart, and template {name!r} does not carry "
                              f"one; only {carriers} do")
    if charts > chart.MAX_PER_DOCUMENT:
        errors.append(f"document has {charts} charts; at most {chart.MAX_PER_DOCUMENT} "
                      "fits on a phone screen beside everything else")

    return errors


def text_of(doc: dict) -> str:
    """Every word in the document, flattened.

    The gates and the dedupe check compare items as text. A document item whose
    stimulus was invisible to them would sail past near-duplicate detection no
    matter how many times we asked the same question about the same email.

    It is also the whole of what a model reading the document sees: the
    answerability gate's full and cold views, the proofreader, the difficulty
    probe and the discriminator all read a 資料 through this function. So a
    chart is written out here figure by figure (`chart.text`) — a graph that
    reached them as its title alone would be judged unanswerable exactly when
    the learner could read the answer off it — and a table's caption is here
    too, because it is printed above the table.
    """
    parts: list[str] = [str(doc.get("title", ""))]
    for m in doc.get("meta") or []:
        parts.append(f"{m.get('label', '')}{m.get('value', '')}")
    for block in doc.get("blocks") or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "chart":
            parts.append(chart.text(block))
            continue
        if block.get("caption"):
            parts.append(str(block["caption"]))
        if block.get("text"):
            parts.append(str(block["text"]))
        parts.extend(str(x) for x in block.get("items") or [])
        parts.extend(str(c) for c in block.get("columns") or [])
        for row in block.get("rows") or []:
            parts.extend(str(c) for c in row)
        for pair in block.get("pairs") or []:
            parts.append(f"{pair.get('label', '')}{pair.get('value', '')}")
        if block.get("sender"):
            parts.append(str(block["sender"]))
    return "\n".join(p for p in parts if p)
