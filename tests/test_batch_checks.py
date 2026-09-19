"""Whole-batch checks: the failures a per-item gate cannot see, plus the
reference batch as a regression test."""
import copy
import json
import pathlib

import pytest

from bjt import batch, config, seedtable
from bjt.fidelity import dedupe

BATCHES = pathlib.Path(__file__).resolve().parent.parent / "batches"
REFERENCE = BATCHES / "hatsugen_choukai_J2_001.json"

#: Every bundle committed to the repo. The library grows one batch at a time and
#: each one has to keep passing the gates it was admitted under, so the sweep is
#: over the directory rather than over a list of names: a regression test pinned
#: to one file stops being a regression test the moment a second file exists.
COMMITTED = sorted(p for p in BATCHES.glob("*.json") if not p.name.endswith(".source.json"))


def _source_of(path):
    return path.with_name(path.name.replace(".json", ".source.json"))


#: The bundles a person wrote by hand, which are the only ones with a source
#: file to rebuild from. The nightly job writes its bundles directly — there is
#: no hand-edited original behind them — so the round-trip test below has
#: nothing to compare those against, and asserting over them was asserting that
#: a file which was never meant to exist exists.
HAND_WRITTEN = [p for p in COMMITTED if _source_of(p).exists()]


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
    """...as far as it has room to.

    An item carries exactly three distractors, so a bundle of `n` items can show
    at most `3n` distinct roles however varied its prompt is. The nightly job
    writes one-item bundles, and demanding four roles of three slots is a demand
    about arithmetic rather than about the items.
    """
    from bjt.fidelity import roles
    bundle = batch.load(path)
    enum = set(roles.DISTRACTOR_ROLES[bundle["item_type"]])
    used = {o["role"] for it in bundle["items"] for o in it["options"] if o["role"] != "correct"}
    reachable = min(len(enum), 3 * len(bundle["items"]))
    assert used <= enum, f"roles outside the enum: {used - enum}"
    assert len(used) >= reachable, (
        f"{len(used)} of a reachable {reachable} roles used; unused: {sorted(enum - used)}"
    )


@pytest.mark.parametrize("path", COMMITTED, ids=_bundle_id)
def test_every_committed_batch_draws_its_scenes_from_the_bank(path):
    """Every picture an item asks for is one somebody could commission.

    This is the per-bundle half of the shared-bank rule. The other half — that
    the bank is actually smaller than the library — is asserted across the whole
    library below, because it is not true of one small batch and should not be:
    a batch of six spread across six settings cannot repeat a scene, and
    contorting the content so it could would be writing items to suit a test.

    Types with no scene bank are exempt rather than excused: a reading item has
    no picture to share, and demanding one would be demanding art nobody should
    draw.
    """
    bundle = batch.load(path)
    bank = set(seedtable.load(bundle["item_type"]).scene_bank)
    if not bank:
        pytest.skip(f"{bundle['item_type']} has no scene bank — its items are read")
    scenes = [it["scene_id"] for it in bundle["items"] if it.get("scene_id")]
    assert scenes, "a type with a scene bank should set scene_id on its items"
    assert set(scenes) <= bank, f"not in the bank: {sorted(set(scenes) - bank)}"


def test_the_library_reuses_its_scenes():
    """The shared bank, as an economic fact rather than an aspiration.

    A thousand items cannot have a thousand drawings — but the reason that
    matters is quality, not cost: because one picture serves many items, the
    picture cannot contain the answer, and an illustration specific enough to
    give the situation away would make the listening optional.
    """
    # A 画像把握 picture is one per item by design, and is not what the bank
    # is for; it is left out of the count rather than diluting it.
    scenes = [it["scene_id"] for _, it in _library()
              if it.get("scene_id") and not it.get("image_brief")]
    assert scenes
    assert len(set(scenes)) < len(scenes) / 2, (
        f"{len(set(scenes))} scenes for {len(scenes)} items — that is close to "
        "one drawing each, which is the thing the bank exists to avoid"
    )


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


