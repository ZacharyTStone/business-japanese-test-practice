"""Whole-batch checks: the failures a per-item gate cannot see, plus the
reference batch as a regression test."""
import copy
import json
import pathlib

import pytest

from bjt import batch, config
from bjt.fidelity import dedupe

REFERENCE = pathlib.Path(__file__).resolve().parent.parent / "batches" / "hatsugen_choukai_J2_001.json"
REFERENCE_J3 = pathlib.Path(__file__).resolve().parent.parent / "batches" / "hatsugen_choukai_J3_001.json"


# ----- near-duplicate detection ------------------------------------------

def _item(stem, answer, others=("いいえ。", "はい。", "どうも。")):
    opts = [{"text": answer, "role": "correct", "why": "これが正解である理由。"}]
    for text, role in zip(others, ["register_too_casual", "content_mismatch", "wrong_speech_act"]):
        opts.append({"text": text, "role": role, "why": "これが誤りである理由。"})
    return {"stem": stem, "options": opts, "topic": stem[:6]}


def test_paraphrases_of_one_situation_collide():
    a = _item("取引先に電話をかけ、担当者が不在でした。何と言いますか。", "またご連絡いたします。")
    b = _item("取引先に電話をかけたが、担当者が不在だった。何と言いますか。", "またご連絡いたします。")
    assert dedupe.similarity(dedupe.item_signature(a), dedupe.item_signature(b)) >= dedupe.DEFAULT_THRESHOLD


def test_same_setting_different_problem_does_not_collide():
    a = _item("取引先に電話をかけ、担当者が不在でした。何と言いますか。", "またご連絡いたします。")
    b = _item("取引先との会食で、料理が運ばれてきました。何と言いますか。", "どうぞお召し上がりください。")
    assert dedupe.find_duplicates([a, b]) == []


def test_same_answer_in_a_different_situation_does_not_collide():
    a = _item("上司に書類を見てもらいたいと頼みます。何と言いますか。", "かしこまりました。")
    b = _item("展示会の受付で来場者を案内します。何と言いますか。", "かしこまりました。")
    assert dedupe.find_duplicates([a, b]) == []


def test_normalisation_ignores_punctuation_and_width():
    assert dedupe.normalize("ＡＢＣ、です。") == dedupe.normalize("ABCです")


def test_max_similarity_against_an_empty_pool_is_zero():
    assert dedupe.max_similarity(_item("x" * 30, "y"), []) == 0.0


# ----- bundle checks ------------------------------------------------------

@pytest.fixture
def bundle():
    return batch.load(REFERENCE)


def _status(report, name):
    return next(c.status for c in report.checks if c.name == name)


def test_reference_batch_still_ships(bundle):
    """The ten hand-written items are the regression set: if a check starts
    failing them, the check changed, not the items."""
    report = batch.check_bundle(bundle)
    assert report.ok, [(c.name, c.detail) for c in report.failed]
    assert report.warned == [], [(c.name, c.detail) for c in report.warned]


def test_reference_batch_uses_every_distractor_role(bundle):
    used = {o["role"] for it in bundle["items"] for o in it["options"] if o["role"] != "correct"}
    from bjt.fidelity import roles
    assert used == set(roles.DISTRACTOR_ROLES["hatsugen_choukai"])


def test_reference_batch_reuses_its_scenes(bundle):
    """Fewer scenes than items is the point — images are a shared bank."""
    scenes = [it["scene_id"] for it in bundle["items"]]
    assert len(set(scenes)) < len(scenes)


@pytest.fixture
def bundle_j3():
    return batch.load(REFERENCE_J3)


def test_j3_reference_batch_still_ships(bundle_j3):
    """The ten J3 items are a second regression set, at the basic level: if a
    check starts failing them, the check changed, not the items."""
    report = batch.check_bundle(bundle_j3)
    assert report.ok, [(c.name, c.detail) for c in report.failed]
    assert report.warned == [], [(c.name, c.detail) for c in report.warned]


def test_j3_reference_batch_uses_every_distractor_role(bundle_j3):
    used = {o["role"] for it in bundle_j3["items"] for o in it["options"] if o["role"] != "correct"}
    from bjt.fidelity import roles
    assert used == set(roles.DISTRACTOR_ROLES["hatsugen_choukai"])


def test_empty_bundle_fails(bundle):
    report = batch.check_bundle({"item_type": "hatsugen_choukai", "items": []})
    assert not report.ok


def test_duplicate_seed_cells_fail(bundle):
    b = copy.deepcopy(bundle)
    b["items"][1]["seed_cell"] = dict(b["items"][0]["seed_cell"])
    assert _status(batch.check_bundle(b), "seed cells distinct") == "fail"


def test_a_repeated_question_fails(bundle):
    b = copy.deepcopy(bundle)
    b["items"][1]["stem"] = b["items"][0]["stem"]
    b["items"][1]["options"] = copy.deepcopy(b["items"][0]["options"])
    b["items"][1]["correct_index"] = b["items"][0]["correct_index"]
    assert _status(batch.check_bundle(b), "no near-duplicates") == "fail"


