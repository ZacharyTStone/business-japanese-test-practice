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

from bjt import backfill, batch, cli, config, llm, publish, withdrawn
from bjt.fidelity import answerability, difficulty, sanity

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


# ----- the regate ----------------------------------------------------------------

def _key(item):
    return next(i for i, o in enumerate(item["options"]) if o["role"] == "correct")


def _ids(d):
    return [it["id"] for name in SHELVES for it in batch.load(d / name)["items"]]


@pytest.fixture
def reviewers(bank, monkeypatch):
    """A proofreader and a gate that say, by seed cell, what the test decides:
    the first question is clean and kept, the second reads unnaturally, the
    third's options give it away, the fourth's key is disputed. Each
    proofreading bills one call. Returns what each was asked about."""
    cells = _cells(bank, SHELVES[0]) + _cells(bank, SHELVES[1])
    plan = dict(zip(cells, ["kept", "unnatural", "leaky", "wrong"]))
    asked = {"sanity": [], "gate": []}

    def proofread(item, **k):
        cell = item["seed_cell"]["id"]
        asked["sanity"].append(cell)
        llm.spend.add("claude-haiku-4-5", SimpleNamespace(input_tokens=100, output_tokens=10))
        if plan.get(cell) == "down":
            return sanity.SanityResult(checked=False, notes="API request failed: overloaded")
        if plan.get(cell) == "unnatural":
            return sanity.SanityResult(faults=["unnatural_japanese", "broken_japanese"],
                                       notes="「お借りさせていただかせていただいても」は\n誰も言わない。")
        return sanity.SanityResult()

    def gate(item):
        cell = item["seed_cell"]["id"]
        asked["gate"].append(cell)
        ci = _key(item)
        other = (ci + 1) % 4
        T = answerability.Trial
        cold = [T("cold", 0, other, False), T("cold", 1, other, False)]
        if plan.get(cell) == "leaky":
            return answerability.GateResult(1.0, None, "discarded:leaky", [
                T("cold", 0, ci, True, "only this option answers a request"),
                T("cold", 1, ci, True, "the others are refusals")])
        if plan.get(cell) == "wrong":
            return answerability.GateResult(0.0, 0.0, "discarded:ambiguous", [
                T("full", 0, other, False, "the document says Tuesday"),
                T("full", 1, other, False), *cold])
        if plan.get(cell) == "unreachable":
            return answerability.GateResult(0.0, 1.0, "kept", [
                T("full", 0, ci, True), T("full", 1, None, False), *cold])
        return answerability.GateResult(0.0, 1.0, "kept", [
            T("full", 0, ci, True), T("full", 1, ci, True), *cold])

    monkeypatch.setattr(sanity, "run_check", proofread)
    monkeypatch.setattr(answerability, "run_gate", gate)
    return SimpleNamespace(cells=cells, plan=plan, asked=asked)


def test_the_regate_dry_run_counts_the_calls_and_spends_nothing(capsys, monkeypatch):
    def explode(*a, **k):
        raise AssertionError("--dry-run must not reach a model")
    monkeypatch.setattr(sanity, "run_check", explode)
    monkeypatch.setattr(answerability, "run_gate", explode)

    gone, done = withdrawn.ids(), backfill.load_regated()
    todo = sum(1 for p in batch.bundles() for it in withdrawn.live_items(batch.load(p), gone)
               if it["id"] not in done)
    assert cli.main(["regate", "--all", "--dry-run"]) == 0
    out = capsys.readouterr().out
    if todo:
        assert f"{todo} live question(s) in" in out
        assert f"at most {todo * (1 + 2 * config.GATE_TRIALS)} call(s)" in out


def test_every_verdict_is_written_down_and_the_failures_are_proposed(bank, reviewers, capsys):
    ledger = (bank / withdrawn.LEDGER_NAME).read_text(encoding="utf-8")
    assert cli.main(["regate", "--all"]) == 0
    out = capsys.readouterr().out

    ids = _ids(bank)
    got = backfill.load_regated()
    assert [(got[i].verdict, got[i].reason) for i in ids] == [
        ("kept", "-"),
        ("discarded:sanity", "unnatural"),
        ("discarded:leaky", "other"),
        ("discarded:ambiguous", "wrong_answer")]
    # The proofreader never hands the gate a question it already failed.
    assert reviewers.asked["gate"] == [reviewers.cells[0], reviewers.cells[2], reviewers.cells[3]]
    assert "unnatural_japanese+broken_japanese" in got[ids[1]].note
    assert "\n" not in got[ids[1]].note
    assert "only this option answers a request" in got[ids[2]].note
    assert "chose option" in got[ids[3]].note and "the document says Tuesday" in got[ids[3]].note

    # Proposed, not written: the ledger is untouched without --withdraw.
    assert (bank / withdrawn.LEDGER_NAME).read_text(encoding="utf-8") == ledger
    assert "`--withdraw` appends these" in out
    assert out.count(f"  {ids[1]}  unnatural") == 1


