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
    # The cold side decides, so the full side is never asked: no full trials,
    # no full rate. And two right answers of a planned three already settle
    # "leaky", so the third cold call is not made either.
    assert res.full_success_rate is None
    assert [t.side for t in res.trials] == ["cold"] * 2


def test_the_cold_side_runs_first_and_alone_when_it_leaks(monkeypatch, goi_item):
    ci = schemas.correct_index(goi_item["options"])
    asked = []

    def answer(question, options, model=None):
        asked.append("cold" if "withheld" in question else "full")
        return {"choice": ci, "reason": "x"}

    monkeypatch.setattr(answerability.llm, "answer_choice", answer)
    answerability.run_gate(goi_item)
    assert asked == ["cold", "cold"]


def test_discarded_ambiguous_when_full_fails(monkeypatch, goi_item):
    ci = schemas.correct_index(goi_item["options"])
    wrong = (ci + 1) % 4
    # Full can't pick the answer even with the stem -> ambiguous.
    monkeypatch.setattr(answerability.llm, "answer_choice", _fake_answerer(wrong, wrong))
    res = answerability.run_gate(goi_item)
    assert res.full_success_rate == 0.0
    assert res.verdict == "discarded:ambiguous"


def test_trial_count_recorded(monkeypatch, goi_item):
    """Two of three settle each side when the answers agree; a split pair
    needs the third. Every trial that ran is recorded."""
    ci = schemas.correct_index(goi_item["options"])
    monkeypatch.setattr(answerability.llm, "answer_choice", _fake_answerer(ci, (ci + 1) % 4))
    res = answerability.run_gate(goi_item)
    assert len([t for t in res.trials if t.side == "full"]) == 2
    assert len([t for t in res.trials if t.side == "cold"]) == 2


def test_a_split_pair_asks_the_third(monkeypatch, goi_item):
    ci = schemas.correct_index(goi_item["options"])
    cold = iter([ci, (ci + 1) % 4, (ci + 1) % 4])   # right, wrong, wrong → clean
    full = iter([ci, (ci + 1) % 4, ci])             # right, wrong, right → kept

    def answer(question, options, model=None):
        return {"choice": next(cold) if "withheld" in question else next(full), "reason": "x"}

    monkeypatch.setattr(answerability.llm, "answer_choice", answer)
    res = answerability.run_gate(goi_item)
    assert res.verdict == "kept"
    assert len([t for t in res.trials if t.side == "cold"]) == 3
    assert len([t for t in res.trials if t.side == "full"]) == 3
    assert res.cold_success_rate == pytest.approx(1 / 3)


@pytest.mark.parametrize("outcomes", [(a, b, c) for a in (0, 1) for b in (0, 1) for c in (0, 1)])
def test_early_stopping_never_changes_a_verdict(outcomes):
    """For every sequence of three answers, stopping early gives the verdict
    the full three would have. The saving is calls, never accuracy."""
    planned = 3
    for decided, judge in ((answerability.cold_decided, answerability.is_leaky),
                           (answerability.full_decided, answerability.is_ambiguous)):
        full_verdict = judge(sum(outcomes), planned)
        seen = 0
        for n, o in enumerate(outcomes, start=1):
            seen += o
            if decided(seen, n, planned):
                break
        assert judge(seen, planned) == full_verdict, (outcomes, decided.__name__)


# ----- the two views, per type -----------------------------------------------

def _doc_item(item_type):
    import copy
    from bjt import fixtures
    return copy.deepcopy(fixtures.FIXTURES[item_type])


@pytest.mark.parametrize("item_type", ["joukyou_haaku", "shiryou_choudokkai", "sougou_dokkai"])
def test_the_full_view_carries_the_document(item_type):
    """The judge used to be shown the narration alone: an item whose answer
    needed the page was 'ambiguous' and one whose audio was decorative was
    'kept'. Both halves now reach the full view."""
    from bjt.render import document
    item = _doc_item(item_type)
    full, cold = answerability.questions(item)
    doc_text = document.text_of(item["document"])
    first_line = doc_text.splitlines()[0]
    assert first_line in full
    assert item["stem"] in full
    assert "withheld" in cold


def test_the_document_types_withhold_the_audio_not_the_document():
    from bjt.render import document
    item = _doc_item("joukyou_haaku")
    full, cold = answerability.questions(item)
    assert document.text_of(item["document"]).splitlines()[0] in cold
    assert item["stem"] not in cold, "the spoken request is the withheld half"


def test_the_dialogue_types_carry_the_conversation_in_the_full_view_only():
    item = _doc_item("sougou_choukai")
    full, cold = answerability.questions(item)
    first_turn = item["dialogue"][0]["text"]
    assert first_turn in full
    assert first_turn not in cold
    assert item["stem"] in cold, "the question is shown; the conversation is withheld"


def test_the_reading_type_withholds_the_passage():
    from bjt.render import document
    item = _doc_item("sougou_dokkai")
    full, cold = answerability.questions(item)
    assert document.text_of(item["document"]).splitlines()[0] not in cold
    assert item["stem"] in cold


def test_the_integrated_type_carries_both_documents_and_every_turn():
    from bjt.render import document
    item = _doc_item("sougou_choudokkai")
    full, cold = answerability.questions(item)
    for doc in item["documents"]:
        assert document.text_of(doc).splitlines()[0] in full
        assert document.text_of(doc).splitlines()[0] in cold
    for turn in item["dialogue"]:
        assert turn["text"] in full
        assert turn["text"] not in cold


def test_a_stem_only_type_keeps_the_options_only_cold_view(goi_item):
    full, cold = answerability.questions(goi_item)
    assert goi_item["stem"] in full
    assert goi_item["stem"] not in cold and "withheld" in cold


def test_the_judges_reason_is_kept_and_fed_back(monkeypatch, goi_item):
    ci = schemas.correct_index(goi_item["options"])
    monkeypatch.setattr(answerability.llm, "answer_choice",
                        lambda q, o, model=None: {"choice": ci, "reason": "the only polite one"})
    res = answerability.run_gate(goi_item)
    assert res.verdict == "discarded:leaky"
    assert all(t.reason == "the only polite one" for t in res.trials)
    text = answerability.leak_description("goi_bunpou", res)
    assert "the only polite one" in text and text.count("the only polite one") == 1
    assert "stem hidden" in text
    # No result, or no cold reasons: the plain sentence, as before.
    assert "own words" not in answerability.leak_description("goi_bunpou")
