"""Two-sided answerability gate (fidelity #2). The model call is faked so the
verdict logic is tested deterministically."""
import pytest

from bjt import schemas
from bjt.fidelity import answerability


def _fake_answerer(full_choice, cold_choice):
    """Return a stand-in for llm.answer_choice that answers full vs cold views
    differently. The cold view's question contains the word 'withheld'."""
    def answer(question, options, model=None):
        is_cold = "withheld" in question
        return {"choice": cold_choice if is_cold else full_choice, "reason": "x"}
    return answer


@pytest.fixture(autouse=True)
def fixed_trials(monkeypatch):
    monkeypatch.setattr("bjt.config.GATE_TRIALS", 3)


def test_kept_when_full_succeeds_cold_fails(monkeypatch, goi_item):
    ci = schemas.correct_index(goi_item["options"])
    wrong = (ci + 1) % 4
    monkeypatch.setattr(answerability.llm, "answer_choice", _fake_answerer(ci, wrong))
    res = answerability.run_gate(goi_item)
    assert res.full_success_rate == 1.0
    assert res.cold_success_rate == 0.0
    assert res.verdict == "kept"
    assert res.kept


def test_discarded_leaky_when_cold_succeeds(monkeypatch, goi_item):
    ci = schemas.correct_index(goi_item["options"])
    # Cold picks the right answer without the stem -> distractors leak.
    monkeypatch.setattr(answerability.llm, "answer_choice", _fake_answerer(ci, ci))
    res = answerability.run_gate(goi_item)
    assert res.cold_success_rate == 1.0
    assert res.verdict == "discarded:leaky"
    assert not res.kept


def test_discarded_ambiguous_when_full_fails(monkeypatch, goi_item):
    ci = schemas.correct_index(goi_item["options"])
    wrong = (ci + 1) % 4
    # Full can't pick the answer even with the stem -> ambiguous.
    monkeypatch.setattr(answerability.llm, "answer_choice", _fake_answerer(wrong, wrong))
    res = answerability.run_gate(goi_item)
    assert res.full_success_rate == 0.0
    assert res.verdict == "discarded:ambiguous"


def test_trial_count_recorded(monkeypatch, goi_item):
    ci = schemas.correct_index(goi_item["options"])
    monkeypatch.setattr(answerability.llm, "answer_choice", _fake_answerer(ci, (ci + 1) % 4))
    res = answerability.run_gate(goi_item)
    assert len([t for t in res.trials if t.side == "full"]) == 3
    assert len([t for t in res.trials if t.side == "cold"]) == 3
