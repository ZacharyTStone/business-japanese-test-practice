"""A night that hits its ceiling keeps what it already paid for.

The spend, call and minute ceilings stop a run with an `LLMSpendLimitError`.
The shelf that was being written when it came had kept items in memory only,
and the stop threw them away: the most expensive way for the cheapest guard to
fire. These hold `run_batch` to bundling what it kept before it passes the
stop on, and `run_night` to publishing that bundle and ending the night.
"""
import copy
import json

import pytest

from bjt import batch, config, fixtures, llm, pipeline, plan, publish
from bjt.fidelity import dedupe


@pytest.fixture
def night(tmp_path, monkeypatch):
    """A bank in a temporary directory, a generator that writes the fixture,
    and no proofreader, gate or probe to fake."""
    monkeypatch.setattr(config, "BATCH_DIR", tmp_path)
    monkeypatch.setattr(config, "SANITY_ENABLED", False)
    monkeypatch.setattr(config, "DIFFICULTY_ENABLED", False)
    monkeypatch.setattr(dedupe, "max_similarity", lambda *a: 0.0)
    return tmp_path


def _writer(monkeypatch, succeed: int):
    """A generator that writes `succeed` drafts and then meets the ceiling."""
    calls = []

    def generate(system, user, schema, model=None):
        calls.append(1)
        if len(calls) > succeed:
            raise llm.LLMSpendLimitError("spend ceiling reached: $0.50 of $0.50")
        return copy.deepcopy(fixtures.FIXTURES["goi_bunpou"])

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", generate)
    return calls


def test_the_ceiling_ends_the_shelf_but_not_what_it_kept(store, night, monkeypatch):
    _writer(monkeypatch, succeed=2)
    # force: two copies of one fixture are a near-duplicate pair the bundle
    # check (rightly) refuses; what is tested is that they reach it at all.
    with pytest.raises(pipeline.ShelfStopped) as stop:
        pipeline.run_batch(store, "goi_bunpou", "J2", 4, gate=False, sanity_check=False,
                           force=True, out=night / "b.json")
    # Still a billing error, so every caller that ends a run for one ends it.
    assert isinstance(stop.value, llm.LLMBillingError)
    assert stop.value.kept == 2
    assert stop.value.path is not None and stop.value.path.exists()
    assert len(batch.load(stop.value.path)["items"]) == 2


def test_a_shelf_stopped_before_it_kept_anything_writes_nothing(store, night, monkeypatch):
    _writer(monkeypatch, succeed=0)
    with pytest.raises(pipeline.ShelfStopped) as stop:
        pipeline.run_batch(store, "goi_bunpou", "J2", 4, gate=False, sanity_check=False)
    assert (stop.value.path, stop.value.kept) == (None, 0)
    assert not list(night.glob("*.json"))


def test_the_night_publishes_the_stopped_shelf_and_goes_no_further(store, night, monkeypatch):
    calls = _writer(monkeypatch, succeed=1)
    order = [plan.WorkItem("goi_bunpou", "J2", 2, have=0, cells_left=50),
             plan.WorkItem("hyougen", "J2", 1, have=0, cells_left=50)]

    result = pipeline.run_night(store, order, gate=False, sanity_check=False)

    assert [(t, lv, n) for t, lv, n, _ in result.written] == [("goi_bunpou", "J2", 1)]
    path = result.written[0][3]
    assert path.with_suffix(".sql").exists(), "the stopped shelf's SQL is written too"
    assert "spend ceiling" in (result.stopped or "")
    assert any("everything after it" in f for f in result.failures)
    assert len(calls) == 2, "the second shelf was never started"


def test_a_night_with_no_stop_runs_every_shelf(store, night, monkeypatch):
    _writer(monkeypatch, succeed=99)
    order = [plan.WorkItem("goi_bunpou", "J2", 1, have=0, cells_left=50),
             plan.WorkItem("hyougen", "J2", 1, have=0, cells_left=50)]
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda system, user, schema, model=None: copy.deepcopy(
                            fixtures.FIXTURES["hyougen" if "表現" in system else "goi_bunpou"]))
    result = pipeline.run_night(store, order, gate=False, sanity_check=False)
    assert result.stopped is None
    assert [t for t, *_ in result.written] == ["goi_bunpou", "hyougen"]


def test_the_nightly_command_reports_the_stopped_shelf_as_written(store, night, monkeypatch, tmp_path):
    _writer(monkeypatch, succeed=1)
    monkeypatch.setattr(plan, "work_order", lambda *a, **k: [
        plan.WorkItem("goi_bunpou", "J2", 2, have=0, cells_left=50)])
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "night.db")
    from bjt import cli

    summary = tmp_path / "summary.md"
    assert cli.main(["nightly", "--no-gate", "--no-sanity", "--summary", str(summary)]) == 0
    text = summary.read_text(encoding="utf-8")
    assert "1 × goi_bunpou J2" in text
    assert "stopped at 1 of 2" in text


def test_the_published_sql_matches_what_publish_writes(store, night, monkeypatch):
    _writer(monkeypatch, succeed=1)
    order = [plan.WorkItem("goi_bunpou", "J2", 2, have=0, cells_left=50)]
    result = pipeline.run_night(store, order, gate=False, sanity_check=False)
    path = result.written[0][3]
    bundle = json.loads(path.read_text(encoding="utf-8"))
    assert path.with_suffix(".sql").read_text(encoding="utf-8") == publish.bundle_sql(bundle, path.stem)
