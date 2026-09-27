"""The passes over the bank that already shipped (bjt/backfill.py).

Every test here fakes the model. What is under test is the bookkeeping around
it: only live items, only what is missing, every bundle written as soon as it
is done, a run stopped by its ceiling keeping what it paid for, and the next
run picking up where that one stopped.
"""
import json
import pathlib
from types import SimpleNamespace

import pytest

from bjt import batch, cli, config, llm, publish, withdrawn
from bjt.fidelity import answerability, difficulty

ROOT = pathlib.Path(__file__).resolve().parent.parent
#: Two small committed bundles, two live items each, in this order on disk.
SHELVES = ("hyougen_J3_001.json", "sougou_dokkai_J1_001.json")


@pytest.fixture
def bank(tmp_path, monkeypatch):
    """The two bundles in a batches/ of their own, with no rates and nothing
    withdrawn, and a fresh spend ledger: a bank the tests may write to."""
    d = tmp_path / "batches"
    d.mkdir()
    for name in SHELVES:
        bundle = json.loads((ROOT / "batches" / name).read_text(encoding="utf-8"))
        for it in bundle["items"]:
            it.pop("model_p_correct", None)
        batch.save(bundle, d / name)
    (d / withdrawn.LEDGER_NAME).write_text("# nothing withdrawn\n", encoding="utf-8")
    monkeypatch.setattr("bjt.config.BATCH_DIR", d)
    monkeypatch.setattr(llm, "spend", llm.Spend())
    return d


def _cells(d, name):
    return [it["seed_cell"]["id"] for it in batch.load(d / name)["items"]]


def _rates(d, name):
    return [it.get("model_p_correct") for it in batch.load(d / name)["items"]]


def _sql_is_published(d, name):
    """The SQL beside the bundle is exactly what `bjt publish` writes from it."""
    path = d / name
    return path.with_suffix(".sql").read_text(encoding="utf-8") == publish.bundle_sql(
        batch.load(path), path.stem)


@pytest.fixture
def measured(monkeypatch):
    """A probe that answers, and bills one call per item as the real one would
    bill five. Returns the seed cells it was asked about, in order."""
    seen = []

    def measure(item, **k):
        seen.append(item["seed_cell"]["id"])
        llm.spend.add("claude-haiku-4-5", SimpleNamespace(input_tokens=100, output_tokens=10))
        return difficulty.DifficultyResult(rate=0.6, model="weak-model", measured=True, trials=[
            answerability.Trial(side="difficulty", trial=t, chosen=0, correct=t < 3)
            for t in range(5)])

    monkeypatch.setattr(difficulty, "measure", measure)
    return seen


# ----- the probe ----------------------------------------------------------------

def test_the_whole_bank_is_counted_before_anything_is_spent(capsys, monkeypatch):
    def explode(*a, **k):
        raise AssertionError("--dry-run must not reach the model")
    monkeypatch.setattr(difficulty, "measure", explode)

    gone = withdrawn.ids()
    missing = sum(1 for p in batch.bundles() for it in withdrawn.live_items(batch.load(p), gone)
                  if it.get("model_p_correct") is None)
    assert cli.main(["probe", "--all", "--dry-run"]) == 0
    out = capsys.readouterr().out
    if missing:
        assert f"{missing} live item(s) in" in out
        assert f"{missing * config.DIFFICULTY_TRIALS} call(s) to {config.DIFFICULTY_MODEL}" in out
        assert "at least" in out and "run(s)" in out
    else:
        assert "Nothing to measure." in out


def test_a_run_stopped_by_its_ceiling_keeps_what_it_measured(bank, measured, monkeypatch,
                                                                tmp_path, capsys):
    """Three items' allowance for four items: the first bundle is written whole,
    the second with the one item it got to, and the run says it stopped."""
    monkeypatch.setattr("bjt.config.RUN_MAX_CALLS", 3)
    summary = tmp_path / "summary.md"
    assert cli.main(["probe", "--all", "--summary", str(summary)]) == 0

    assert _rates(bank, SHELVES[0]) == [0.6, 0.6]
    assert _rates(bank, SHELVES[1]) == [0.6, None]
    assert _sql_is_published(bank, SHELVES[0]) and _sql_is_published(bank, SHELVES[1])
    assert "model_p_correct" in (bank / SHELVES[1]).with_suffix(".sql").read_text(encoding="utf-8")
    text = summary.read_text(encoding="utf-8")
    assert "Measured the difficulty of 3 item(s) in 2 bundle(s); 1 live item(s) still" in text
    assert "call ceiling reached" in text and "What it cost" in text


def test_the_next_run_resumes_where_the_last_one_stopped(bank, measured, monkeypatch):
    monkeypatch.setattr("bjt.config.RUN_MAX_CALLS", 3)
    assert cli.main(["probe", "--all"]) == 0
    first = list(measured)

    monkeypatch.setattr(llm, "spend", llm.Spend())   # a new run, a new allowance
    assert cli.main(["probe", "--all"]) == 0

    assert measured[len(first):] == [_cells(bank, SHELVES[1])[1]], "only what was left"
    assert _rates(bank, SHELVES[1]) == [0.6, 0.6]
    assert cli.main(["probe", "--all"]) == 0          # and then there is nothing to do
    assert len(measured) == 4


def test_a_withdrawn_item_is_never_measured(bank, measured):
    victim = batch.load(bank / SHELVES[0])["items"][0]
    (bank / withdrawn.LEDGER_NAME).write_text(
        f"{victim['id']}  unnatural  A line nobody would say, for the test.\n", encoding="utf-8")

    assert cli.main(["probe", "--all"]) == 0
    assert victim["seed_cell"]["id"] not in measured and len(measured) == 3
    assert _rates(bank, SHELVES[0]) == [None, 0.6]
    # And the SQL written for its bundle still unpublishes it.
    assert "is_published = false" in (bank / SHELVES[0]).with_suffix(".sql").read_text(
        encoding="utf-8")


def test_an_unreachable_model_stops_the_pass_and_writes_nothing(bank, monkeypatch, capsys):
    calls = []

    def down(item, **k):
        calls.append(1)
        return difficulty.DifficultyResult(model="weak-model", measured=False, trials=[
            answerability.Trial(side="difficulty", trial=t, chosen=None, correct=False)
            for t in range(5)])

    monkeypatch.setattr(difficulty, "measure", down)
    before = {name: (bank / name).read_bytes() for name in SHELVES}
    assert cli.main(["probe", "--all"]) == 1
    assert len(calls) == 3, "three unreachable items in a row are enough"
    assert {name: (bank / name).read_bytes() for name in SHELVES} == before
    assert not list(bank.glob("*.sql"))
    assert "could not be reached for 3 items in a row" in capsys.readouterr().out


@pytest.mark.parametrize("argv", [
    ["probe"],                                               # nothing named
    ["probe", "--all", "batches/hyougen_J3_001.json"],       # both
    ["probe", "batches/hyougen_J3_001.source.json"],         # a source file
    ["probe", "batches/no_such_bundle.json"],                # nothing there
])
def test_a_probe_that_cannot_mean_anything_is_refused(argv, capsys):
    assert cli.main(argv) == 2
    assert capsys.readouterr().err
