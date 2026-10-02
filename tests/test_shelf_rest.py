"""A shelf that writes nothing night after night rests, and the night goes elsewhere.

From 2026-09-28 three nights in a row went to the same three shelves — one the
API refused outright, two whose every draft the gates threw away — and wrote
nothing for their money, because a shelf that cannot be written stays furthest
behind its share and the work order sends every night back to it. These hold
the ledger to its rule (three misses rest a shelf for a week, then it is tried
once more), the work order to passing a resting shelf over, and the night to
recording what each shelf did, and only what was the shelf's doing.
"""
from __future__ import annotations

import copy
import datetime as dt

import pytest

from bjt import config, fixtures, llm, pipeline, plan, r2, shelf_rest
from bjt.fidelity import dedupe

NOW = dt.datetime(2026, 10, 2, 18, 0, tzinfo=dt.timezone.utc)
CREDS = r2.Credentials("acct", "key", "secret")


def _night(days_ago: float) -> dt.datetime:
    return NOW - dt.timedelta(days=days_ago)


def _keys(*marks) -> list[str]:
    return [shelf_rest.marker(t, lv, outcome, when) for t, lv, outcome, when in marks]


M, W = shelf_rest.MISSED, shelf_rest.WRITTEN


# ----- the rule ---------------------------------------------------------------

def test_a_marker_reads_back_as_what_was_written():
    keys = _keys(("hyougen", "J3", M, _night(1)), ("hyougen", "J3", W, _night(3)),
                 ("sougou_choudokkai", "J1", M, _night(2)))
    assert all(k.startswith("nightly/shelves/") for k in keys)
    history = shelf_rest.parse(keys + ["nightly/shelves/junk", "nightly/shelves/a.b.c.lost"])
    assert history[("hyougen", "J3")] == [(_night(3), W), (_night(1), M)]  # oldest first
    assert history[("sougou_choudokkai", "J1")] == [(_night(2), M)]
    assert len(history) == 2


def test_three_misses_in_a_row_rest_a_shelf_for_a_week():
    history = shelf_rest.parse(_keys(*[("gazou_haaku", "J1", M, _night(d)) for d in (3, 2, 1)]))
    rest = shelf_rest.resting(history, NOW, after=3, days=7)
    assert rest == {("gazou_haaku", "J1"): _night(1) + dt.timedelta(days=7)}
    # A week after the last miss it is tried once more...
    assert shelf_rest.resting(history, _night(1) + dt.timedelta(days=7), after=3, days=7) == {}
    # ...and one more miss then rests it again, since the last three are misses.
    later = _night(1) + dt.timedelta(days=7)
    again = shelf_rest.parse(_keys(*[("gazou_haaku", "J1", M, _night(d)) for d in (3, 2, 1)],
                                   ("gazou_haaku", "J1", M, later)))
    assert ("gazou_haaku", "J1") in shelf_rest.resting(again, later + dt.timedelta(hours=1),
                                                       after=3, days=7)


def test_one_written_night_clears_the_streak():
    history = shelf_rest.parse(_keys(("hyougen", "J3", M, _night(4)), ("hyougen", "J3", M, _night(3)),
                                     ("hyougen", "J3", W, _night(2)), ("hyougen", "J3", M, _night(1))))
    assert shelf_rest.resting(history, NOW, after=3, days=7) == {}


def test_two_misses_are_not_yet_a_pattern_and_zero_turns_resting_off():
    two = shelf_rest.parse(_keys(("hyougen", "J3", M, _night(2)), ("hyougen", "J3", M, _night(1))))
    assert shelf_rest.resting(two, NOW, after=3, days=7) == {}
    three = shelf_rest.parse(_keys(*[("hyougen", "J3", M, _night(d)) for d in (3, 2, 1)]))
    assert shelf_rest.resting(three, NOW, after=0, days=7) == {}


# ----- the bucket -------------------------------------------------------------

def test_no_bucket_rests_nothing_and_records_nothing(monkeypatch):
    monkeypatch.setattr(r2, "list_keys", lambda *a, **k: pytest.fail("no bucket, no call"))
    monkeypatch.setattr(r2, "put", lambda *a, **k: pytest.fail("no bucket, no call"))
    assert shelf_rest.load(NOW) == ({}, None)
    assert shelf_rest.record([("hyougen", "J3", M)], NOW) is None


def test_a_ledger_that_cannot_be_read_tries_every_shelf(monkeypatch):
    def broken(*a, **k):
        raise RuntimeError("HTTP 500")
    monkeypatch.setattr(r2, "list_keys", broken)
    rest, warning = shelf_rest.load(NOW, creds=CREDS)
    assert rest == {} and "every shelf is tried" in (warning or "")


def test_the_ledger_is_read_and_written_under_its_own_prefix(monkeypatch):
    stored = _keys(*[("hyougen", "J3", M, _night(d)) for d in (3, 2, 1)])
    asked = {}

    def list_keys(creds, prefix, delimiter=None):
        asked.update(prefix=prefix, delimiter=delimiter)
        return list(stored)

    put = []
    monkeypatch.setattr(r2, "list_keys", list_keys)
    monkeypatch.setattr(r2, "put", lambda creds, key, data, ct, overwrite=True: put.append((key, overwrite)))
    rest, warning = shelf_rest.load(NOW, creds=CREDS)
    assert warning is None and ("hyougen", "J3") in rest
    assert asked == {"prefix": "nightly/shelves/", "delimiter": "/"}
    assert shelf_rest.record([("hyougen", "J3", W), ("gazou_haaku", "J1", M)], NOW, creds=CREDS) is None
    assert put == [(shelf_rest.marker("hyougen", "J3", W, NOW), False),
                   (shelf_rest.marker("gazou_haaku", "J1", M, NOW), False)]
    # Never somewhere the Worker serves: it serves audio/ and scenes/ only.
    assert not any(k.startswith(("audio/", "scenes/")) for k, _ in put)


