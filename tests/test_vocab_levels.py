"""Vocabulary gate (fidelity #5) and level descriptors."""
from bjt import levels
from bjt.fidelity import vocab


def _write_tier(seeds_dir, tier, kanji):
    (seeds_dir / "vocab" / f"jlpt_{tier}_kanji.txt").write_text(kanji, encoding="utf-8")


def test_permissive_when_tiers_incomplete(seeds_dir, goi_item):
    _write_tier(seeds_dir, "n5", "日 月 火")  # J3 needs N5+N4+N3
    res = vocab.check_item(goi_item, "J3")
    assert res.enforced is False
    assert "missing tier data" in res.note
    assert res.ok  # permissive -> no violations


def test_enforced_flags_above_band(seeds_dir):
    for t in ("n5", "n4", "n3"):
        _write_tier(seeds_dir, t, "日 月 火")
    item = {"stem": "議事録", "options": [{"text": "日"}], "explanation_ja": ""}
    res = vocab.check_item(item, "J3")
    assert res.enforced is True
    assert set(res.violations) == {"議", "事", "録"}
    assert not res.ok


def test_enforced_clean_when_all_in_band(seeds_dir):
    for t in ("n5", "n4", "n3"):
        _write_tier(seeds_dir, t, "日 月 火")
    item = {"stem": "日月火", "options": [{"text": "日"}], "explanation_ja": "火"}
    res = vocab.check_item(item, "J3")
    assert res.enforced is True
    assert res.violations == []
    assert res.ok


def test_business_terms_reported(seeds_dir):
    (seeds_dir / "vocab" / "business_terms.txt").write_text("納期\n見積書\n", encoding="utf-8")
    item = {"stem": "納期を確認します", "options": [{"text": "見積書の件"}], "explanation_ja": ""}
    res = vocab.check_item(item, "J1")  # J1 permissive on kanji
    assert set(res.business_terms_used) == {"納期", "見積書"}


def test_status_summary(seeds_dir):
    _write_tier(seeds_dir, "n5", "日 月")
    (seeds_dir / "vocab" / "business_terms.txt").write_text("納期\n", encoding="utf-8")
    s = vocab.status_summary()
    assert s["tiers_loaded"] == ["N5"]
    assert s["business_terms"] == 1


def test_level_defaults_without_seeds(seeds_dir):
    # seeds_dir has no levels.json -> neutral defaults, not official.
    assert not levels.using_official_descriptors()
    assert "business Japanese" in levels.descriptor("J2")


def test_level_override_from_seeds(seeds_dir):
    (seeds_dir / "levels.json").write_text(
        '{"J2": "OFFICIAL J2 TEXT"}', encoding="utf-8"
    )
    assert levels.using_official_descriptors()
    assert levels.descriptor("J2") == "OFFICIAL J2 TEXT"
