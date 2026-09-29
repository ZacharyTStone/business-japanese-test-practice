"""Generator loop: validation, retry-on-invalid, shuffle, finalize. The model
call is faked."""
import copy
import dataclasses

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


def test_rejects_bad_level(goi_cell):
    bad = dataclasses.replace(goi_cell, level="J9")
    with pytest.raises(ValueError, match="invalid level"):
        get_generator("goi_bunpou").generate(cell=bad)


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
    looks a document up by type, so it must run after the stamp; otherwise
    every blank callout costs the full three attempts and produces nothing."""
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
    fault the model can still produce. Regenerating for it can cost three
    generations for a shelf that then writes nothing, so the spare is dropped
    and the draft goes on to the checks."""
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


# ----- graphs in the 資料 ------------------------------------------------------

CHART_GUIDANCE = "A `chart` block draws figures"


def _cell(item_type, setting):
    return next(c for c in seedtable.load(item_type).cells("J2") if c.setting == setting)


@pytest.mark.parametrize("item_type,setting,told", [
    ("shiryou_choudokkai", "figures_meeting", True),     # figures only
    ("shiryou_choudokkai", "meeting_handout", True),     # figures among others
    ("shiryou_choudokkai", "quotation", False),          # a quotation cannot carry one
    ("sougou_choudokkai", "regular_meeting", True),      # figures and a progress report
    ("sougou_choudokkai", "client_review", True),        # a progress report
    ("sougou_choudokkai", "negotiation", False),
    ("sougou_dokkai", "project_update", False),          # a reading type is never told
])
def test_the_chart_guidance_reaches_a_cell_that_can_draw_one_and_no_other(
        item_type, setting, told):
    """Telling a writer about graphs on a cell that assigns an email is asking
    for a draft the validator will send back."""
    cell = _cell(item_type, setting)
    prompt = get_generator(item_type).user_prompt("J2", [], cell)
    assert (CHART_GUIDANCE in prompt) is told
    if told:
        assert "neither the chart nor the audio answers alone" in prompt
        carriers = [t for t in cell.templates if t in ("figures", "progress_report")]
        assert f"`{carriers[0]}`" in prompt.split(CHART_GUIDANCE)[1]


def test_the_listening_and_reading_tables_offer_a_graph_at_every_level():
    for item_type in ("shiryou_choudokkai", "sougou_choudokkai"):
        table = seedtable.load(item_type)
        for level in table.levels:
            assert any("figures" in c.templates for c in table.cells(level)), (item_type, level)


def _chart_draft(**changes):
    item = copy.deepcopy(fixtures.CHART_FIXTURE)
    del item["item_type"]          # as the model returns it
    item.update(changes)
    return item


def test_a_generated_chart_is_written_like_print_before_anyone_judges_it(monkeypatch):
    """The generator normalises numbers before the gate, the proofreader and
    the discriminator see a draft — a chart's labels included — so all three
    judge the item as it will ship."""
    cell = _cell("shiryou_choudokkai", "figures_meeting")
    draft = _chart_draft()
    chart = draft["document"]["blocks"][0]
    chart["categories"] = ["四月", "五月", "六月", "七月", "八月", "九月"]
    chart["caption"] = "月別 問い合わせ件数（四月〜九月）"
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", lambda *a, **k: draft)
    item = get_generator("shiryou_choudokkai").generate(cell=cell, seed=0)
    got = item["document"]["blocks"][0]
    assert got["categories"] == ["4月", "5月", "6月", "7月", "8月", "9月"]
    assert got["caption"] == "月別 問い合わせ件数（4月〜9月）"
    assert schemas.validate_item("shiryou_choudokkai", item) == []


def test_a_chart_the_template_cannot_carry_is_sent_back_with_the_reason(monkeypatch):
    cell = _cell("shiryou_choudokkai", "meeting_handout")
    first = _chart_draft()
    first["document"]["template"] = "quote_order"
    first["document"]["meta"] = [{"label": "宛先", "value": "みどり物産 御中"},
                                 {"label": "発行者", "value": "山川商事"},
                                 {"label": "発行日", "value": "10月1日"}]
    drafts = iter([first, _chart_draft()])
    prompts = []

    def fake(system, user, schema, model=None):
        prompts.append(user)
        return next(drafts)

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", fake)
    item = get_generator("shiryou_choudokkai").generate(cell=cell, seed=0)
    assert len(prompts) == 2
    assert "does not carry one" in prompts[1]
    assert item["document"]["template"] == "figures"
