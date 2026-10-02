"""The document renderer: validation, escaping, and the semantics that make a
document readable with a screen reader rather than merely visible."""
import pytest

from bjt import render
from bjt.render import templates as tpl


def _email(**overrides):
    doc = {
        "template": "email_external",
        "title": "納品日変更のお願い",
        "meta": [
            {"label": "差出人", "value": "山川商事 佐藤"},
            {"label": "宛先", "value": "みどり物産 田中様"},
            {"label": "件名", "value": "納品日変更のお願い"},
            {"label": "日時", "value": "4月8日 10:20"},
        ],
        "blocks": [
            {"type": "paragraph", "text": "いつもお世話になっております。"},
            {"type": "bullets", "items": ["現行の納品日：4月15日", "希望する納品日：4月22日"]},
        ],
    }
    doc.update(overrides)
    return doc


# ----- validation ---------------------------------------------------------

def test_a_well_formed_document_validates():
    assert render.validate_document(_email()) == []


def test_an_unknown_template_is_rejected():
    errors = render.validate_document(_email(template="postcard"))
    assert any("unknown template" in e for e in errors)


def test_the_template_is_an_assignment_not_a_suggestion():
    """The seed cell assigns the template the same way it assigns a scene id.
    Substituting one means the item is not the item we asked for."""
    errors = render.validate_document(_email(), template="meeting_minutes")
    assert any("does not match the assigned" in e for e in errors)


def test_a_missing_header_field_is_rejected():
    """An email with no 件名 is not an email, and an item built on one would be
    testing something other than what it claims."""
    doc = _email()
    doc["meta"] = [m for m in doc["meta"] if m["label"] != "件名"]
    errors = render.validate_document(doc)
    assert any("件名" in e for e in errors)


def test_a_table_row_that_does_not_match_its_header_is_rejected():
    doc = _email(blocks=[{
        "type": "table",
        "columns": ["品名", "数量", "単価"],
        "rows": [["A4用紙", "10"]],
    }])
    errors = render.validate_document(doc)
    assert any("cell(s), header has 3" in e for e in errors)


def test_a_block_missing_its_content_is_rejected():
    errors = render.validate_document(_email(blocks=[{"type": "table", "columns": ["品名"]}]))
    assert any("missing rows" in e for e in errors)


def test_blank_text_blocks_are_pruned_and_the_rest_validates():
    """A blank heading or callout says nothing, so it is dropped rather than
    failing the draft as 'missing text' on every attempt."""
    doc = _email(blocks=[
        {"type": "heading", "text": "  "},
        {"type": "paragraph", "text": "本文です。"},
        {"type": "callout", "tone": "warning"},
        {"type": "bullets", "items": ["一", "二"]},
    ])
    assert any("missing text" in e for e in render.validate_document(doc))
    assert render.prune_empty_blocks(doc) == 2
    assert [b["type"] for b in doc["blocks"]] == ["paragraph", "bullets"]
    assert render.validate_document(doc) == []
    # A table with no rows is not a blank text block; the validator keeps its say.
    doc = _email(blocks=[{"type": "table", "columns": ["品名"]}])
    assert render.prune_empty_blocks(doc) == 0
    # And a document that was nothing but blanks still fails, as it should.
    doc = _email(blocks=[{"type": "heading"}])
    render.prune_empty_blocks(doc)
    assert any("no blocks" in e for e in render.validate_document(doc))
    assert render.prune_empty_blocks("not a document") == 0


def test_a_document_with_no_blocks_is_rejected():
    assert any("no blocks" in e for e in render.validate_document(_email(blocks=[])))


# ----- rendering ----------------------------------------------------------

def test_content_is_escaped():
    """Document content comes out of a model. It is data interpolated into
    HTML, so there is no trusted path and no exception."""
    html = render.render(_email(title='<script>alert("x")</script>'))
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_tables_get_real_header_cells():
    html = render.render(_email(blocks=[{
        "type": "table",
        "columns": ["品名", "数量"],
        "rows": [["A4用紙", "10"]],
    }]))
    assert '<th scope="col">品名</th>' in html
    # The first body cell is a row header, so a reader hears "A4用紙 — 10"
    # rather than a bare number.
    assert '<th scope="row">A4用紙</th>' in html
    assert "<td>10</td>" in html


def test_header_fields_render_as_a_definition_list():
    html = render.render(_email())
    assert "<dl" in html and "<dt>件名</dt>" in html


