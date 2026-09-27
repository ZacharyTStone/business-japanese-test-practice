"""The seed table: constraint enforcement, spread, and exhaustion."""
import json
import pathlib

import pytest

from bjt import seedtable
from bjt.generators import get_generator
from bjt.generators.base import RELATION_NOTES
from bjt.tts import plan as tts_plan

BATCHES = pathlib.Path(__file__).resolve().parent.parent / "batches"
TABLES = seedtable.available()


@pytest.fixture
def table():
    return seedtable.load("hatsugen_choukai")


@pytest.mark.parametrize("item_type", TABLES)
def test_every_cell_satisfies_all_three_constraints(item_type):
    table = seedtable.load(item_type)
    data = table.data
    settings = {s["id"]: s for s in data["settings"]}
    functions = {f["id"]: f for f in data["functions"]}
    for cell in table.cells():
        setting = settings[cell.setting]
        function = functions[cell.function]
        assert cell.relation in data["setting_relations"][cell.setting]
        assert cell.relation in function["relations"]
        assert setting["channel"] in function["channels"]
        assert cell.channel == setting["channel"]
        if function.get("settings"):
            assert cell.setting in function["settings"]


@pytest.mark.parametrize("item_type", TABLES)
def test_every_id_a_table_names_is_one_it_declares(item_type):
    """A typo in a constraint list does not fail loudly: the enumeration simply
    skips a relation it cannot find, and the cells somebody meant to add are
    never there. So a table that names an id it does not declare is wrong."""
    data = seedtable.load(item_type).data
    settings = {s["id"] for s in data["settings"]}
    relations = {r["id"] for r in data["relations"]}
    assert set(data["setting_relations"]) == settings
    for sid, rels in data["setting_relations"].items():
        assert set(rels) <= relations, f"{sid}: {set(rels) - relations}"
    for f in data["functions"]:
        assert set(f["relations"]) <= relations, f"{f['id']}: {set(f['relations']) - relations}"
        assert set(f.get("settings") or ()) <= settings, f"{f['id']} names a setting that is not one"


def _committed_items():
    for path in sorted(BATCHES.glob("*.json")):
        if path.name.endswith(".source.json"):
            continue
        bundle = json.loads(path.read_text(encoding="utf-8"))
        for item in bundle["items"]:
            yield path.name, bundle["item_type"], item


def test_every_committed_item_is_still_a_cell_of_its_table():
    """The tables only ever grow. `item_id` hashes (type, cell), so a cell that
    stopped existing — a setting renamed, a relation dropped, a channel changed
    under it — orphans the item that spent it: `importbatch` can no longer
    rebuild it, and a later item written for the renamed cell would be a second
    copy of a question the bank already has. Additions are free; this is what
    says the rest were additions."""
    problems = []
    for name, item_type, item in _committed_items():
        cell = seedtable.load(item_type).get((item.get("seed_cell") or {}).get("id", ""))
        if cell is None:
            problems.append(f"{name}: {item['seed_cell']['id']} is not a cell any more")
            continue
        if item.get("channel") and item["channel"] != cell.channel:
            problems.append(f"{name}: {cell.id} is {cell.channel}, the item {item['channel']}")
        for doc in item.get("documents") or []:
            if cell.templates and doc.get("template") not in cell.templates:
                problems.append(f"{name}: {cell.id} no longer offers {doc.get('template')}")
        if cell.scenes and item.get("scene_id") and not item.get("image_brief") \
                and item["scene_id"] not in cell.scenes:
            problems.append(f"{name}: {cell.id} no longer offers {item['scene_id']}")
    assert not problems, problems


@pytest.mark.parametrize("item_type", TABLES)
def test_every_relation_is_cast(item_type):
    """The voice follows the relation. A relation with no entry in the cast
    would be spoken by whichever voice the fallback happens to be — and would
    move the day somebody noticed and gave it one, which re-voices every clip
    already live."""
    for relation in seedtable.load(item_type).data["relations"]:
        assert relation["id"] in tts_plan.RELATION_VOICES, relation["id"]


# ----- ウチ/ソト as a relation --------------------------------------------

UCHI_SOTO_TYPES = ("hatsugen_choukai", "hyougen", "bamen_haaku")


