"""Discriminator loop (fidelity #3). The judge is faked so scoring is
deterministic."""
import pytest

from bjt import textutil
from bjt.fidelity import discriminator


def _make_items(prefix, n):
    return [
        {"item_type": "goi_bunpou", "level": "J2", "stem": f"{prefix}-{i}",
         "options": [{"text": "a"}], "explanation_ja": "e"}
        for i in range(n)
    ]


def _perfect_judge(rendered, model=None):
    # Generated stems contain 'GEN', official contain 'OFF'.
    labels = ["synthetic" if "GEN" in r else "official" for r in rendered]
    return {"labels": labels, "reasons": ["stems differ"]}


def _blind_judge(rendered, model=None):
    return {"labels": ["official"] * len(rendered), "reasons": ["cannot tell"]}


def test_perfect_judge_scores_1(monkeypatch):
    monkeypatch.setattr(discriminator.llm, "judge_synthetic", _perfect_judge)
    gen = _make_items("GEN", 4)
    off = _make_items("OFF", 4)
    res = discriminator.run_discriminator("goi_bunpou", gen, off, seed=1)
    assert res.discrimination_rate == 1.0
    assert res.n_generated == 4 and res.n_official == 4


def test_blind_judge_scores_chance(monkeypatch):
    """A judge that labels everything 'official' scores exactly the official
    fraction — 50% with a balanced mix."""
    monkeypatch.setattr(discriminator.llm, "judge_synthetic", _blind_judge)
    gen = _make_items("GEN", 5)
    off = _make_items("OFF", 5)
    res = discriminator.run_discriminator("goi_bunpou", gen, off, seed=1)
    assert res.discrimination_rate == 0.5


def test_requires_both_sides():
    with pytest.raises(ValueError):
        discriminator.run_discriminator("goi_bunpou", [], _make_items("OFF", 2))


def test_misaligned_label_count_scored_on_prefix(monkeypatch):
    def short_judge(rendered, model=None):
        return {"labels": ["synthetic"], "reasons": []}
    monkeypatch.setattr(discriminator.llm, "judge_synthetic", short_judge)
    res = discriminator.run_discriminator(
        "goi_bunpou", _make_items("GEN", 2), _make_items("OFF", 2), seed=1
    )
    # Only one label returned; rate is scored over that single aligned item.
    assert res.discrimination_rate in (0.0, 1.0)


# ----- the judge sees the whole stimulus ---------------------------------

def _document_item(prefix, with_document=True):
    item = {
        "item_type": "joukyou_haaku", "level": "J2", "stem": f"{prefix}-stem",
        "options": [{"text": "a"}], "explanation_ja": "e",
    }
    if with_document:
        item["document"] = {
            "template": "schedule", "title": "会議室 予約状況",
            "meta": [], "blocks": [{"type": "table", "columns": ["会議室", "10時〜12時"],
                                    "rows": [["第一会議室", "空き"]]}],
        }
    return item


def test_the_rendering_carries_the_document():
    """Until 2026-09-22 it did not, and the four types whose stimulus is mostly
    a 資料 were judged on the stem and the options alone."""
    rendered = textutil.render_for_discriminator(_document_item("GEN"))
    assert "--- 資料 ---" in rendered
    assert "会議室 予約状況" in rendered
    assert "10時〜12時" in rendered
    assert "GEN-stem" in rendered


def test_the_rendering_carries_the_dialogue():
    item = _document_item("GEN", with_document=False)
    item["dialogue"] = [{"speaker_role": "manager_m", "text": "お願いします。"}]
    rendered = textutil.render_for_discriminator(item)
    assert "--- 会話 ---" in rendered
    assert "お願いします。" in rendered


def test_an_item_with_no_document_renders_as_before():
    """No section markers for a type that has neither — 語彙・文法 is a stem and
    four options, and dressing it up would be a tell of its own."""
    rendered = textutil.render_for_discriminator(_make_items("GEN", 1)[0])
    assert "---" not in rendered.replace("[goi_bunpou / J2]", "")


def test_refuses_to_score_documents_against_samples_that_have_none(monkeypatch):
    """The official seed files arrive without the 資料 transcribed, so this
    comparison is winnable on the shape of the seed file. Scoring it would put
    a bogus 100% on the dashboard AND fold "has a 資料" into the generator
    prompt as a tell to avoid."""
    monkeypatch.setattr(discriminator.llm, "judge_synthetic", _perfect_judge)
    with pytest.raises(ValueError, match="資料"):
        discriminator.run_discriminator(
            "joukyou_haaku",
            [_document_item("GEN")],
            [_document_item("OFF", with_document=False)],
        )


def test_scores_normally_when_both_sides_carry_the_document(monkeypatch):
    monkeypatch.setattr(discriminator.llm, "judge_synthetic", _perfect_judge)
    res = discriminator.run_discriminator(
        "joukyou_haaku", [_document_item("GEN")], [_document_item("OFF")], seed=1,
    )
    assert res.discrimination_rate == 1.0


def test_official_extras_do_not_trip_the_guard(monkeypatch):
    """The guard is about a stimulus WE add and the samples lack. An official
    sample richer than our items is not a tell we created, so it scores."""
    monkeypatch.setattr(discriminator.llm, "judge_synthetic", _blind_judge)
    res = discriminator.run_discriminator(
        "joukyou_haaku",
        [_document_item("GEN", with_document=False)],
        [_document_item("OFF")], seed=1,
    )
    assert res.n_generated == 1 and res.n_official == 1
