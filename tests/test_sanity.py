"""The cheap proofreading pass (fidelity #6). The model call is faked, so what is
tested is the verdict logic, what the checker is shown, and — the part that
actually saves money — that a flagged item never reaches the answerability gate."""
import copy
from types import SimpleNamespace

import pytest

from bjt import cli, fixtures, llm, schemas
from bjt.fidelity import sanity


def _clean(**overrides):
    """A stand-in for llm.sanity_check that reports no fault unless told to."""
    verdict = {rule: False for rule in sanity.RULES}
    verdict["notes"] = ""
    verdict.update(overrides)
    return lambda rendered, rules, model=None: verdict


@pytest.fixture(autouse=True)
def sanity_on(monkeypatch):
    monkeypatch.setattr("bjt.config.SANITY_ENABLED", True)


# ----- the verdict --------------------------------------------------------

def test_clean_item_passes(monkeypatch, goi_item):
    monkeypatch.setattr(sanity.llm, "sanity_check", _clean())
    res = sanity.run_check(goi_item)
    assert res.ok and res.checked
    assert res.faults == []


def test_every_rule_can_fail_the_item(monkeypatch, goi_item):
    for rule in sanity.RULES:
        monkeypatch.setattr(sanity.llm, "sanity_check", _clean(**{rule: True}))
        res = sanity.run_check(goi_item)
        assert not res.ok, rule
        assert res.faults == [rule]


def test_unreachable_model_is_not_a_pass(monkeypatch, goi_item):
    """An outage must not read as a clean item. `checked` is how the caller
    tells 'nothing wrong with it' from 'nobody looked'."""
    def boom(*a, **k):
        raise llm.LLMError("api down")

    monkeypatch.setattr(sanity.llm, "sanity_check", boom)
    res = sanity.run_check(goi_item)
    assert res.checked is False
    assert res.ok  # not discarded — the expensive gate still gets its turn
    assert "did not run" in res.notes


def test_disabled_does_not_call_the_model(monkeypatch, goi_item):
    called = []
    monkeypatch.setattr("bjt.config.SANITY_ENABLED", False)
    monkeypatch.setattr(sanity.llm, "sanity_check",
                        lambda *a, **k: called.append(1) or _clean()(*a, **k))
    res = sanity.run_check(goi_item)
    assert called == []
    assert res.checked is False


# ----- what the checker is shown -----------------------------------------

def test_render_shows_the_answer_key_and_the_explanation(goi_item):
    text = sanity.render_for_sanity(goi_item)
    ci = schemas.correct_index(goi_item["options"])
    assert goi_item["stem"] in text
    assert f"正解として印がついているのは: {ci}." in text
    assert goi_item["explanation_ja"] in text
    for o in goi_item["options"]:
        assert o["text"] in text


def test_render_includes_a_document_stimulus():
    """A reading item whose document was invisible to the checker would be
    proofread without the thing that makes its answer right."""
    item = copy.deepcopy(fixtures.FIXTURES["sougou_dokkai"])
    text = sanity.render_for_sanity(item)
    assert "--- 資料 ---" in text
    assert item["document"]["title"] in text


def test_render_includes_a_dialogue_stimulus():
    item = copy.deepcopy(fixtures.FIXTURES["sougou_choukai"])
    text = sanity.render_for_sanity(item)
    assert "--- 会話 ---" in text
    assert item["dialogue"][0]["text"] in text


# ----- the saving ---------------------------------------------------------

def test_a_flagged_item_never_reaches_the_gate(tmp_path, monkeypatch, store):
    """The whole point of running first: six calls to a strong model are not
    spent on an item a one-call proofreader already condemned."""
    gate_calls = []
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: copy.deepcopy(fixtures.FIXTURES["hyougen"]))
    monkeypatch.setattr(sanity.llm, "sanity_check", _clean(explanation_mismatch=True))
    monkeypatch.setattr("bjt.fidelity.answerability.run_gate",
                        lambda item: gate_calls.append(item) or None)

    item, iid, kept, detail = cli._generate_and_gate(store, "hyougen", "J2", gate=True)

    assert gate_calls == []
    assert not kept
    assert "sanity=explanation_mismatch" in detail


def test_a_clean_item_goes_on_to_the_gate(tmp_path, monkeypatch, store):
    gate_calls = []

    def fake_gate(item):
        gate_calls.append(item)
        return SimpleNamespace(cold_success_rate=0.0, full_success_rate=1.0,
                               verdict="kept", trials=[])

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: copy.deepcopy(fixtures.FIXTURES["hyougen"]))
    monkeypatch.setattr(sanity.llm, "sanity_check", _clean())
    monkeypatch.setattr("bjt.fidelity.answerability.run_gate", fake_gate)

    item, iid, kept, detail = cli._generate_and_gate(store, "hyougen", "J2", gate=True)

    assert len(gate_calls) == 1
    assert kept
    assert item["model_p_correct"] == 1.0