def test_withdraw_appends_the_proposals_and_publishes_them(bank, reviewers):
    before = (bank / withdrawn.LEDGER_NAME).read_text(encoding="utf-8")
    bundles = {name: (bank / name).read_bytes() for name in SHELVES}
    assert cli.main(["regate", "--all", "--withdraw"]) == 0

    after = (bank / withdrawn.LEDGER_NAME).read_text(encoding="utf-8")
    assert after.startswith(before), "nothing in the ledger is rewritten or removed"
    assert "proposed by `bjt regate`" in after
    ids = _ids(bank)
    ledger = withdrawn.load()
    assert {i: w.reason for i, w in ledger.items()} == {
        ids[1]: "unnatural", ids[2]: "other", ids[3]: "wrong_answer"}
    assert all(len(w.note) >= 20 for w in ledger.values())

    # The bundles are not edited; their SQL is what `bjt publish` writes now,
    # and it unpublishes exactly the proposals.
    assert {name: (bank / name).read_bytes() for name in SHELVES} == bundles
    for name in SHELVES:
        assert _sql_is_published(bank, name)
    unpublished = (bank / SHELVES[0]).with_suffix(".sql").read_text(
        encoding="utf-8").split("is_published = false")[1]
    assert ids[1] in unpublished and ids[0] not in unpublished

    # A second run finds nothing left to check and nothing new to add.
    assert cli.main(["regate", "--all", "--withdraw"]) == 0
    assert (bank / withdrawn.LEDGER_NAME).read_text(encoding="utf-8") == after


def test_a_regate_stopped_by_its_ceiling_carries_on_where_it_stopped(bank, reviewers,
                                                                        monkeypatch):
    # Each question costs one proofreading call here; two calls' allowance
    # stops the run after two questions.
    monkeypatch.setattr("bjt.config.RUN_MAX_CALLS", 2)
    assert cli.main(["regate", "--all"]) == 0
    assert list(backfill.load_regated()) == _ids(bank)[:2]

    monkeypatch.setattr(llm, "spend", llm.Spend())
    assert cli.main(["regate", "--all"]) == 0
    assert reviewers.asked["sanity"] == reviewers.cells, "each question checked exactly once"
    assert list(backfill.load_regated()) == _ids(bank)


def test_an_outage_decides_nothing(bank, reviewers):
    for cell in reviewers.cells:
        reviewers.plan[cell] = "down"
    assert cli.main(["regate", "--all", "--withdraw"]) == 1
    assert len(reviewers.asked["sanity"]) == backfill.UNREACHABLE_PATIENCE
    assert not backfill.regate_ledger_path().exists()
    assert withdrawn.load() == {}


def test_a_gate_that_could_not_answer_every_trial_decides_nothing(bank, reviewers):
    reviewers.plan[reviewers.cells[0]] = "unreachable"
    assert cli.main(["regate", "--all"]) == 0
    assert _ids(bank)[0] not in backfill.load_regated()


def test_an_overruled_or_withdrawn_question_is_left_alone(bank, reviewers):
    ids = _ids(bank)
    backfill.record_regated(backfill.Regated(ids[1], "overruled", "2026-09-27", "unnatural",
                                             "Read by the owner, who keeps it."))
    (bank / withdrawn.LEDGER_NAME).write_text(
        f"{ids[2]}  unclear       Withdrawn by hand before the regate ran.\n", encoding="utf-8")

    assert cli.main(["regate", "--all", "--withdraw"]) == 0
    assert reviewers.asked["sanity"] == [reviewers.cells[0], reviewers.cells[3]]
    assert set(withdrawn.load()) == {ids[2], ids[3]}, "only the fresh failure is added"


def test_every_proofreader_flag_has_a_reason_in_the_ledgers_set():
    assert set(backfill.SANITY_REASONS) == set(sanity.RULES)
    assert set(backfill.SANITY_REASONS.values()) <= set(withdrawn.REASONS)


def test_the_withdrawn_ledger_only_grows(tmp_path):
    path = tmp_path / "w.txt"
    path.write_text("# a header\nabc123  unnatural     Nobody says this, for the test.",
                    encoding="utf-8")
    W = withdrawn.Withdrawal
    for bad in (W("abc123", "unclear", "Already withdrawn, so refused."),
                W("def456", "boring", "Not a reason in the closed set."),
                W("def456", "unclear", "Two\nlines are not one line."),
                W("def456", "unclear", "  ")):
        with pytest.raises(ValueError):
            withdrawn.append([bad], path=path)
    assert withdrawn.append([W("def456", "wrong_answer", "The key cannot be right.")],
                            heading="proposed by a test", path=path) == 1
    text = path.read_text(encoding="utf-8")
    assert text.startswith("# a header\nabc123  unnatural     Nobody says this, for the test.\n")
    assert text.endswith("\n# proposed by a test\ndef456  wrong_answer  The key cannot be right.\n")
    assert set(withdrawn.load(path)) == {"abc123", "def456"}