def test_heading_depth_is_clamped():
    """A document sits inside a screen that already owns h1."""
    assert "<h2" in render.render(_email(blocks=[{"type": "heading", "text": "件名", "level": 1}]))
    assert "<h4" in render.render(_email(blocks=[{"type": "heading", "text": "件名", "level": 9}]))


def test_an_unknown_block_type_drops_rather_than_raising():
    """A learner is in the middle of reading this. Losing one paragraph beats
    losing the screen."""
    html = render.render(_email(blocks=[
        {"type": "sparkline", "text": "?"},
        {"type": "paragraph", "text": "残ります"},
    ]))
    assert "残ります" in html


def test_render_never_emits_an_image():
    """A picture of a document cannot be selected, scaled, or read aloud — and
    an image model cannot spell 御中 reliably either."""
    html = render.render_page(_email())
    assert "<img" not in html and "background-image" not in html


def test_the_page_declares_japanese_and_a_viewport():
    page = render.render_page(_email())
    assert 'lang="ja"' in page
    assert "width=device-width" in page


# ----- text extraction ----------------------------------------------------

def test_text_of_reaches_every_corner_of_the_document():
    """The dedupe check and the answerability gate compare items as text. A
    stimulus they cannot see would sail past near-duplicate detection however
    many times we asked the same question about the same email."""
    doc = _email(blocks=[
        {"type": "paragraph", "text": "本文です"},
        {"type": "table", "columns": ["品名"], "rows": [["A4用紙"]]},
        {"type": "key_values", "pairs": [{"label": "納期", "value": "4月22日"}]},
        {"type": "quoted_message", "sender": "田中", "text": "承知しました"},
    ])
    text = render.text_of(doc)
    for fragment in ("納品日変更のお願い", "本文です", "A4用紙", "納期", "4月22日", "田中", "承知しました"):
        assert fragment in text


# ----- the templates themselves -------------------------------------------

@pytest.mark.parametrize("template_id", sorted(tpl.TEMPLATES))
def test_every_template_declares_what_it_needs(template_id):
    t = tpl.TEMPLATES[template_id]
    assert t.required_meta, f"{template_id} requires no header fields"
    assert t.suits, f"{template_id} is not offered to any item type"
    assert template_id in render.spec(template_id)


def test_the_app_can_draw_every_block_and_template_the_pipeline_ships():
    """Two renderers for one data model (html.py here, document.tsx in the app),
    and the app's drops a block it does not know rather than crashing — which
    is right for a learner mid-question and silent for everybody else. A block
    type or a template added here and not there would ship documents the app
    shows with a hole in them, so the app's lists are held to these."""
    import pathlib
    import re
    client = pathlib.Path(__file__).resolve().parents[1] / "client" / "src"
    types_ts = (client / "lib" / "types.ts").read_text(encoding="utf-8")
    union = re.search(r"export type DocBlock = \{\s*type:([^;]*?);", types_ts, re.S)
    assert union, "types.ts no longer declares DocBlock's type union as expected"
    assert set(re.findall(r'"(\w+)"', union.group(1))) == set(render.BLOCK_TYPES)
    document_tsx = (client / "ui" / "document.tsx").read_text(encoding="utf-8")
    for table in ("TEMPLATE_KEY", "CHROME"):
        body = re.search(rf"const {table}: Record<string, \w+> = \{{(.*?)\n\}};", document_tsx, re.S)
        assert body, f"document.tsx no longer declares {table} as expected"
        assert set(re.findall(r"^\s*(\w+):", body.group(1), re.M)) == set(tpl.TEMPLATES), table
    block = re.search(r"function Block\(.*?\n\}\n", document_tsx, re.S)
    assert block and set(re.findall(r'case "(\w+)":', block.group(0))) == set(render.BLOCK_TYPES)


def test_every_document_item_type_has_at_least_one_template():
    for item_type in ("shiryou_choudokkai", "sougou_choudokkai", "sougou_dokkai",
                      "joukyou_haaku", "bamen_haaku"):
        assert render.for_item_type(item_type), f"{item_type} has no template"


# ----- the chart block ------------------------------------------------------

from bjt.render import chart


def _bar(**overrides):
    block = {
        "type": "chart", "kind": "bar", "caption": "月別 問い合わせ件数", "unit": "件",
        "categories": ["4月", "5月", "6月"],
        "series": [{"name": "電話", "values": [330, 410, 340]},
                   {"name": "メール", "values": [150, 190, 250]}],
    }
    block.update(overrides)
    return block


def _figures(*blocks, template="figures"):
    return {
        "template": template,
        "title": "問い合わせ件数の推移",
        "meta": [{"label": "期間", "value": "4月〜6月"}, {"label": "作成者", "value": "山田"}],
        "blocks": list(blocks) or [_bar()],
    }


