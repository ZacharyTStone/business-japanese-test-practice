"""Generator loop: validation, retry-on-invalid, shuffle, finalize. The model
call is faked."""
import copy

import pytest

from bjt import fixtures, llm, schemas, seedtable
from bjt.generators import GENERATORS, get_generator
from bjt.generators.base import Generator
from bjt.fidelity import roles


def _valid(item_type):
    return copy.deepcopy(fixtures.FIXTURES[item_type])


def test_happy_path(monkeypatch, goi_cell):
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: _valid("goi_bunpou"))
    item = get_generator("goi_bunpou").generate(cell=goi_cell, seed=0)
    assert item["level"] == "J2"
    assert item["seed_cell"]["id"] == goi_cell.id
    assert item["item_type"] == "goi_bunpou"
    assert len(item["options"]) == 4
    # exactly one correct survives the shuffle
    assert sum(o["role"] == roles.CORRECT for o in item["options"]) == 1
    assert schemas.validate_item("goi_bunpou", item) == []


def test_retries_on_invalid_then_succeeds(monkeypatch, goi_cell):
    calls = {"n": 0}

    def fake(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            bad = _valid("goi_bunpou")
            bad["options"][1]["role"] = "correct"  # now two correct -> invalid
            return bad
        return _valid("goi_bunpou")

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", fake)
    item = get_generator("goi_bunpou").generate(cell=goi_cell, seed=0)
    assert calls["n"] == 2
    assert schemas.validate_item("goi_bunpou", item) == []


def test_raises_after_max_attempts(monkeypatch, goi_cell):
    def always_bad(*a, **k):
        bad = _valid("goi_bunpou")
        bad["options"] = bad["options"][:3]  # only 3 options -> always invalid
        return bad

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", always_bad)
    with pytest.raises(llm.LLMError):
        get_generator("goi_bunpou").generate(cell=goi_cell, max_attempts=2)


def test_rejects_bad_level():
    with pytest.raises(ValueError):
        get_generator("goi_bunpou").generate("J9")


@pytest.mark.parametrize("item_type", sorted(GENERATORS))
def test_every_generator_refuses_to_run_without_its_cell(item_type):
    """Variety is a property of the seed table, not of the prompt. A generator
    that will quietly write an item without an assignment is one that will
    produce the same three scenarios forever, so every type declares a table and
    refuses without a cell from it."""
    gen = get_generator(item_type)
    assert gen.requires_cell, f"{item_type} has no seed table backing it"
    with pytest.raises(ValueError):
        gen.generate("J2")


def test_avoid_topics_flow_into_prompt(store, monkeypatch, goi_item, goi_cell):
    goi_item["topic"] = "納期の連絡"
    store.insert_item("goi_bunpou", "J2", goi_item, "m")
    gen = get_generator("goi_bunpou", store=store)
    captured = {}

    def fake(system, user, schema, model=None):
        captured["user"] = user
        return _valid("goi_bunpou")

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", fake)
    gen.generate(cell=goi_cell, seed=0)
    assert "納期の連絡" in captured["user"]  # recent topic fed back as do-not-repeat


def test_system_prompt_contains_role_spec_and_fewshot():
    sp = get_generator("hyougen").system_prompt("J2")
    assert "wrong_honorific_direction" in sp
    assert "distractor role" in sp.lower()


def test_unknown_item_type():
    with pytest.raises(KeyError):
        get_generator("nope")


def test_finalize_shuffle_is_deterministic_with_seed():
    class G(Generator):
        item_type = "goi_bunpou"
    a = G()._finalize(_valid("goi_bunpou"), "J2", seed=42)
    b = G()._finalize(_valid("goi_bunpou"), "J2", seed=42)
    assert [o["text"] for o in a["options"]] == [o["text"] for o in b["options"]]


def test_blank_document_block_is_pruned_not_retried(monkeypatch):
    """The model's output does not carry item_type (the schema has no such
    field); the generator stamps it. The pruning of blank headings and callouts
    looks a document up by type, so it must run after the stamp — before it
    did, every blank callout cost the full three attempts and produced nothing,
    which is where most of the 2026-09-18 bill went."""
    cell = seedtable.load("joukyou_haaku").cells("J2")[0]
    calls = {"n": 0}

    def fake(*a, **k):
        calls["n"] += 1
        item = _valid("joukyou_haaku")
        del item["item_type"]  # as the model returns it
        item["document"]["blocks"].insert(1, {"type": "callout", "text": ""})
        return item

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", fake)
    item = get_generator("joukyou_haaku").generate(cell=cell, seed=0)
    assert calls["n"] == 1
    assert item["item_type"] == "joukyou_haaku"
    assert all(b.get("text") for b in item["document"]["blocks"] if b["type"] == "callout")
    assert schemas.validate_item("joukyou_haaku", item) == []


# ----- cheaper drafts: repair, feedback, stock lines ---------------------------

def test_a_fifth_option_is_trimmed_not_regenerated(monkeypatch, goi_cell):
    """The schema cannot say maxItems, so a spare distractor is the one shape
    fault the model can still produce. It used to cost three generations for
    a shelf that then wrote nothing; now the spare is dropped and the draft
    goes on to the checks."""
    from bjt.generators.base import repair_surplus_options
    calls = {"n": 0}

    def fake(*a, **k):
        calls["n"] += 1
        item = _valid("goi_bunpou")
        spare = dict(item["options"][1])
        spare["text"] = "余分な選択肢"
        item["options"].append(spare)  # a duplicate role, so it is the one to drop
        return item

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", fake)
    item = get_generator("goi_bunpou").generate(cell=goi_cell, seed=0)
    assert calls["n"] == 1
    assert len(item["options"]) == 4
    assert "余分な選択肢" not in [o["text"] for o in item["options"]]
    assert schemas.validate_item("goi_bunpou", item) == []

    # Fewer than four, or two correct, is left for the validator to reject.
    short = _valid("goi_bunpou"); short["options"].pop()
    assert repair_surplus_options(short) == [] and len(short["options"]) == 3
    two = _valid("goi_bunpou"); two["options"].append(dict(two["options"][0], text="x"))
    assert repair_surplus_options(two) == [] and len(two["options"]) == 5


def test_review_feedback_reaches_the_next_prompt(monkeypatch, goi_cell):
    seen = {}

    def fake(system, user, schema, model=None):
        seen["user"] = user
        return _valid("goi_bunpou")

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", fake)
    get_generator("goi_bunpou").generate(cell=goi_cell, seed=0,
                                         feedback="the distractors gave the answer away")
    assert "REJECTED by review: the distractors gave the answer away" in seen["user"]
    get_generator("goi_bunpou").generate(cell=goi_cell, seed=0)
    assert "REJECTED" not in seen["user"]


def test_the_stock_lines_are_shown_to_the_spoken_types_only():
    from bjt import phrasebook
    spoken = get_generator("hatsugen_choukai").system_prompt("J2")
    assert phrasebook.STOCK_LINES[0] in spoken
    read = get_generator("goi_bunpou").system_prompt("J2")
    assert phrasebook.STOCK_LINES[0] not in read
    assert "Stock phrases" not in read


def test_library_lines_are_the_ones_the_bank_already_repeats():
    from bjt import phrasebook
    for line in phrasebook.library_lines(min_count=2):
        assert line not in phrasebook.STOCK_LINES
    # With the bar at one, every spoken line of the bank qualifies, and the
    # list is capped so the prompt stays small.
    assert len(phrasebook.library_lines(min_count=1, limit=5)) <= 5
