"""Whole-batch checks: the failures a per-item gate cannot see, plus the
reference batch as a regression test."""
import copy
import json
import pathlib

import pytest

from bjt import batch, config
from bjt.fidelity import dedupe

BATCHES = pathlib.Path(__file__).resolve().parent.parent / "batches"
REFERENCE = BATCHES / "hatsugen_choukai_J2_001.json"

#: Every bundle committed to the repo. The library grows one batch at a time and
#: each one has to keep passing the gates it was admitted under, so the sweep is
#: over the directory rather than over a list of names: a regression test pinned
#: to one file stops being a regression test the moment a second file exists.
COMMITTED = sorted(p for p in BATCHES.glob("*.json") if not p.name.endswith(".source.json"))


def _bundle_id(path):
    return path.stem


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


@pytest.mark.parametrize("path", COMMITTED, ids=_bundle_id)
def test_every_committed_batch_still_ships(path):
    """The committed bundles are the regression set: if a check starts failing
    one of them, the check changed, not the items."""
    report = batch.check_bundle(batch.load(path))
    assert report.ok, [(c.name, c.detail) for c in report.failed]
    assert report.warned == [], [(c.name, c.detail) for c in report.warned]


@pytest.mark.parametrize("path", COMMITTED, ids=_bundle_id)
def test_every_committed_batch_uses_every_distractor_role(path):
    from bjt.fidelity import roles
    bundle = batch.load(path)
    used = {o["role"] for it in bundle["items"] for o in it["options"] if o["role"] != "correct"}
    assert used == set(roles.DISTRACTOR_ROLES[bundle["item_type"]])


@pytest.mark.parametrize("path", COMMITTED, ids=_bundle_id)
def test_every_committed_batch_reuses_its_scenes(path):
    """Fewer scenes than items is the point — images are a shared bank."""
    scenes = [it["scene_id"] for it in batch.load(path)["items"] if it.get("scene_id")]
    assert scenes and len(set(scenes)) < len(scenes)


# ----- the library as a whole ---------------------------------------------
#
# check_bundle looks at one bundle and cannot see the others. Three invariants
# only exist across the shipped library, and all three became breakable the
# moment a second batch was committed.

def _library():
    """(bundle filename, item) for every item that ships."""
    return [(p.name, it) for p in COMMITTED for it in batch.load(p)["items"]]


def test_no_seed_cell_is_spent_twice_across_the_library():
    """A cell is consumed at most once. Reusing one is not merely a repeated
    question — it is worse: `item_id` is a hash of (item type, cell), so the
    second item silently REPLACES the first on publish and the library shrinks
    without saying so."""
    seen: dict[tuple, str] = {}
    clashes = []
    for path in COMMITTED:
        bundle = batch.load(path)
        for it in bundle["items"]:
            key = (bundle["item_type"], (it.get("seed_cell") or {}).get("id"))
            if key in seen:
                clashes.append(f"{key[1]} in both {seen[key]} and {path.name}")
            seen[key] = path.name
    assert not clashes, clashes


def test_item_ids_are_unique_across_the_library():
    """`bjt publish` upserts on id. Two items sharing one is data loss."""
    seen: dict[str, str] = {}
    clashes = []
    for name, it in _library():
        if it["id"] in seen:
            clashes.append(f"{it['id']} in both {seen[it['id']]} and {name}")
        seen[it["id"]] = name
    assert not clashes, clashes


def test_no_near_duplicates_across_the_library():
    """Two batches can each be internally varied and still ask the same question.
    A learner meets the whole library, not one bundle, so the dedupe threshold
    has to hold across bundle boundaries too."""
    lib = _library()
    sigs = [(name, it, dedupe.item_signature(it)) for name, it in lib]
    collisions = []
    for i in range(len(sigs)):
        for j in range(i + 1, len(sigs)):
            (na, ia, sa), (nb, ib, sb) = sigs[i], sigs[j]
            if na == nb:
                continue  # check_bundle already covers within-bundle pairs
            score = dedupe.similarity(sa, sb)
            if score >= dedupe.DEFAULT_THRESHOLD:
                collisions.append(
                    f"{ia['topic']} [{na}] ~ {ib['topic']} [{nb}] at {score:.2f}")
    assert not collisions, collisions


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


@pytest.mark.parametrize("path", COMMITTED, ids=_bundle_id)
def test_importbatch_reproduces_the_committed_bundle(path, tmp_path, monkeypatch):
    """The source file is the thing a human edits; the bundle is derived. If the
    two ever drift, the committed bundle is stale."""
    from bjt import cli

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "t.db")
    out = tmp_path / "rebuilt.json"
    src = path.with_name(path.name.replace(".json", ".source.json"))
    assert cli.main(["importbatch", str(src), "--out", str(out)]) == 0
    rebuilt, committed = batch.load(out), batch.load(path)
    assert rebuilt["items"] == committed["items"]
    assert rebuilt["audio_manifest"] == committed["audio_manifest"]


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