def test_answer_drifting_to_one_position_warns(bundle):
    b = copy.deepcopy(bundle)
    for it in b["items"]:
        ci = it["correct_index"]
        it["options"][0], it["options"][ci] = it["options"][ci], it["options"][0]
        it["correct_index"] = 0
    assert _status(batch.check_bundle(b), "answer position spread") == "warn"


def test_correct_option_always_longest_warns(bundle):
    b = copy.deepcopy(bundle)
    for it in b["items"]:
        it["options"][it["correct_index"]]["text"] += "、どうぞよろしくお願いいたします。"
    assert _status(batch.check_bundle(b), "length does not leak") == "warn"


def test_a_tie_for_longest_is_not_treated_as_a_leak():
    it = {"correct_index": 0, "options": [{"text": "あいうえお"}, {"text": "あいうえお"},
                                          {"text": "あい"}, {"text": "あ"}]}
    assert not batch._correct_is_extreme(it, longest=True)


def test_thin_why_fails(bundle):
    b = copy.deepcopy(bundle)
    b["items"][0]["options"][1]["why"] = "だめ。"
    assert _status(batch.check_bundle(b), "per-option why") == "fail"


def test_scene_outside_the_bank_fails(bundle):
    b = copy.deepcopy(bundle)
    b["items"][0]["scene_id"] = "scene_moon_base"
    assert _status(batch.check_bundle(b), "scenes come from the bank") == "fail"


def test_an_overlong_stem_warns(bundle):
    b = copy.deepcopy(bundle)
    b["items"][0]["stem"] = "あ" * (batch.STEM_MAX_CHARS + 1)
    assert _status(batch.check_bundle(b), "stem length for listening") == "warn"


# ----- bundle round trip --------------------------------------------------

def test_item_ids_are_stable_across_rebuilds(bundle):
    ids = [it["id"] for it in bundle["items"]]
    rebuilt = batch.build_bundle("hatsugen_choukai", "J2",
                                 [_as_source(it) for it in bundle["items"]], "test")
    assert [it["id"] for it in rebuilt["items"]] == ids


def test_save_and_load_round_trip(bundle, tmp_path):
    path = batch.save(bundle, tmp_path / "b.json")
    assert json.loads(path.read_text(encoding="utf-8"))["items"] == bundle["items"]


def test_default_path_does_not_overwrite(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "BATCH_DIR", tmp_path)
    first = batch.default_path("hatsugen_choukai", "J2")
    first.write_text("{}", encoding="utf-8")
    assert batch.default_path("hatsugen_choukai", "J2") != first


def _as_source(bundle_item):
    """Bundle item back to the shape the generator emits."""
    it = {k: v for k, v in bundle_item.items() if k not in ("id", "audio", "correct_index")}
    return it


# ----- the CLI paths ------------------------------------------------------

def test_checkbatch_exits_zero_on_the_reference_bundle(capsys):
    from bjt import cli
    assert cli.main(["checkbatch", str(REFERENCE)]) == 0
    assert "SHIPPABLE" in capsys.readouterr().out


def test_importbatch_reproduces_the_committed_bundle(tmp_path, monkeypatch, bundle):
    """The source file is the thing a human edits; the bundle is derived. If the
    two ever drift, the committed bundle is stale."""
    from bjt import cli

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "t.db")
    out = tmp_path / "rebuilt.json"
    src = REFERENCE.with_name(REFERENCE.name.replace(".json", ".source.json"))
    assert cli.main(["importbatch", str(src), "--out", str(out)]) == 0
    rebuilt = batch.load(out)
    assert rebuilt["items"] == bundle["items"]
    assert rebuilt["audio_manifest"] == bundle["audio_manifest"]


def test_importbatch_rejects_an_unknown_seed_cell(tmp_path, monkeypatch):
    from bjt import cli

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "t.db")
    src = json.loads(REFERENCE.with_name(
        REFERENCE.name.replace(".json", ".source.json")).read_text(encoding="utf-8"))
    src["items"] = src["items"][:1]
    src["items"][0]["seed_cell_id"] = "nowhere+nobody+nothing@J2"
    path = tmp_path / "bad.source.json"
    path.write_text(json.dumps(src, ensure_ascii=False), encoding="utf-8")
    assert cli.main(["importbatch", str(path), "--out", str(tmp_path / "o.json")]) == 1


def test_importbatch_marks_the_cells_used(tmp_path, monkeypatch):
    from bjt import cli
    from bjt.db import Store

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "t.db")
    src = REFERENCE.with_name(REFERENCE.name.replace(".json", ".source.json"))
    cli.main(["importbatch", str(src), "--out", str(tmp_path / "o.json")])
    store = Store(tmp_path / "t.db")
    try:
        assert len(store.used_cell_ids("hatsugen_choukai")) == 10
    finally:
        store.close()
