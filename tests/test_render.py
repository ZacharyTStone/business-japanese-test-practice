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


def test_every_document_item_type_has_at_least_one_template():
    for item_type in ("shiryou_choudokkai", "sougou_choudokkai", "sougou_dokkai",
                      "joukyou_haaku", "bamen_haaku"):
        assert render.for_item_type(item_type), f"{item_type} has no template"
