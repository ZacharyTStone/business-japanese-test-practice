"""A stop-the-run error is never mistaken for a failed call.

`LLMBillingError` (and the run's own ceiling, `LLMSpendLimitError`) is an
`LLMError`, so every call site that tolerates a failed call — the proofreader,
the gate's trials, the probe, the picture reader — would swallow it with a
bare `except LLMError` and let the run carry on refusing itself. Each of them
lets it through; these hold them to that.
"""
import copy
from types import SimpleNamespace

import pytest

from bjt import cli, fixtures, jev, llm, pipeline, scene_art, scenes
from bjt.fidelity import answerability, difficulty, sanity


def _ceiling(*a, **k):
    raise llm.LLMSpendLimitError("spend ceiling reached: $0.50 of $0.50")


def test_the_proofreader_lets_the_ceiling_through(monkeypatch, goi_item):
    monkeypatch.setattr("bjt.config.SANITY_ENABLED", True)
    monkeypatch.setattr(sanity.llm, "sanity_check", _ceiling)
    with pytest.raises(llm.LLMSpendLimitError):
        sanity.run_check(goi_item)


def test_the_gate_lets_the_ceiling_through(monkeypatch, goi_item):
    monkeypatch.setattr(answerability.llm, "answer_choice", _ceiling)
    with pytest.raises(llm.LLMSpendLimitError):
        answerability.run_gate(goi_item)


def test_the_probe_lets_the_ceiling_through(monkeypatch, goi_item):
    monkeypatch.setattr("bjt.config.DIFFICULTY_ENABLED", True)
    monkeypatch.setattr(answerability.llm, "answer_choice", _ceiling)
    with pytest.raises(llm.LLMSpendLimitError):
        difficulty.measure(goi_item)


def test_the_jev_probe_lets_an_empty_account_through(monkeypatch, goi_item):
    monkeypatch.setattr("bjt.config.DIFFICULTY_ENABLED", True)

    def broke(*a, **k):
        raise llm.LLMBillingError("Jev request failed: HTTP 402")

    monkeypatch.setattr(jev, "choice_probabilities", broke)
    with pytest.raises(llm.LLMBillingError):
        difficulty.measure(goi_item, model="jev-latest")


def test_the_picture_reader_lets_the_ceiling_through(monkeypatch):
    scene = scenes.Scene(scene_id="pic_x", label_ja="", used_by=("gazou_haaku",),
                         cell_count=1, brief="a desk", question="q",
                         options=("a", "b", "c", "d"), answer=0)
    monkeypatch.setattr(llm, "review_scene_image", lambda *a, **k: {"notes": ""})
    monkeypatch.setattr(llm, "answer_from_image", _ceiling)
    with pytest.raises(llm.LLMSpendLimitError):
        scene_art.review_with_model(b"img", "image/png", scene)


def test_a_kept_item_whose_probe_meets_the_ceiling_is_kept_unmeasured(store, monkeypatch):
    item = copy.deepcopy(fixtures.FIXTURES["goi_bunpou"])
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: copy.deepcopy(item))
    monkeypatch.setattr("bjt.config.SANITY_ENABLED", False)
    monkeypatch.setattr("bjt.config.DIFFICULTY_ENABLED", True)
    monkeypatch.setattr(answerability, "run_gate", lambda it: answerability.GateResult(
        0.0, 1.0, "kept", [answerability.Trial("cold", 0, 1, False),
                           answerability.Trial("full", 0, 0, True)]))
    monkeypatch.setattr(answerability.llm, "answer_choice", _ceiling)

    out, _, kept, detail, _ = pipeline.generate_and_gate(store, "goi_bunpou", "J2", gate=True)
    assert kept, "the gate passed it and it was paid for"
    assert out["model_p_correct"] == 1.0, "the gate's rate stands in"


def test_the_smoke_run_stops_at_the_ceiling(tmp_path, monkeypatch):
    monkeypatch.setattr("bjt.config.DB_PATH", tmp_path / "smoke.db")
    calls = []

    def over(*a, **k):
        calls.append(1)
        _ceiling()

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", over)
    with pytest.raises(llm.LLMSpendLimitError):
        cli.cmd_smoke(SimpleNamespace(type="goi_bunpou", level="J2", n=5, no_gate=True))
    assert len(calls) == 1