def test_a_well_formed_chart_validates():
    assert render.validate_document(_figures()) == []
    line = _bar(kind="line", categories=[f"{m}月" for m in range(1, 13)],
                series=[{"name": "", "values": [1.5 * m for m in range(12)]}])
    assert render.validate_document(_figures(line)) == []


@pytest.mark.parametrize("field", ["kind", "caption", "unit", "categories", "series"])
def test_a_chart_needs_every_one_of_its_fields(field):
    """A chart with no title cannot be pointed at from the audio, one with no
    unit is numbers that mean nothing, and one with no figures is nothing."""
    block = _bar()
    del block[field]
    errors = render.validate_document(_figures(block))
    assert any(f"missing {field}" in e for e in errors), errors


@pytest.mark.parametrize("overrides,expected", [
    ({"kind": "pie"}, "one of ['bar', 'line']"),
    ({"categories": ["4月"], "series": [{"name": "", "values": [1]}]}, "takes 2–8"),
    ({"categories": [f"{m}月" for m in range(1, 10)],
      "series": [{"name": "", "values": list(range(1, 10))}]}, "takes 2–8"),
    ({"categories": ["4月", "5月", "6月"], "series": [{"name": "", "values": [1, 2]}]},
     "2 value(s) for 3 categories"),
    ({"categories": ["カスタマーセンター", "5月", "6月"]}, "longer than 8"),
    ({"categories": ["4月", "4月", "6月"]}, "repeats a category"),
    ({"categories": ["4月", " ", "6月"]}, "blank category"),
    ({"series": [{"name": "電話", "values": [1, float("nan"), 3]}]}, "not a finite number"),
    ({"series": [{"name": "電話", "values": [1, float("inf"), 3]}]}, "not a finite number"),
    ({"series": [{"name": "電話", "values": [1, "2", 3]}]}, "not a finite number"),
    ({"series": [{"name": "電話", "values": [1, True, 3]}]}, "not a finite number"),
    ({"series": [{"name": "電話", "values": [1, 12_500_000, 3]}]}, "more than six digits"),
    ({"series": [{"name": "電話", "values": [1, 2.125, 3]}]}, "decimal places"),
    ({"series": [{"name": "電話", "values": [0, 0, 0]}]}, "nothing but zeros"),
    ({"series": [{"name": n, "values": [1, 2, 3]} for n in "ABCD"]}, "at most 3"),
    ({"series": [{"name": "電話", "values": [1, 2, 3]}, {"name": "", "values": [1, 2, 3]}]},
     "names every series"),
    ({"series": [{"name": "電話", "values": [1, 2, 3]}, {"name": "電話", "values": [3, 2, 1]}]},
     "same name"),
    ({"caption": "あ" * 41}, "caption longer than 40"),
    ({"unit": "あ" * 9}, "unit longer than 8"),
])
def test_a_chart_that_cannot_be_read_on_a_phone_is_rejected(overrides, expected):
    errors = render.validate_document(_figures(_bar(**overrides)))
    assert any(expected in e for e in errors), errors


def test_a_line_takes_a_year_of_months_where_bars_take_eight():
    months = [f"{m}月" for m in range(4, 13)] + ["1月", "2月", "3月"]
    line = _bar(kind="line", categories=months, series=[{"name": "", "values": list(range(1, 13))}])
    assert render.validate_document(_figures(line)) == []
    assert any("takes 2–8" in e for e in render.validate_document(_figures(_bar(
        categories=months, series=[{"name": "", "values": list(range(1, 13))}]))))


def test_a_chart_goes_only_where_its_template_carries_one():
    """A graph belongs on a handout of figures or in a progress report. In the
    body of an email or on a sign it is not what arrives on a desk."""
    assert render.validate_document(_figures(_bar(), template="progress_report") | {
        "meta": [{"label": "報告者", "value": "山田"}, {"label": "報告日", "value": "10月1日"},
                 {"label": "案件", "value": "新システム導入"}]}) == []
    email = _email(blocks=[_bar()])
    errors = render.validate_document(email)
    assert any("does not carry one" in e and "figures" in e for e in errors), errors
    carriers = sorted(t for t, v in tpl.TEMPLATES.items() if v.charts)
    assert carriers == ["figures", "progress_report"]


def test_one_chart_to_a_document():
    errors = render.validate_document(_figures(_bar(), _bar(caption="もう一つ")))
    assert any("2 charts" in e for e in errors), errors


