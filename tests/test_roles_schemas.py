"""Distractor-role enforcement and item validation (fidelity mechanism #1)."""
import pytest

from bjt import fixtures, schemas, seedtable
from bjt.fidelity import roles
from bjt.generators import GENERATORS


def test_fixtures_validate_clean(goi_item, hyougen_item):
    assert schemas.validate_item("goi_bunpou", goi_item) == []
    assert schemas.validate_item("hyougen", hyougen_item) == []


def test_reject_duplicate_role():
    opts = [
        {"text": "a", "role": "correct"},
        {"text": "b", "role": "opposite_valence"},
        {"text": "c", "role": "opposite_valence"},
        {"text": "d", "role": "nonexistent_form"},
    ]
    errs = roles.validate_roles("goi_bunpou", opts)
    assert any("duplicate" in e for e in errs)


def test_reject_role_outside_enum():
    opts = [
        {"text": "a", "role": "correct"},
        {"text": "b", "role": "wrong_honorific_direction"},  # a hyougen role, not goi
        {"text": "c", "role": "nonexistent_form"},
        {"text": "d", "role": "set_phrase_misfit"},
    ]
    errs = roles.validate_roles("goi_bunpou", opts)
    assert any("not in the goi_bunpou enum" in e for e in errs)


def test_reject_missing_correct():
    opts = [{"text": t, "role": "opposite_valence"} for t in "abcd"]
    errs = roles.validate_roles("goi_bunpou", opts)
    assert any("exactly 1 correct" in e for e in errs)


def test_reject_two_correct():
    opts = [
        {"text": "a", "role": "correct"},
        {"text": "b", "role": "correct"},
        {"text": "c", "role": "nonexistent_form"},
        {"text": "d", "role": "set_phrase_misfit"},
    ]
    errs = roles.validate_roles("goi_bunpou", opts)
    assert any("exactly 1 correct" in e for e in errs)


def test_reject_wrong_option_count():
    opts = [
        {"text": "a", "role": "correct"},
        {"text": "b", "role": "opposite_valence"},
        {"text": "c", "role": "nonexistent_form"},
    ]
    errs = roles.validate_roles("goi_bunpou", opts)
    assert any("expected 4 options" in e for e in errs)


def test_reject_duplicate_option_text(goi_item):
    goi_item["options"][1]["text"] = goi_item["options"][0]["text"]
    errs = schemas.validate_item("goi_bunpou", goi_item)
    assert any("duplicate text" in e for e in errs)


def test_correct_index_matches_role(goi_item):
    ci = schemas.correct_index(goi_item["options"])
    assert goi_item["options"][ci]["role"] == roles.CORRECT


def test_schema_constrains_role_enum():
    schema = schemas.build_item_schema("hyougen")
    role_enum = schema["properties"]["options"]["items"]["properties"]["role"]["enum"]
    assert "correct" in role_enum
    assert "wrong_honorific_direction" in role_enum
    assert "opposite_valence" not in role_enum  # that's a goi role


def test_every_item_type_has_role_descriptions():
    for item_type, role_list in roles.DISTRACTOR_ROLES.items():
        for r in role_list:
            assert r in roles.ROLE_DESCRIPTIONS, f"{r} missing a description"


# ----- every type is real, not merely declared ----------------------------

@pytest.mark.parametrize("item_type", sorted(GENERATORS))
def test_every_item_type_has_a_valid_fixture(item_type):
    """A schema nothing ever constructs is a schema that is only asserted. The
    fixtures are the thing that proves each of the nine types can actually be
    filled in — with no API key, before a paid batch run finds out."""
    assert item_type in fixtures.FIXTURES, f"{item_type} has no fixture"
    assert schemas.validate_item(item_type, fixtures.FIXTURES[item_type]) == []


@pytest.mark.parametrize("item_type", sorted(GENERATORS))
def test_every_item_type_has_a_seed_table(item_type):
    """Variety comes from the table. A type without one can only get its
    variety from the prompt, which is the thing the table exists to replace."""
    table = seedtable.load(item_type)
    assert table.cells(), f"{item_type}'s seed table enumerates no valid cells"
    for level in ("J3", "J2", "J1"):
        assert table.cells(level), f"{item_type} has no cells at {level}"


@pytest.mark.parametrize("item_type", sorted(GENERATORS))
def test_every_item_type_has_distinct_distractor_roles(item_type):
    """Three distractors need three distinct roles, so an enum of fewer than
    three cannot produce a valid item at all."""
    assert len(roles.DISTRACTOR_ROLES[item_type]) >= 3
    for role in roles.DISTRACTOR_ROLES[item_type]:
        assert role in roles.ROLE_DESCRIPTIONS, f"{role} has no description"
