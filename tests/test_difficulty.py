"""The difficulty probe. The model call is faked, so what is tested is the rate
arithmetic, that an unreachable model never yields a number, and — the part the
practice queue relies on — that a kept item ships with the probe's rate and an
item the probe could not measure falls back to the gate's."""
import copy

import pytest

from bjt import cli, fixtures, llm
from bjt.fidelity import answerability, difficulty


def _answerer(pattern, seen=None):
    """A stand-in for llm.answer_choice that answers the full view from a
    fixed pattern of right/wrong per trial, and records the model asked."""
    calls = iter(pattern)

    def answer(question, options, model=None):
        if seen is not None:
            seen.append((model, question))
        right = next(calls)
        # The item is shuffled by the generator, so find the key by its text.
        ci = options.index(_correct_text())
        return {"choice": ci if right else (ci + 1) % 4, "reason": "x"}
    return answer


def _correct_text():
    from bjt.fidelity import roles
    return next(o["text"] for o in fixtures.FIXTURES["goi_bunpou"]["options"]
                if o["role"] == roles.CORRECT)


@pytest.fixture(autouse=True)
def probe_on(monkeypatch):
    monkeypatch.setattr("bjt.config.DIFFICULTY_ENABLED", True)
    monkeypatch.setattr("bjt.config.DIFFICULTY_TRIALS", 5)
    monkeypatch.setattr("bjt.config.DIFFICULTY_MODEL", "weak-model")
    monkeypatch.setattr("bjt.config.GATE_TRIALS", 3)


# ----- the rate -----------------------------------------------------------

def test_rate_is_the_fraction_of_trials_answered_correctly(monkeypatch, goi_item):
    seen = []
    monkeypatch.setattr(answerability.llm, "answer_choice",
                        _answerer([True, True, False, True, False], seen))
    res = difficulty.measure(goi_item)
    assert res.measured
    assert res.rate == pytest.approx(3 / 5)
    assert res.model == "weak-model"
    assert len(res.trials) == 5 and all(t.side == "difficulty" for t in res.trials)
    assert "weak-model" in res.detail() and "60%" in res.detail()


def test_probe_asks_the_difficulty_model_the_full_view(monkeypatch, goi_item):
    """The weak model, not the judge — and the stimulus, not the cold view:
    a cold-view pass rate would be a leakage number, not a difficulty."""
    seen = []
    monkeypatch.setattr(answerability.llm, "answer_choice", _answerer([True] * 5, seen))
    difficulty.measure(goi_item)
    assert {m for m, _ in seen} == {"weak-model"}
    assert all(goi_item["stem"] in q for _, q in seen)
    assert not any("withheld" in q for _, q in seen)


def test_unreachable_model_is_not_measured(monkeypatch, goi_item):
    """An outage yields no rate at all. Zero would tell the queue the item is
    impossible; one would tell it the item is trivial; both are lies."""
    def boom(*a, **k):
        raise llm.LLMError("api down")

    monkeypatch.setattr(answerability.llm, "answer_choice", boom)
    res = difficulty.measure(goi_item)
    assert res.measured is False
    assert res.rate is None
    assert "did not run" in res.notes
    assert res.detail() == "difficulty=unmeasured"


def test_one_failed_trial_leaves_the_item_unmeasured(monkeypatch, goi_item):
    """A refusal is not a wrong answer. Counting it as one would call the item
    harder than it is, so a short measurement is no measurement."""
    calls = iter([True, True, None, True, True])

    def flaky(question, options, model=None):
        right = next(calls)
        if right is None:
            raise llm.LLMError("refused")
        return {"choice": options.index(_correct_text()), "reason": "x"}

    monkeypatch.setattr(answerability.llm, "answer_choice", flaky)
    res = difficulty.measure(goi_item)
    assert res.measured is False and res.rate is None


def test_switched_off_does_not_call_the_model(monkeypatch, goi_item):
    called = []
    monkeypatch.setattr("bjt.config.DIFFICULTY_ENABLED", False)
    monkeypatch.setattr(answerability.llm, "answer_choice",
                        lambda *a, **k: called.append(1))
    res = difficulty.measure(goi_item)
    assert called == []
    assert res.measured is False
    assert res.detail() == "difficulty=skipped"


# ----- what ships -----------------------------------------------------------

def _gate_answerer(kept: bool):
    """The judge: full right, cold wrong when the item is to be kept; cold right
    (leaky) otherwise. The probe's calls are told apart by the model name."""
    def answer(question, options, model=None):
        ci = options.index(_correct_text())
        if model == "weak-model":
            raise AssertionError("the probe's calls must be stubbed separately")
        cold = "withheld" in question
        if cold:
            return {"choice": ci if not kept else (ci + 1) % 4, "reason": "x"}
        return {"choice": ci, "reason": "x"}
    return answer