def test_the_figures_template_is_a_handout_for_the_listening_and_reading_types():
    t = tpl.TEMPLATES["figures"]
    assert t.charts and set(t.suits) == {"shiryou_choudokkai", "sougou_choudokkai"}
    assert "figures" in {x.id for x in render.for_item_type("shiryou_choudokkai")}


def _walk(schema, path="schema"):
    yield path, schema
    if isinstance(schema, dict):
        for key, value in schema.items():
            yield from _walk(value, f"{path}.{key}")
    elif isinstance(schema, list):
        for i, value in enumerate(schema):
            yield from _walk(value, f"{path}[{i}]")


@pytest.mark.parametrize("item_type", ["shiryou_choudokkai", "sougou_choudokkai",
                                       "joukyou_haaku", "sougou_dokkai"])
def test_the_document_schema_asks_only_for_what_structured_output_can_enforce(item_type):
    """The API's schema subset has no numeric bounds, no string lengths and no
    maxItems, and a schema that uses one is refused outright — every shelf of
    the night, not one item. The chart's bounds are therefore stated in words
    and enforced by `chart.errors`; this holds the schema to that."""
    from bjt import schemas
    unsupported = {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
                   "multipleOf", "minLength", "maxLength", "maxItems", "pattern"}
    for path, node in _walk(schemas.build_item_schema(item_type)):
        if isinstance(node, dict) and "properties" not in path.rsplit(".", 1)[-1]:
            assert not unsupported & set(node), f"{path} uses {unsupported & set(node)}"
            if node.get("type") == "object":
                assert node.get("additionalProperties") is False, path
            if "minItems" in node:
                assert node["minItems"] in (0, 1), path


def test_text_of_writes_every_figure_beside_its_label():
    """Every model that reads a 資料 reads it through text_of — the gate's two
    views, the proofreader, the difficulty probe, the discriminator. A chart
    that reached them as its title alone would be 'unanswerable' exactly when
    a learner could read the answer off it."""
    text = render.text_of(_figures())
    assert "【棒グラフ】月別 問い合わせ件数（単位：件）" in text
    assert "電話：4月 330 / 5月 410 / 6月 340" in text
    assert "メール：4月 150 / 5月 190 / 6月 250" in text


@pytest.mark.parametrize("value,printed", [
    (1250, "1,250"), (1250.0, "1,250"), (12.5, "12.5"), (-3, "-3"), (0.25, "0.25"),
    (999999, "999,999"), (float("nan"), "—"), (True, "—"),
])
def test_figures_are_printed_the_way_print_sets_them(value, printed):
    assert chart.format_value(value) == printed


@pytest.mark.parametrize("values,expected", [
    ([330, 410, 460, 150], [0, 100, 200, 300, 400, 500]),
    ([-5, 12], [-5, 0, 5, 10, 15]),
    ([0.5, 1.2], [0, 0.25, 0.5, 0.75, 1, 1.25]),
    ([7, 7, 7], [0, 2, 4, 6, 8]),
    ([0, 0], [0, 0.2, 0.4, 0.6, 0.8, 1]),
])
def test_the_axis_is_round_numbers_from_zero_past_every_figure(values, expected):
    ticks = chart.axis(values)
    assert ticks == pytest.approx(expected)
    assert 0 in ticks and ticks[0] <= min(values) and ticks[-1] >= max(values)


def test_a_chart_renders_as_a_figure_with_its_figures_in_a_table():
    """Drawn for the eye, tabulated for the ear: the SVG is hidden from a
    screen reader, which walks a real table of the same figures instead."""
    html = render.render(_figures())
    assert '<figure class="doc-chart" data-kind="bar">' in html
    assert "<figcaption" in html and "月別 問い合わせ件数" in html and "（単位：件）" in html
    assert '<svg class="doc-chart-plot"' in html and 'aria-hidden="true"' in html
    assert '<th scope="col">電話</th>' in html and '<th scope="row">5月</th>' in html
    assert "<td>410</td>" in html
    assert html.count("<rect") >= 6            # three months × two series, plus swatches
    assert '<ul class="doc-chart-legend">' in html
    assert "<img" not in render.render_page(_figures())


def test_a_line_chart_draws_one_line_per_series_and_says_which_is_which():
    doc = _figures(_bar(kind="line"))
    html = render.render(doc)
    assert html.count("<polyline") == 2
    assert 'stroke-dasharray="6 4"' in html  # the second series is dashed, not coloured