def test_a_marker_that_cannot_be_written_is_a_warning_not_a_failed_night(monkeypatch):
    def put(creds, key, *a, **k):
        if "gazou" in key:
            raise RuntimeError("HTTP 403")
        raise r2.AlreadyExists(key)
    monkeypatch.setattr(r2, "put", put)
    warning = shelf_rest.record([("hyougen", "J3", W), ("gazou_haaku", "J1", M)], NOW, creds=CREDS)
    assert warning and "gazou_haaku J1" in warning and "hyougen" not in warning


# ----- the work order ---------------------------------------------------------

def test_the_work_order_passes_a_resting_shelf_over():
    survey = plan.Survey(shelves=[plan.Shelf("hyougen", "J3", 0, 100),
                                  plan.Shelf("hyougen", "J2", 5, 100),
                                  plan.Shelf("goi_bunpou", "J2", 6, 100)])
    before = plan.work_order(survey, budget=2, per_slot=2, reading_min=0)
    assert [(w.item_type, w.level) for w in before] == [("hyougen", "J3")]
    after = plan.work_order(survey, budget=2, per_slot=2, reading_min=0,
                            resting={("hyougen", "J3"): NOW})
    assert ("hyougen", "J3") not in {(w.item_type, w.level) for w in after}
    assert sum(w.n for w in after) == 2, "its share of the night goes to the next shelf"


def test_the_plan_says_which_shelves_rest_and_until_when():
    survey = plan.Survey(shelves=[plan.Shelf("hyougen", "J3", 0, 100), plan.Shelf("hyougen", "J2", 5, 100)])
    rest = {("hyougen", "J3"): dt.datetime(2026, 10, 8, tzinfo=dt.timezone.utc)}
    order = plan.work_order(survey, budget=1, per_slot=1, reading_min=0, resting=rest)
    text = plan.render(survey, order, rest)
    assert "Resting tonight" in text and "hyougen J3   tried again from 2026-10-08" in text
    assert plan.to_json(survey, order, rest)["resting"] == [
        {"item_type": "hyougen", "level": "J3", "until": "2026-10-08T00:00:00+00:00"}]


# ----- the night --------------------------------------------------------------

@pytest.fixture
def night(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "BATCH_DIR", tmp_path)
    monkeypatch.setattr(config, "SANITY_ENABLED", False)
    monkeypatch.setattr(config, "DIFFICULTY_ENABLED", False)
    monkeypatch.setattr(dedupe, "max_similarity", lambda *a: 0.0)
    return tmp_path


def test_the_night_records_written_missed_and_nothing_for_a_stop(store, night, monkeypatch):
    def run_batch(store, item_type, level, n, **kw):
        if item_type == "hyougen":
            return None, 0  # tried, nothing passed the gates
        if item_type == "sougou_choudokkai":
            raise llm.LLMError("Schema is too complex")
        raise llm.LLMSpendLimitError("spend ceiling reached")

    monkeypatch.setattr(pipeline, "run_batch", run_batch)
    order = [plan.WorkItem("hyougen", "J3", 1, 0, 50),
             plan.WorkItem("sougou_choudokkai", "J1", 1, 0, 50),
             plan.WorkItem("bamen_haaku", "J1", 1, 0, 50)]
    result = pipeline.run_night(store, order, gate=False, sanity_check=False)
    assert result.outcomes == [("hyougen", "J3", M), ("sougou_choudokkai", "J1", M)]
    assert result.stopped and "ceiling" in result.stopped


def test_a_written_shelf_is_recorded_as_written(store, night, monkeypatch):
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda system, user, schema, model=None: copy.deepcopy(fixtures.FIXTURES["goi_bunpou"]))
    order = [plan.WorkItem("goi_bunpou", "J2", 1, 0, 50)]
    result = pipeline.run_night(store, order, gate=False, sanity_check=False)
    assert result.outcomes == [("goi_bunpou", "J2", W)]


def test_the_nightly_command_rests_reads_and_records(store, night, monkeypatch, tmp_path):
    """End to end through `bjt nightly`: a resting shelf is left out of the
    order, and the shelf that ran is recorded."""
    from bjt import cli
    from bjt.cli import generate as gen

    monkeypatch.setattr(gen, "_now", lambda: NOW)
    monkeypatch.setattr(shelf_rest, "load", lambda now: ({("hyougen", "J2"): NOW + dt.timedelta(days=2)}, None))
    recorded = []
    monkeypatch.setattr(shelf_rest, "record", lambda outcomes, now: recorded.extend(outcomes))
    seen = {}

    def work_order(state, **kw):
        seen.update(kw)
        return [plan.WorkItem("goi_bunpou", "J2", 1, 0, 50)]

    monkeypatch.setattr(plan, "work_order", work_order)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "night.db")
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda system, user, schema, model=None: copy.deepcopy(fixtures.FIXTURES["goi_bunpou"]))
    assert cli.main(["nightly", "--no-gate", "--no-sanity"]) == 0
    assert seen["resting"] == {("hyougen", "J2"): NOW + dt.timedelta(days=2)}
    assert recorded == [("goi_bunpou", "J2", W)]