@pytest.mark.parametrize("item_type", UCHI_SOTO_TYPES)
def test_a_batch_can_aim_at_uchi_soto(item_type):
    """Until 2026-09-27 ウチ/ソト existed only as a distractor role
    (`wrong_uchi_soto`), so no batch could be asked to be about it. Now it is a
    relation with cells of its own, at every level."""
    table = seedtable.load(item_type)
    for level in table.levels:
        assert any(c.relation == "uchi_to_soto" for c in table.cells(level)), level


def test_uchi_soto_is_spoken_by_the_voice_that_speaks_to_clients():
    """A staff member talking to an outsider about their boss is the same
    person as one talking to the outsider about anything else. The cast is
    fixed; a relation added later borrows a voice rather than adding one."""
    voices = tts_plan.RELATION_VOICES
    assert voices["uchi_to_soto"] == voices["staff_to_client"]


def test_uchi_soto_never_happens_where_there_is_no_outsider():
    for item_type in UCHI_SOTO_TYPES:
        table = seedtable.load(item_type)
        inward = {s for s, rels in table.data["setting_relations"].items()
                  if not any(r.startswith("staff_to_") for r in rels)}
        for cell in table.cells():
            if cell.relation == "uchi_to_soto":
                assert cell.setting not in inward, cell.id


@pytest.mark.parametrize("item_type", TABLES)
def test_a_relation_that_needs_explaining_is_explained(item_type):
    """「自社 → 社外（身内のことを話す）」 is the arrow; the note is what a writer
    needs to know about it — that the item turns on the colleague being talked
    about, not on the two people talking. Every prompt for such a cell says so."""
    table = seedtable.load(item_type)
    gen = get_generator(item_type)
    for relation, note in RELATION_NOTES.items():
        cell = next((c for c in table.cells() if c.relation == relation), None)
        if cell is not None:
            assert note in gen.user_prompt(cell.level, [], cell)
    ordinary = next(c for c in table.cells() if c.relation not in RELATION_NOTES)
    prompt = gen.user_prompt(ordinary.level, [], ordinary)
    assert not any(note in prompt for note in RELATION_NOTES.values())


def test_phone_only_functions_never_land_in_person(table):
    """The constraint that stops 「来客を迎えて案内する」 over the phone, and
    「電話を取り次ぐ」 in a restaurant."""
    for cell in table.cells():
        if cell.function.startswith("phone_"):
            assert cell.channel == "phone"
        if cell.function in ("greet_and_guide", "offer_food"):
            assert cell.channel == "in_person"


def test_cell_ids_are_unique(table):
    ids = [c.id for c in table.cells()]
    assert len(ids) == len(set(ids))


def test_sample_spreads_across_settings_and_functions(table):
    cells = table.sample(10, level="J2", seed=3)
    assert len(cells) == 10
    # Ten picks, ten different functions — that is the whole point of sampling
    # greedily rather than uniformly.
    assert len({c.function for c in cells}) == 10
    assert len({c.setting for c in cells}) >= 7


def test_sample_never_returns_an_excluded_cell(table):
    first = table.sample(5, level="J2", seed=1)
    used = {c.id for c in first}
    second = table.sample(5, level="J2", exclude_ids=used, seed=1)
    assert not used & {c.id for c in second}


def test_sample_is_capped_by_the_pool_rather_than_repeating(table):
    everything = {c.id for c in table.cells(level="J3")}
    got = table.sample(len(everything) + 50, level="J3", exclude_ids=everything)
    assert got == []


def test_every_setting_offers_at_least_one_scene(table):
    for cell in table.cells():
        assert cell.scenes, f"{cell.setting} has no scene to draw"
    # The bank stays small on purpose — images are reused, not generated per item.
    assert len(table.scene_bank) <= 100


def test_coverage_counts_only_cells_in_this_table(table):
    some = [c.id for c in table.cells(level="J2")[:3]]
    cov = table.coverage(some + ["not_a_real_cell@J2"])
    assert cov["used_cells"] == 3
    assert cov["total_cells"] == len(table.cells())


def test_missing_table_raises_rather_than_silently_degrading(tmp_path, monkeypatch):
    monkeypatch.setattr("bjt.config.SEEDTABLE_DIR", tmp_path)
    with pytest.raises(FileNotFoundError):
        seedtable.load("hyougen")