def test_an_overlong_stem_is_noted(bundle):
    b = copy.deepcopy(bundle)
    b["items"][0]["stem"] = "あ" * (batch.STEM_MAX_CHARS + 1)
    assert _status(batch.check_bundle(b), "length matches the exam") == "note"


def test_a_bundle_inside_every_band_passes(bundle):
    """The band reports `pass` rather than merely not failing, so that a clean
    bundle is distinguishable from one nobody measured."""
    b = copy.deepcopy(bundle)
    bands = batch.LENGTH_BANDS["hatsugen_choukai"]
    mid = lambda f: "あ" * ((bands[f][0] + bands[f][1]) // 2)  # noqa: E731
    for it in b["items"]:
        it["stem"] = mid("stem")
        for i, o in enumerate(it["options"]):
            # Distinct, or the no-duplicate-text check fires instead.
            o["text"] = mid("option")[:-1] + "アイウエ"[i]
    assert _status(batch.check_bundle(b), "length matches the exam") == "pass"


def test_options_are_measured_against_their_own_band(bundle):
    """語彙・文法 options are two to six characters on the real paper. A
    fifteen-character filler is a 表現読解 option in the wrong type, and the band
    is what says so — for the options, not only for the stem."""
    b = copy.deepcopy(bundle)
    low, high = batch.LENGTH_BANDS["hatsugen_choukai"]["option"]
    b["items"][0]["options"][0]["text"] = "あ" * (high + 10)
    note = next(c for c in batch.check_bundle(b).checks if c.name == "length matches the exam")
    assert note.status == "note"
    assert "option" in note.detail


def test_a_length_note_is_not_a_warning(bundle):
    """A note says the item is unlike the exam; a warning says it is wrong. The
    committed bundles lean on that distinction — several of them are shorter
    than the exam and every one of them still ships."""
    b = copy.deepcopy(bundle)
    b["items"][0]["stem"] = "あ" * (batch.STEM_MAX_CHARS + 1)
    report = batch.check_bundle(b)
    assert report.ok
    assert [c.name for c in report.noted] == ["length matches the exam"]
    assert "length matches the exam" not in [c.name for c in report.warned]


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


@pytest.mark.parametrize("path", HAND_WRITTEN, ids=_bundle_id)
def test_importbatch_reproduces_the_committed_bundle(path, tmp_path, monkeypatch):
    """The source file is the thing a human edits; the bundle is derived. If the
    two ever drift, the committed bundle is stale.

    Only the hand-written bundles — the nightly job's have no source to drift
    from. See HAND_WRITTEN.
    """
    from bjt import cli

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "t.db")
    out = tmp_path / "rebuilt.json"
    src = _source_of(path)
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


# ----- the spent-cell ledger ---------------------------------------------
#
# The ledger used to live only in the gitignored SQLite database, so a fresh
# clone believed every cell was free and the next batch re-spent cells the
# committed library had already used. `item_id` hashes (item type, cell), so the
# duplicate would have replaced the original on publish.

def test_spent_cells_are_readable_without_the_local_database():
    """Every cell in a committed bundle counts as spent, from the repo alone."""
    spent = batch.spent_cell_ids("hatsugen_choukai")
    committed = {
        (it.get("seed_cell") or {}).get("id")
        for name, it in _library()
        if name.startswith("hatsugen_choukai_")
    }
    assert spent == committed
    assert spent, "the reference batches should have spent some cells"


def test_spent_cells_are_scoped_to_one_item_type():
    """A cell id names a cell within its own table; two types can legitimately
    enumerate the same setting and function, so the ledger must not pool them."""
    for item_type in ("hatsugen_choukai", "goi_bunpou"):
        spent = batch.spent_cell_ids(item_type)
        committed = {
            (it.get("seed_cell") or {}).get("id")
            for name, it in _library()
            if name.startswith(f"{item_type}_")
        }
        assert spent == committed