def _route(gate_answer, probe_answer):
    def answer(question, options, model=None):
        if model == "weak-model":
            return probe_answer(question, options, model=model)
        return gate_answer(question, options, model=model)
    return answer


@pytest.fixture
def generated(monkeypatch):
    monkeypatch.setattr("bjt.config.SANITY_ENABLED", False)
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: copy.deepcopy(fixtures.FIXTURES["goi_bunpou"]))


def test_kept_item_ships_with_the_probes_rate_not_the_gates(store, monkeypatch, generated):
    probe_calls = []
    monkeypatch.setattr(answerability.llm, "answer_choice", _route(
        _gate_answerer(kept=True),
        _answerer([True, False, False, True, False], probe_calls)))

    item, iid, kept, detail, _ = cli._generate_and_gate(store, "goi_bunpou", "J2", gate=True)

    assert kept
    assert len(probe_calls) == 5
    assert item["model_p_correct"] == pytest.approx(2 / 5)
    stored = store.get_item(iid)
    assert stored["full_success_rate"] == 1.0, "the gate's own number is untouched"
    assert "difficulty=40% (weak-model)" in detail
    sides = [r["side"] for r in store.conn.execute("SELECT side FROM gate_trials WHERE item_id=?", (iid,))]
    # Two agreeing full trials settle the gate; the probe always runs its five.
    assert sides.count("difficulty") == 5 and sides.count("full") == 2


def test_unmeasured_item_falls_back_to_the_gates_rate(store, monkeypatch, generated):
    def down(question, options, model=None):
        raise llm.LLMError("api down")

    monkeypatch.setattr(answerability.llm, "answer_choice", _route(_gate_answerer(kept=True), down))

    item, iid, kept, detail, _ = cli._generate_and_gate(store, "goi_bunpou", "J2", gate=True)

    assert kept
    assert item["model_p_correct"] == 1.0
    assert "difficulty=unmeasured" in detail
    sides = [r["side"] for r in store.conn.execute("SELECT side FROM gate_trials WHERE item_id=?", (iid,))]
    assert "difficulty" not in sides, "an unmeasured probe leaves no trials behind"


def test_switched_off_leaves_the_gates_rate_and_makes_no_call(store, monkeypatch, generated):
    monkeypatch.setattr("bjt.config.DIFFICULTY_ENABLED", False)
    probe_calls = []
    monkeypatch.setattr(answerability.llm, "answer_choice", _route(
        _gate_answerer(kept=True), _answerer([True] * 5, probe_calls)))

    item, iid, kept, detail, _ = cli._generate_and_gate(store, "goi_bunpou", "J2", gate=True)

    assert kept
    assert probe_calls == []
    assert item["model_p_correct"] == 1.0
    assert "difficulty=" not in detail


def test_discarded_item_is_never_probed(store, monkeypatch, generated):
    """Cheapest-first: the probe is spend, and a discarded item ships nowhere."""
    probe_calls = []
    monkeypatch.setattr(answerability.llm, "answer_choice", _route(
        _gate_answerer(kept=False), _answerer([True] * 5, probe_calls)))

    item, iid, kept, detail, _ = cli._generate_and_gate(store, "goi_bunpou", "J2", gate=True)

    assert not kept and "discarded:leaky" in detail
    assert probe_calls == []
    assert "difficulty=" not in detail


def test_probe_runs_when_the_gate_is_skipped(store, monkeypatch, generated):
    """No gate means no full-view rate to fall back on, which is exactly when a
    cheap measurement is worth the most."""
    probe_calls = []
    monkeypatch.setattr(answerability.llm, "answer_choice", _route(
        _gate_answerer(kept=True), _answerer([True, True, True, True, False], probe_calls)))

    item, iid, kept, detail, _ = cli._generate_and_gate(store, "goi_bunpou", "J2", gate=False)

    assert kept and len(probe_calls) == 5
    assert item["model_p_correct"] == pytest.approx(4 / 5)
    assert store.get_item(iid)["full_success_rate"] is None


def test_quality_summary_reads_the_probes_trials(store, monkeypatch, generated):
    monkeypatch.setattr(answerability.llm, "answer_choice", _route(
        _gate_answerer(kept=True), _answerer([True, False, True, False, True])))
    cli._generate_and_gate(store, "goi_bunpou", "J2", gate=True)
    rows = store.difficulty_summary()
    assert rows == [{"item_type": "goi_bunpou", "avg_rate": pytest.approx(3 / 5), "n": 1}]
