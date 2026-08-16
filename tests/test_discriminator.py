"""Discriminator loop (fidelity #3). The judge is faked so scoring is
deterministic."""
import pytest

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
