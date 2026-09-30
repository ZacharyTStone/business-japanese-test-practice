"""A shelf never writes two items on one seed cell.

After a near-duplicate the shelf moves on to its next cell. With the cells
drawn for exactly `n` items, "next" wrapped round to a cell an item had
already been kept on (n=2: kept on A, duplicate on B, back to A), the bundle
failed "seed cells distinct", and the whole shelf was thrown away.
"""
import copy

import pytest

from bjt import batch, config, fixtures, pipeline, seedtable
from bjt.fidelity import dedupe


@pytest.fixture
def shelf(tmp_path, monkeypatch, store):
    monkeypatch.setattr(config, "BATCH_DIR", tmp_path)
    monkeypatch.setattr(config, "SANITY_ENABLED", False)
    monkeypatch.setattr(config, "DIFFICULTY_ENABLED", False)
    drafted = []

    def generate(self, level=None, *, cell=None, feedback=None, **kw):
        drafted.append(cell.id)
        item = copy.deepcopy(fixtures.FIXTURES["goi_bunpou"])
        item["item_type"], item["level"] = "goi_bunpou", cell.level
        item["seed_cell"] = cell.to_dict()
        item["topic"] = f"topic {len(drafted)}"
        return item

    monkeypatch.setattr("bjt.generators.base.Generator.generate", generate)
    return drafted


def test_a_near_duplicate_never_sends_the_shelf_back_to_a_kept_cell(store, shelf, monkeypatch, tmp_path):
    # Kept, near-duplicate, kept.
    similarity = iter([0.0, 1.0, 0.0])
    monkeypatch.setattr(dedupe, "max_similarity", lambda *a: next(similarity))

    path, kept = pipeline.run_batch(store, "goi_bunpou", "J2", 2, gate=False, sanity_check=False,
                                    force=True, out=tmp_path / "b.json")

    assert kept == 2 and len(shelf) == 3
    assert len(set(shelf)) == 3, f"a cell was drafted twice: {shelf}"
    report = batch.check_bundle(batch.load(path))
    distinct = next(c for c in report.checks if c.name == "seed cells distinct")
    assert distinct.status == "pass"


def test_a_shelf_past_its_drawn_cells_draws_a_fresh_one(store, shelf, monkeypatch, tmp_path):
    # Every draft but the last is a near-duplicate of the first: more cells
    # are spent than were drawn up front, and each is new.
    monkeypatch.setattr("bjt.config.SLOT_PATIENCE", 10)
    similarity = iter([0.0, 1.0, 1.0, 1.0, 1.0, 0.0])
    monkeypatch.setattr(dedupe, "max_similarity", lambda *a: next(similarity))

    path, kept = pipeline.run_batch(store, "goi_bunpou", "J2", 2, gate=False, sanity_check=False,
                                    force=True, out=tmp_path / "b.json")
    assert kept == 2
    assert len(shelf) == 6 and len(set(shelf)) == 6
    assert len(shelf) > 2 + pipeline.CELL_SURPLUS


def test_a_discard_keeps_the_same_cell(store, shelf, monkeypatch, tmp_path):
    """The one time a cell is drafted again: the gate refused it, and the next
    draft is the same situation with the reviewer's reason in hand."""
    verdicts = iter(["discarded:leaky", "kept"])
    monkeypatch.setattr("bjt.fidelity.answerability.run_gate", lambda item: type(
        "G", (), {"cold_success_rate": 0.0, "full_success_rate": 1.0,
                  "verdict": next(verdicts), "trials": []})())
    monkeypatch.setattr(dedupe, "max_similarity", lambda *a: 0.0)
    pipeline.run_batch(store, "goi_bunpou", "J2", 1, gate=True, sanity_check=False,
                       force=True, out=tmp_path / "b.json")
    assert len(shelf) == 2 and shelf[0] == shelf[1]


def test_a_shelf_whose_table_runs_dry_keeps_what_it_has(store, shelf, monkeypatch, tmp_path):
    table = seedtable.load("goi_bunpou")
    only = table.cells("J2")[:2]
    monkeypatch.setattr(pipeline, "_spent_cells",
                        lambda store, t: {c.id for c in table.cells("J2")} - {c.id for c in only})
    similarity = iter([0.0, 1.0])
    monkeypatch.setattr(dedupe, "max_similarity", lambda *a: next(similarity))

    path, kept = pipeline.run_batch(store, "goi_bunpou", "J2", 2, gate=False, sanity_check=False,
                                    force=True, out=tmp_path / "b.json")
    assert kept == 1 and path is not None
    assert len(shelf) == 2