def test_source_files_are_not_counted_as_bundles(tmp_path, monkeypatch):
    """`*.source.json` is the input to importbatch, not a bundle. Counting both
    would double every cell a hand-written batch spends."""
    monkeypatch.setattr(config, "BATCH_DIR", tmp_path)
    cell = {"id": "a+b+c@J2"}
    bundle = {"item_type": "t", "level": "J2", "items": [{"seed_cell": cell}]}
    (tmp_path / "t_J2_001.json").write_text(json.dumps(bundle), encoding="utf-8")
    (tmp_path / "t_J2_001.source.json").write_text(json.dumps(bundle), encoding="utf-8")

    assert [p.name for p in batch.bundles("t")] == ["t_J2_001.json"]
    assert batch.spent_cell_ids("t") == {"a+b+c@J2"}


def test_a_damaged_bundle_does_not_take_the_ledger_down(tmp_path, monkeypatch):
    """One unreadable file must not make every other cell look free — that is
    the failure mode this whole ledger exists to prevent."""
    monkeypatch.setattr(config, "BATCH_DIR", tmp_path)
    (tmp_path / "t_J2_001.json").write_text(
        json.dumps({"item_type": "t", "level": "J2", "items": [{"seed_cell": {"id": "x@J2"}}]}),
        encoding="utf-8",
    )
    (tmp_path / "t_J2_002.json").write_text("{ not json", encoding="utf-8")
    assert batch.spent_cell_ids("t") == {"x@J2"}


def test_a_small_batch_that_always_answers_a_is_caught(bundle):
    """The share rule needs eight items before a 45% lean means anything, so a
    batch of six with every answer in the same place used to pass. "The answer
    is always A" is the most exploitable pattern there is, and a new item type's
    first batch is exactly the size that slipped through."""
    bundle["items"] = bundle["items"][:6]
    for item in bundle["items"]:
        options = item["options"]
        correct = options.pop(item["correct_index"])
        item["options"] = [correct, *options]
        item["correct_index"] = 0

    report = batch.check_bundle(bundle)
    check = next(c for c in report.checks if c.name == "answer position spread")
    assert check.status == "warn"
    assert "only ever lands in 1 of 4" in check.detail


def test_two_positions_out_of_four_is_still_a_pattern(bundle):
    for i, item in enumerate(bundle["items"][:6]):
        options = item["options"]
        correct = options.pop(item["correct_index"])
        target = i % 2
        options.insert(target, correct)
        item["options"] = options
        item["correct_index"] = target
    bundle["items"] = bundle["items"][:6]
    check = next(c for c in batch.check_bundle(bundle).checks
                 if c.name == "answer position spread")
    assert check.status == "warn"


def test_three_positions_is_enough_for_a_small_batch(bundle):
    for i, item in enumerate(bundle["items"][:6]):
        options = item["options"]
        correct = options.pop(item["correct_index"])
        target = i % 3
        options.insert(target, correct)
        item["options"] = options
        item["correct_index"] = target
    bundle["items"] = bundle["items"][:6]
    check = next(c for c in batch.check_bundle(bundle).checks
                 if c.name == "answer position spread")
    assert check.status == "pass"


def test_a_document_item_re_validates_after_bundling():
    """The bundle normalises documents to a list; the validator checks the
    type's own field, which is singular for three of the four. Left
    untranslated, every committed document item failed its own re-validation
    with "missing field: document" while being perfectly well formed."""
    from bjt import fixtures

    for item_type in ("joukyou_haaku", "shiryou_choudokkai", "sougou_dokkai",
                      "sougou_choudokkai", "sougou_choukai"):
        bundle = batch.build_bundle(
            item_type, fixtures.FIXTURES[item_type]["level"],
            [fixtures.FIXTURES[item_type]], "test",
        )
        report = batch.check_bundle(bundle)
        validity = next(c for c in report.checks if c.name == "item validity")
        assert validity.status == "pass", f"{item_type}: {validity.detail}"