def test_chart_labels_are_escaped():
    html = render.render(_figures(_bar(caption='<script>alert("x")</script>',
                                       categories=["<b>", "5月", "6月"])))
    assert "<script>" not in html and "<b>" not in html
    assert "&lt;script&gt;" in html and "&lt;b&gt;" in html


@pytest.mark.parametrize("block", [
    {"type": "chart", "kind": "bar", "caption": "空", "unit": "件"},
    {"type": "chart", "kind": "donut", "caption": "x", "unit": "件", "categories": ["a", "b"],
     "series": [{"name": "", "values": [1, float("nan")]}]},
    {"type": "chart", "categories": ["a", "b", "c"], "series": [{"values": [1]}, "junk"]},
    {"type": "chart", "categories": "not a list", "series": {"values": 3}},
])
def test_a_malformed_chart_draws_what_it_can_rather_than_raising(block):
    """Validation runs before anything is published; a renderer is still the
    one place a bad block must not take the screen down with it."""
    html = render.render(_figures(block))
    assert "</article>" in html
    render.text_of(_figures(block))


# ----- every block field required, the empties taken off ------------------

#: Every field a block can carry, as the schema sends it when unused.
_EMPTY_BLOCK = {"text": "", "level": 0, "items": [], "caption": "", "columns": [], "rows": [],
                "pairs": [], "sender": "", "sent_at": "", "depth": 0, "tone": "", "kind": "",
                "unit": "", "categories": [], "series": []}


def _padded(block):
    """A block as the generator receives it now: every field present."""
    return {**_EMPTY_BLOCK, **block}


@pytest.mark.parametrize("item_type", ["shiryou_choudokkai", "sougou_choudokkai",
                                       "joukyou_haaku", "sougou_dokkai"])
def test_no_generation_schema_has_optional_document_fields(item_type):
    """Optional fields are what make the API's compiled grammar grow. With the
    chart's four added, the 総合聴読解 schema — documents and a dialogue, sixteen
    optional fields — was refused as "Schema is too complex" every night from
    2026-09-28, before a token was written. Every block field is required now,
    and nothing else in a document type's schema may be optional but the
    scene id."""
    from bjt import schemas
    optional = []
    for path, node in _walk(schemas.build_item_schema(item_type)):
        if isinstance(node, dict) and node.get("type") == "object":
            optional += [f"{path}.{k}" for k in set(node.get("properties", {}))
                         - set(node.get("required", []))]
    assert [p for p in optional if not p.endswith(".scene_id")] == [], optional
    block = render.document_schema()["properties"]["blocks"]["items"]
    assert set(block["required"]) == set(block["properties"]) == {"type", *_EMPTY_BLOCK}
    # An enum field must be able to say "unused".
    assert "" in block["properties"]["tone"]["enum"]
    assert "" in block["properties"]["kind"]["enum"]


def test_unused_fields_come_off_and_the_document_is_what_it_was():
    """Stripped as the draft arrives, the padding never reaches the validator,
    the renderers, the app or a bundle: each block is exactly the block an
    optional schema would have produced."""
    plain = [
        {"type": "heading", "text": "日程", "level": 2},
        {"type": "paragraph", "text": "本文です。"},
        {"type": "table", "caption": "在庫", "columns": ["品名", "数"], "rows": [["A", "3"]]},
        {"type": "quoted_message", "sender": "佐藤", "sent_at": "4月8日", "text": "了解です。",
         "depth": 2},
        {"type": "callout", "text": "締切は4月10日です。", "tone": "warning"},
        _bar(),
    ]
    doc = _figures(*[_padded(b) for b in plain])
    assert render.drop_unused_fields(doc) > 0
    assert doc["blocks"] == plain
    assert render.drop_unused_fields(doc) == 0  # nothing left to take off


def test_a_newest_quoted_message_reads_the_same_without_its_zero():
    """depth 0 is the newest message, and a missing depth reads as 0 in both
    renderers, so the 0 goes with the rest of the padding."""
    doc = _email(blocks=[_padded({"type": "quoted_message", "sender": "佐藤", "text": "了解です。"})])
    render.drop_unused_fields(doc)
    assert doc["blocks"] == [{"type": "quoted_message", "sender": "佐藤", "text": "了解です。"}]
    assert render.validate_document(doc) == []


def test_a_block_left_empty_still_fails_for_what_it_lacks():
    """Taking the empties off does not hide a block that is empty where it
    matters: a chart with kind "" is a chart without a kind."""
    doc = _figures(_padded({**_bar(), "kind": ""}))
    render.drop_unused_fields(doc)
    assert any("missing kind" in e for e in render.validate_document(doc))
    assert render.drop_unused_fields("not a document") == 0
