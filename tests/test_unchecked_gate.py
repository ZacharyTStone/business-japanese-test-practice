"""A gate whose judge did not answer has checked nothing.

Scored as a wrong answer, an unanswered cold trial reads as a clean cold side,
and two of them settled "not leaky" before the full side was asked; an item
whose judge was down all night walked through. These hold the gate, the
pipeline and the model wrapper to "unchecked": not kept, and nothing told to
the next draft, because nothing was found.
"""
import copy
from types import SimpleNamespace

import pytest

from bjt import fixtures, llm, pipeline, schemas
from bjt.fidelity import answerability


@pytest.fixture(autouse=True)
def three_trials(monkeypatch):
    monkeypatch.setattr("bjt.config.GATE_TRIALS", 3)
    monkeypatch.setattr("bjt.config.SANITY_ENABLED", False)
    monkeypatch.setattr("bjt.config.DIFFICULTY_ENABLED", False)


def _judge(item, *, cold_fails=False, full_fails=False, asked=None):
    ci = schemas.correct_index(item["options"])
    correct = item["options"][ci]["text"]

    def answer(question, options, model=None):
        cold = "withheld" in question
        if asked is not None:
            asked.append("cold" if cold else "full")
        if (cold and cold_fails) or (not cold and full_fails):
            raise llm.LLMError("API request failed: overloaded")
        key = options.index(correct)
        return {"choice": (key + 1) % 4 if cold else key, "reason": "x"}
    return answer


def test_a_failing_cold_trial_leaves_the_item_unchecked(monkeypatch, goi_item):
    asked = []
    monkeypatch.setattr(answerability.llm, "answer_choice",
                        _judge(goi_item, cold_fails=True, asked=asked))
    res = answerability.run_gate(goi_item)
    assert res.verdict == answerability.UNCHECKED
    assert not res.kept
    assert res.cold_success_rate is None and res.full_success_rate is None
    # One unanswered trial settles it: nothing after it is bought, and the
    # full side is never asked on the strength of a cold side nobody read.
    assert asked == ["cold"]


def test_a_failing_full_trial_leaves_the_item_unchecked(monkeypatch, goi_item):
    monkeypatch.setattr(answerability.llm, "answer_choice", _judge(goi_item, full_fails=True))
    res = answerability.run_gate(goi_item)
    assert res.verdict == answerability.UNCHECKED
    # Two clean cold trials settle the cold side; the first full trial fails.
    assert [t.side for t in res.trials] == ["full", "cold", "cold"]


def test_an_unchecked_draft_is_not_kept_and_tells_the_next_one_nothing(store, monkeypatch):
    item = copy.deepcopy(fixtures.FIXTURES["goi_bunpou"])
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: copy.deepcopy(item))
    monkeypatch.setattr(answerability.llm, "answer_choice", _judge(item, cold_fails=True))

    _, iid, kept, detail, reason = pipeline.generate_and_gate(store, "goi_bunpou", "J2", gate=True)
    assert not kept
    assert reason is None, "an outage is not a fault for the next draft to fix"
    assert "verdict=unchecked" in detail
    assert store.get_item(iid)["gate_verdict"] == "unchecked"


def test_a_gate_result_that_claims_kept_over_an_unanswered_trial_is_not_trusted(store, monkeypatch):
    item = copy.deepcopy(fixtures.FIXTURES["goi_bunpou"])
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: copy.deepcopy(item))
    monkeypatch.setattr(answerability, "run_gate", lambda it: answerability.GateResult(
        0.0, 1.0, "kept", [answerability.Trial("cold", 0, None, False),
                           answerability.Trial("full", 0, 1, True)]))
    _, _, kept, _, reason = pipeline.generate_and_gate(store, "goi_bunpou", "J2", gate=True)
    assert not kept and reason is None


def test_a_run_of_unchecked_drafts_sends_no_feedback(store, monkeypatch, tmp_path):
    item = copy.deepcopy(fixtures.FIXTURES["goi_bunpou"])
    told = []

    def generate(self, level, *, cell=None, feedback=None):
        told.append(feedback)
        return copy.deepcopy(item)

    monkeypatch.setattr("bjt.generators.base.Generator.generate", generate)
    monkeypatch.setattr(answerability.llm, "answer_choice", _judge(item, cold_fails=True))
    monkeypatch.setattr("bjt.config.SLOT_PATIENCE", 3)
    path, kept = pipeline.run_batch(store, "goi_bunpou", "J2", 1, gate=True, sanity_check=False,
                                    out=tmp_path / "b.json")
    assert (path, kept) == (None, 0)
    assert told == [None, None, None]


def test_a_reply_cut_off_at_its_ceiling_is_its_own_error_and_is_billed(monkeypatch):
    fresh = llm.Spend()
    monkeypatch.setattr(llm, "spend", fresh)

    class Client:
        class messages:
            @staticmethod
            def create(**kw):
                return SimpleNamespace(
                    stop_reason="max_tokens", stop_details=None,
                    content=[SimpleNamespace(type="text", text='{"choice": 1, "reason": "becau')],
                    usage=SimpleNamespace(input_tokens=100, output_tokens=1500))

    monkeypatch.setattr(llm, "_get_client", lambda: Client())
    with pytest.raises(llm.LLMTruncatedError) as err:
        llm.answer_choice("q", ["a", "b"], model="claude-sonnet-5")
    assert "max_tokens" in str(err.value)
    assert isinstance(err.value, llm.LLMError)
    assert fresh.calls == 1 and fresh.usd > 0


def test_a_truncated_judge_reply_is_an_unanswered_trial(monkeypatch, goi_item):
    def cut_off(*a, **k):
        raise llm.LLMTruncatedError("reply cut off (max_tokens)")

    monkeypatch.setattr(answerability.llm, "answer_choice", cut_off)
    assert answerability.run_gate(goi_item).verdict == answerability.UNCHECKED
