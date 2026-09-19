"""The guards that keep a bad night from being an expensive one.

Three of them, each a rule the first real night broke: a shelf that discards
three drafts in a row is abandoned rather than paid for three more times; an
account that cannot pay ends the run rather than failing every remaining
shelf the same way; and the generator's prompt is sent in the shape that
caches, at the effort the bill can afford.
"""
import copy

import pytest

from bjt import cli, config, fixtures, llm
from bjt.fidelity import answerability


@pytest.fixture
def quiet(monkeypatch):
    monkeypatch.setattr("bjt.config.SANITY_ENABLED", False)
    monkeypatch.setattr("bjt.config.DIFFICULTY_ENABLED", False)
    monkeypatch.setattr("bjt.config.GATE_TRIALS", 3)


def _always(item_type="goi_bunpou"):
    return lambda *a, **k: copy.deepcopy(fixtures.FIXTURES[item_type])


def test_a_shelf_that_keeps_discarding_is_abandoned_after_three(store, monkeypatch, quiet):
    generations = []
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: generations.append(1) or _always()())
    # The cold side always picks the key: every draft is leaky.
    monkeypatch.setattr(answerability.llm, "answer_choice",
                        lambda q, o, model=None: {"choice": answerability.correct_index(
                            fixtures.FIXTURES["goi_bunpou"]["options"]), "reason": "x"})
    monkeypatch.setattr("bjt.config.SLOT_PATIENCE", 3)

    path, kept = cli.run_batch(store, "goi_bunpou", "J2", 4, gate=True, sanity_check=False)

    assert path is None and kept == 0
    # Four items asked for would have allowed twelve attempts; three were spent.
    assert len(generations) == 3


def test_a_keep_resets_the_patience(store, monkeypatch, quiet, tmp_path):
    verdicts = iter([False, False, True, False, False, True])
    generations = []

    def gate(item):
        leaky = not next(verdicts)
        return answerability.GateResult(
            cold_success_rate=1.0 if leaky else 0.0,
            full_success_rate=None if leaky else 1.0,
            verdict="discarded:leaky" if leaky else "kept", trials=[])

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: generations.append(1) or _always()())
    monkeypatch.setattr(answerability, "run_gate", gate)
    monkeypatch.setattr("bjt.config.SLOT_PATIENCE", 3)
    # Two discards, a keep, two discards, a keep: never three in a row, so the
    # shelf runs to its two items on six attempts.
    monkeypatch.setattr("bjt.fidelity.dedupe.max_similarity", lambda *a: 0.0)

    # force, because two copies of one fixture are a near-duplicate pair and
    # the bundle check would (rightly) refuse them; the loop is what is tested.
    path, kept = cli.run_batch(store, "goi_bunpou", "J2", 2, gate=True, sanity_check=False,
                               force=True, out=tmp_path / "b.json")
    assert kept == 2 and len(generations) == 6


def test_an_empty_account_ends_the_run_at_once(store, monkeypatch, quiet):
    calls = []

    def broke(*a, **k):
        calls.append(1)
        raise llm.LLMBillingError("API request failed: Your credit balance is too low")

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", broke)
    with pytest.raises(llm.LLMBillingError):
        cli.run_batch(store, "goi_bunpou", "J2", 4, gate=True, sanity_check=False)
    assert len(calls) == 1, "one refusal is enough; the rest are not tried"


def test_a_billing_refusal_is_told_apart_from_other_failures(monkeypatch):
    class Boom:
        class messages:
            @staticmethod
            def create(**kw):
                raise RuntimeError("Error code: 400 - Your credit balance is too low to access the Anthropic API.")

    monkeypatch.setattr(llm, "_get_client", lambda: Boom())
    with pytest.raises(llm.LLMBillingError):
        llm.answer_choice("q", ["a", "b"], model="claude-opus-5")

    class Down:
        class messages:
            @staticmethod
            def create(**kw):
                raise RuntimeError("Error code: 529 - overloaded")

    monkeypatch.setattr(llm, "_get_client", lambda: Down())
    with pytest.raises(llm.LLMError) as err:
        llm.answer_choice("q", ["a", "b"], model="claude-opus-5")
    assert not isinstance(err.value, llm.LLMBillingError)


def test_the_generator_prompt_is_cacheable_and_at_the_configured_effort(monkeypatch):
    seen = {}

    class Client:
        class messages:
            @staticmethod
            def create(**kw):
                seen.update(kw)
                raise RuntimeError("stop here")

    monkeypatch.setattr(llm, "_get_client", lambda: Client())
    monkeypatch.setattr("bjt.config.GEN_EFFORT", "medium")
    with pytest.raises(llm.LLMError):
        llm.generate_structured("the stable half", "the question", {"type": "object"})
    assert seen["system"] == [{"type": "text", "text": "the stable half",
                               "cache_control": {"type": "ephemeral"}}]
    assert seen["output_config"]["effort"] == "medium"


def test_the_defaults_are_the_cheaper_ones():
    from bjt import plan

    # Sonnet writes and Sonnet judges; Opus is one env var away, not the default.
    assert config.GEN_MODEL == "claude-sonnet-5"
    assert config.JUDGE_MODEL == "claude-sonnet-5"
    assert config.GEN_EFFORT == "medium"
    assert config.IMAGE_QUALITY == "medium"
    assert config.SLOT_PATIENCE == 3
    assert (plan.DEFAULT_BUDGET, plan.DEFAULT_PER_SLOT) == (8, 3)


def test_a_discard_is_explained_to_the_next_draft(store, monkeypatch, quiet, tmp_path):
    """The second draft for a shelf is told why the first was rejected. It
    used to be written blind, and it failed the same way."""
    prompts = []

    def fake(system, user, schema, model=None):
        prompts.append(user)
        return copy.deepcopy(fixtures.FIXTURES["goi_bunpou"])

    verdicts = iter([True, False])  # leaky, then kept

    def gate(item):
        leaky = next(verdicts)
        return answerability.GateResult(
            cold_success_rate=1.0 if leaky else 0.0,
            full_success_rate=None if leaky else 1.0,
            verdict="discarded:leaky" if leaky else "kept", trials=[])

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", fake)
    monkeypatch.setattr(answerability, "run_gate", gate)
    path, kept = cli.run_batch(store, "goi_bunpou", "J2", 1, gate=True, sanity_check=False,
                               out=tmp_path / "b.json")
    assert kept == 1 and len(prompts) == 2
    assert "REJECTED" not in prompts[0]
    assert "REJECTED by review" in prompts[1] and "stem hidden" in prompts[1]