def test_every_referenced_scene_has_a_label(table):
    """The bank is a commissioning list: an id with no description is a picture
    nobody can draw."""
    labels = table.scene_labels
    for scene in table.scene_bank:
        assert labels.get(scene), f"{scene} has no label"


def test_no_orphan_labels(table):
    assert set(table.scene_labels) == set(table.scene_bank)


@pytest.mark.parametrize("item_type", TABLES)
def test_every_scene_any_table_asks_for_has_a_label(item_type):
    """`bjt publish` labels a scene from its table. A setting that offers a
    scene its table has no words for publishes a picture with a blank label."""
    table = seedtable.load(item_type)
    for scene in table.scene_bank:
        assert table.scene_labels.get(scene), f"{item_type}: {scene} has no label"


# ----- the situations the exam tests (2026-09-27) ----------------------------
#
# Negotiation, the meeting, instructions, consulting, introductions,
# appointments and condolences were missing from the tables, so no batch could
# be written about them however it was prompted. They are functions where the
# type is about what somebody says, and settings where it is about what
# somebody understands.

SPOKEN_ACTS = ("negotiate_price", "negotiate_terms", "state_opinion", "object_politely",
               "chair_meeting", "instruct", "consult", "introduce_other",
               "make_appointment", "condolence")


@pytest.mark.parametrize("item_type", ["hatsugen_choukai", "hyougen"])
@pytest.mark.parametrize("function", SPOKEN_ACTS)
def test_every_missing_speech_act_now_has_cells(item_type, function):
    table = seedtable.load(item_type)
    for level in table.levels:
        assert any(c.function == function for c in table.cells(level)), (function, level)


@pytest.mark.parametrize("item_type,settings", [
    ("sougou_choukai", ("negotiation", "regular_meeting")),
    ("sougou_choudokkai", ("negotiation", "regular_meeting")),
    ("shiryou_choudokkai", ("negotiation",)),
    ("sougou_dokkai", ("negotiation_thread", "meeting_record", "condolence_notice")),
    ("bamen_haaku", ("negotiation_table",)),
])
def test_the_comprehension_types_gain_situations_not_questions(item_type, settings):
    """Their function axis is what the question asks — who decided, what
    changed, what comes next — and those questions already fit a negotiation or
    a regular meeting. What they lacked was the situation to ask them about."""
    table = seedtable.load(item_type)
    for setting in settings:
        for level in table.levels:
            assert any(c.setting == setting for c in table.cells(level)), (setting, level)


@pytest.mark.parametrize("item_type", ["hatsugen_choukai", "hyougen"])
def test_the_meeting_acts_happen_in_meetings(item_type):
    """An opinion, an objection and the chair belong to a meeting — face to
    face or online, or (for a written objection) in the email thread about it —
    never at the reception counter or over a dinner table."""
    meetings = {"meeting_room", "client_office", "video_call",
                "email_external", "email_internal", "chat_internal"}
    for cell in seedtable.load(item_type).cells():
        if cell.function in ("state_opinion", "object_politely", "chair_meeting"):
            assert cell.setting in meetings, cell.id
        if cell.function == "chair_meeting":
            assert cell.channel in ("in_person", "video"), cell.id


@pytest.mark.parametrize("item_type", ["hatsugen_choukai", "hyougen"])
def test_condolences_are_never_sent_by_chat_or_a_screen(item_type):
    """お見舞い and お悔やみ are said in person, on the phone, or in a considered
    email. A chat message, a posted notice or a video call is the wrong
    medium, and an item set there would teach that it is not."""
    for cell in seedtable.load(item_type).cells():
        if cell.function == "condolence":
            assert cell.channel in ("in_person", "phone", "written"), cell.id
            assert cell.setting not in ("chat_internal", "notice_document"), cell.id


@pytest.mark.parametrize("item_type", ["hatsugen_choukai", "hyougen"])
def test_only_a_superior_gives_instructions(item_type):
    for cell in seedtable.load(item_type).cells():
        if cell.function == "instruct":
            assert cell.relation == "superior_to_subordinate", cell.id
