"""The nightly work order, and the difficulty estimate that travels with an item.

Both exist to serve the practice queue, and both are the kind of thing that can
quietly stop working without anything failing: a planner that always picks the
same shelf still produces items, and a bundle that drops the gate's rate still
publishes. So the assertions here are about the properties rather than about the
numbers — emptiest first, budget respected, deterministic, and the estimate
survives the round trip into SQL.
"""
from __future__ import annotations

import json

import pytest

from bjt import batch as batchmod
from bjt import config, fixtures, plan, publish, schemas


def _survey(*shelves) -> plan.Survey:
    """A survey built by hand, so the assertions are about the algorithm rather
    than about whatever happens to be committed in batches/ today."""
    return plan.Survey(
        shelves=[
            plan.Shelf(item_type=t, level=lv, have=have, cells_left=cells)
            for t, lv, have, cells in shelves
        ]
    )


def test_work_order_fills_the_emptiest_shelf_first():
    order = plan.work_order(
        _survey(("a", "J2", 10, 100), ("b", "J2", 0, 100), ("c", "J2", 4, 100)),
        budget=6,
        per_slot=6,
    )
    by_type = {w.item_type: w.n for w in order}
    # b is empty and c has four, so they level up before a is touched at all.
    assert by_type["b"] > by_type.get("c", 0)
    assert "a" not in by_type
    assert sum(by_type.values()) == 6


def test_work_order_levels_rather_than_deepening():
    """Given enough budget, the shelves end up within one item of each other."""
    order = plan.work_order(
        _survey(("a", "J2", 0, 100), ("b", "J2", 0, 100), ("c", "J2", 6, 100)),
        budget=12,
        per_slot=12,
    )
    ends = {}
    for shelf in (("a", 0), ("b", 0), ("c", 6)):
        ends[shelf[0]] = shelf[1]
    for w in order:
        ends[w.item_type] += w.n
    assert max(ends.values()) - min(ends.values()) <= 1


def test_work_order_respects_the_two_caps():
    order = plan.work_order(
        _survey(("a", "J2", 0, 100), ("b", "J2", 0, 100)), budget=7, per_slot=2
    )
    assert sum(w.n for w in order) == 4, "per_slot caps both shelves at two"
    assert all(w.n <= 2 for w in order)


def test_work_order_stops_at_the_end_of_the_seed_table():
    """A shelf with three cells left gets three items, not six."""
    order = plan.work_order(_survey(("a", "J2", 0, 3)), budget=20, per_slot=10)
    assert [w.n for w in order] == [3]


def test_work_order_is_deterministic():
    survey = _survey(("a", "J2", 1, 50), ("b", "J3", 1, 50), ("c", "J1", 1, 50))
    first = plan.work_order(survey, budget=5, per_slot=5)
    second = plan.work_order(survey, budget=5, per_slot=5)
    assert [(w.item_type, w.level, w.n) for w in first] == [
        (w.item_type, w.level, w.n) for w in second
    ], "the same library must produce the same plan, or it cannot be reviewed"


def test_work_order_is_empty_when_every_shelf_is_exhausted():
    assert plan.work_order(_survey(("a", "J2", 40, 0)), budget=10) == []


def test_survey_counts_the_committed_library():
    """The bundles are the ledger, so the real tree is what this reports on."""
    survey = plan.survey()
    assert survey.shelves, "nine types × three levels should not be empty"
    # Every type with a seed table gets a shelf per level in that table.
    assert len({s.item_type for s in survey.shelves}) == 9
    assert survey.items > 0
    hatsugen = {s.level: s for s in survey.shelves if s.item_type == "hatsugen_choukai"}
    assert hatsugen["J2"].have > 0
    assert hatsugen["J2"].cells_left > 0


def test_render_names_the_thin_shelves():
    text = plan.render(
        _survey(("a", "J2", 0, 10)), plan.work_order(_survey(("a", "J2", 0, 10)), budget=2)
    )
    assert "thin" in text
    assert "2 × a J2" in text


# ----- the difficulty estimate travels with the item ---------------------


def _bundle_with_rate(rate):
    item = fixtures.FIXTURES["goi_bunpou"].copy()
    item = json.loads(json.dumps(item))  # deep, and JSON-clean
    item["seed_cell"] = {"id": "x+y+z@J2", "setting": "x", "relation": "y",
                         "function": "z", "level": "J2", "channel": "written"}
    if rate is not None:
        item["model_p_correct"] = rate
    return batchmod.build_bundle("goi_bunpou", "J2", [item], "test-model")


def test_bundle_carries_the_gates_success_rate():
    bundle = _bundle_with_rate(2 / 3)
    assert bundle["items"][0]["model_p_correct"] == pytest.approx(2 / 3)


def test_bundle_omits_the_rate_when_the_gate_did_not_run():
    """Hand-written batches skip the gate, and absent is the honest value —
    writing 1.0 there would tell the queue every reference item is trivial."""
    bundle = _bundle_with_rate(None)
    assert "model_p_correct" not in bundle["items"][0]


def test_the_rate_does_not_break_re_validation():
    """checkbatch re-runs the item validator over a bundle item, so a
    bundle-only field has to be stripped on the way back."""
    bundle = _bundle_with_rate(0.5)
    shape = batchmod._as_generator_shape(bundle["items"][0])
    assert "model_p_correct" not in shape
    assert schemas.validate_item("goi_bunpou", shape) == []


def test_publish_writes_the_rate_and_a_null_when_there_is_none():
    with_rate = publish.bundle_sql(_bundle_with_rate(0.75), "b1")
    assert "model_p_correct" in with_rate
    assert "0.75" in with_rate

    without = publish.bundle_sql(_bundle_with_rate(None), "b2")
    assert "model_p_correct" in without, "the column is always named"
    # ...and the value for it is null rather than a made-up number. The items
    # statement is the one that carries it; the bundles statement above it does
    # not, so the row has to be located rather than taken off the end.
    items_stmt = without.split("insert into public.items ", 1)[1]
    row = items_stmt.split("values ", 1)[1].split("\non conflict", 1)[0]
    assert row.rstrip().endswith("null)")


def test_every_committed_bundle_still_checks_out_with_the_new_field():
    """The regression set, swept rather than named, as everywhere else."""
    for path in batchmod.bundles():
        bundle = batchmod.load(path)
        report = batchmod.check_bundle(bundle)
        assert report.ok, f"{path.name}: {[c.detail for c in report.failed]}"
