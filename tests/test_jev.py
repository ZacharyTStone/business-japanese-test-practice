"""Jev as the difficulty probe's instrument (bjt/jev.py), and `bjt probe --compare`.

Nothing here reaches TypeSafe: the one HTTP seam, `jev._post`, is replaced.
What is under test is what this repository owes any model it calls — the
ceilings before the call, the bill after it, an unreadable reply that becomes
"unmeasured" and never a rate — and that a comparison writes nothing.
"""
import copy
import io
import json
import math
import pathlib
import urllib.error
from types import SimpleNamespace

import pytest

from bjt import backfill, batch, cli, fixtures, jev, llm, pipeline, withdrawn
from bjt.fidelity import answerability, difficulty, roles

ROOT = pathlib.Path(__file__).resolve().parent.parent
JEV = "jev-latest"


def _reply(probs: dict, usage=None) -> bytes:
    body = {"model": "jev-1.13.0",
            "answers": {jev.QUESTION: {"type": "choice", "choice": max(probs, key=probs.get),
                                       "probabilities": probs, "confidence": 0.8}}}
    if usage is not None:
        body["usage"] = usage
    return json.dumps(body).encode("utf-8")


@pytest.fixture
def ledger(monkeypatch):
    fresh = llm.Spend()
    monkeypatch.setattr(llm, "spend", fresh)
    return fresh


@pytest.fixture
def keyed(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")


@pytest.fixture
def wire(monkeypatch):
    """The transport. Set `.reply` (bytes) or `.error` (an exception); every
    request is kept in `.sent` as (url, parsed body, headers)."""
    state = SimpleNamespace(sent=[], reply=_reply({"option_1": 0.7, "option_2": 0.1,
                                                   "option_3": 0.1, "option_4": 0.1},
                                                  {"input_tokens": 300, "output_tokens": 30}),
                            error=None)

    def post(url, data, headers, timeout):
        state.sent.append((url, json.loads(data.decode("utf-8")), headers))
        if state.error is not None:
            raise state.error
        return state.reply

    monkeypatch.setattr(jev, "_post", post)
    return state


def _correct_text():
    return next(o["text"] for o in fixtures.FIXTURES["goi_bunpou"]["options"]
                if o["role"] == roles.CORRECT)


# ----- the request and the reply --------------------------------------------------

def test_the_question_is_the_state_and_the_options_are_the_criteria():
    body = jev.request_body("問題文", ["一", "二", "三", "四"], JEV)
    assert body["model"] == JEV and body["state"] == "問題文"
    q = body["questions"][jev.QUESTION]
    assert q["type"] == "choice"
    assert list(q["criteria"].items()) == [("option_1", "一"), ("option_2", "二"),
                                           ("option_3", "三"), ("option_4", "四")]


def test_probabilities_come_back_in_option_order_over_our_options_only():
    """TypeSafe's own example names an answer it was not offered; the share of
    ours is what a rate can be made of."""
    reply = json.loads(_reply({"option_2": 0.3, "option_1": 0.5, "option_3": 0.1,
                               "option_4": 0.0, "somewhere_else": 0.1}))
    probs = jev.probabilities(reply, 4)
    assert probs == pytest.approx([0.5 / 0.9, 0.3 / 0.9, 0.1 / 0.9, 0.0])
    assert sum(probs) == pytest.approx(1.0)


@pytest.mark.parametrize("probs", [
    {"option_1": 0.5, "option_2": 0.5, "option_3": 0.0},               # one missing
    {"option_1": 0.5, "option_2": 0.5, "option_3": 0.0, "option_4": -0.1},
    {"option_1": 0.5, "option_2": 0.5, "option_3": 0.0, "option_4": math.nan},
    {"option_1": 0.5, "option_2": 0.5, "option_3": 0.0, "option_4": "0.1"},
    {"option_1": True, "option_2": 0, "option_3": 0, "option_4": 0},
    {"option_1": 0, "option_2": 0, "option_3": 0, "option_4": 0},        # nothing on ours
])
def test_a_reply_that_is_not_a_distribution_is_an_error_not_a_guess(probs):
    reply = {"answers": {jev.QUESTION: {"probabilities": probs}}}
    with pytest.raises(llm.LLMError):
        jev.probabilities(reply, 4)


@pytest.mark.parametrize("reply", [{}, {"answers": {}}, {"answers": {"other": {}}}, [], "x"])
def test_a_reply_of_another_shape_is_an_error(reply):
    with pytest.raises(llm.LLMError):
        jev.probabilities(reply, 4)


# ----- the call ---------------------------------------------------------------------

def test_the_call_sends_the_key_to_the_configured_url(ledger, keyed, wire, monkeypatch):
    monkeypatch.setattr("bjt.config.JEV_URL", "https://jev.example/v1/systemone")
    probs = jev.choice_probabilities("問題", ["a", "b", "c", "d"], model=JEV)
    assert probs == pytest.approx([0.7, 0.1, 0.1, 0.1])
    url, body, headers = wire.sent[0]
    assert url == "https://jev.example/v1/systemone"
    assert headers["Authorization"] == "Bearer test-key"
    assert body["model"] == JEV


def test_no_key_is_an_error_and_no_request(ledger, wire, monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with pytest.raises(llm.LLMError, match="TYPESAFE_API_KEY"):
        jev.choice_probabilities("q", ["a", "b"], model=JEV)
    assert wire.sent == []


def test_the_ceilings_are_checked_before_the_call(ledger, keyed, wire, monkeypatch):
    monkeypatch.setattr("bjt.config.RUN_MAX_CALLS", 1)
    jev.choice_probabilities("q", ["a", "b", "c", "d"], model=JEV)
    with pytest.raises(llm.LLMSpendLimitError):
        jev.choice_probabilities("q", ["a", "b", "c", "d"], model=JEV)
    assert len(wire.sent) == 1, "the call past the ceiling was never made"


def test_every_reply_is_on_the_bill(ledger, keyed, wire):
    jev.choice_probabilities("q", ["a", "b", "c", "d"], model=JEV)
    assert ledger.calls == 1 and ledger.calls_by_model == {JEV: 1}
    assert ledger.input_tokens == 300 and ledger.usd > 0


def test_jev_is_priced_as_the_dearest_model_until_its_rate_is_confirmed():
    """Not in the price table on purpose: its rate was read from secondary
    sources, and a guess too low is the one way the ledger may not be wrong.
    When the rate is read off TypeSafe's own price list, add the row and
    change this test."""
    u = SimpleNamespace(input_tokens=1_000_000, output_tokens=1_000_000)
    assert llm.price_usd(JEV, u) == llm.price_usd("claude-opus-5", u)


def test_a_reply_without_usage_is_priced_on_the_request_size(ledger, keyed, wire):
    """Bytes are more than tokens, so the estimate errs high."""
    wire.reply = _reply({"option_1": 1.0, "option_2": 0.0})
    jev.choice_probabilities("日本語の問題", ["a", "b"], model=JEV)
    sent = json.dumps(jev.request_body("日本語の問題", ["a", "b"], JEV),
                      ensure_ascii=False).encode("utf-8")
    assert ledger.input_tokens == len(sent) and ledger.usd > 0


def test_a_reply_that_is_not_json_is_billed_and_then_an_error(ledger, keyed, wire):
    wire.reply = b"<html>gateway</html>"
    with pytest.raises(llm.LLMError, match="not JSON"):
        jev.choice_probabilities("q", ["a", "b"], model=JEV)
    assert ledger.calls == 1 and ledger.usd > 0


def _http_error(code, body):
    return urllib.error.HTTPError("https://x", code, "err", hdrs=None, fp=io.BytesIO(body))


def test_an_account_that_cannot_pay_stops_the_run(ledger, keyed, wire):
    wire.error = _http_error(402, b'{"error": "insufficient_quota"}')
    with pytest.raises(llm.LLMBillingError):
        jev.choice_probabilities("q", ["a", "b"], model=JEV)


def test_any_other_failure_is_an_ordinary_error(ledger, keyed, wire):
    wire.error = _http_error(500, b"upstream timeout")
    with pytest.raises(llm.LLMError) as e:
        jev.choice_probabilities("q", ["a", "b"], model=JEV)
    assert not isinstance(e.value, llm.LLMBillingError)
    wire.error = urllib.error.URLError("egress blocked")
    with pytest.raises(llm.LLMError):
        jev.choice_probabilities("q", ["a", "b"], model=JEV)


# ----- the probe ----------------------------------------------------------------

@pytest.fixture
def jev_probe(monkeypatch):
    monkeypatch.setattr("bjt.config.DIFFICULTY_ENABLED", True)
    monkeypatch.setattr("bjt.config.DIFFICULTY_TRIALS", 5)
    monkeypatch.setattr("bjt.config.DIFFICULTY_MODEL", JEV)


def _probabilities_for_key(p_key, seen=None):
    """Jev's stand-in: `p_key` on the correct option, the rest shared out."""
    def ask(question, options, model=None):
        if seen is not None:
            seen.append((model, question))
        ci = options.index(_correct_text())
        rest = (1 - p_key) / (len(options) - 1)
        return [p_key if i == ci else rest for i in range(len(options))]
    return ask



@pytest.mark.parametrize("value, expected", [("", "claude-haiku-4-5"), ("  ", "claude-haiku-4-5"),
                                             ("jev-latest", "jev-latest")])
def test_an_empty_difficulty_model_means_the_default(value, expected):
    """The nightly workflow passes a repository variable that may not exist,
    which reaches the process as an empty string."""
    import os
    import subprocess
    import sys
    env = {**os.environ, "BJT_DIFFICULTY_MODEL": value}
    env.pop("BJT_SANITY_MODEL", None)
    out = subprocess.run([sys.executable, "-c", "from bjt import config; print(config.DIFFICULTY_MODEL)"],
                         env=env, capture_output=True, text=True, check=True, cwd=ROOT)
    assert out.stdout.strip() == expected


def test_the_rate_is_the_probability_on_the_key(jev_probe, monkeypatch, goi_item):
    seen = []
    monkeypatch.setattr(jev, "choice_probabilities", _probabilities_for_key(0.62, seen))
    res = difficulty.measure(goi_item)
    assert res.measured and res.rate == pytest.approx(0.62)
    assert res.model == JEV and f"({JEV})" in res.detail()
    assert len(seen) == 1, "one call, whatever DIFFICULTY_TRIALS says"
    assert len(res.trials) == 1 and res.trials[0].side == difficulty.SIDE
    assert res.trials[0].correct, "the most likely option was the key"


def test_jev_sits_the_full_view_like_the_probe_it_replaces(jev_probe, monkeypatch, goi_item):
    seen = []
    monkeypatch.setattr(jev, "choice_probabilities", _probabilities_for_key(0.4, seen))
    difficulty.measure(goi_item)
    (_model, question), = seen
    assert goi_item["stem"] in question and "withheld" not in question


def test_a_low_probability_on_the_key_is_recorded_as_a_miss(jev_probe, monkeypatch, goi_item):
    monkeypatch.setattr(jev, "choice_probabilities", _probabilities_for_key(0.1))
    res = difficulty.measure(goi_item)
    assert res.rate == pytest.approx(0.1)
    assert res.trials[0].correct is False and res.trials[0].chosen is not None


def test_a_failed_call_is_unmeasured_never_a_rate(jev_probe, monkeypatch, goi_item):
    def down(*a, **k):
        raise llm.LLMError("unreachable")
    monkeypatch.setattr(jev, "choice_probabilities", down)
    res = difficulty.measure(goi_item)
    assert res.measured is False and res.rate is None
    assert res.detail() == "difficulty=unmeasured"
    # The backfill's "cannot be reached" count reads exactly this.
    assert [t.chosen for t in res.trials] == [None]


def test_calls_per_item(monkeypatch):
    monkeypatch.setattr("bjt.config.DIFFICULTY_TRIALS", 5)
    monkeypatch.setattr("bjt.config.DIFFICULTY_MODEL", "claude-haiku-4-5")
    assert difficulty.calls_per_item() == 5
    assert difficulty.calls_per_item(JEV) == 1


def test_a_kept_item_ships_with_jevs_probability(store, jev_probe, monkeypatch):
    """The whole path to a bundle: the gate on the judge, then the probe on Jev."""
    monkeypatch.setattr("bjt.config.SANITY_ENABLED", False)
    monkeypatch.setattr("bjt.generators.base.llm.generate_structured",
                        lambda *a, **k: copy.deepcopy(fixtures.FIXTURES["goi_bunpou"]))

    def judge(question, options, model=None):
        ci = options.index(_correct_text())
        return {"choice": (ci + 1) % 4 if "withheld" in question else ci, "reason": "x"}

    monkeypatch.setattr(answerability.llm, "answer_choice", judge)
    monkeypatch.setattr(jev, "choice_probabilities", _probabilities_for_key(0.55))

    item, iid, kept, detail, _ = pipeline.generate_and_gate(store, "goi_bunpou", "J2", gate=True)
    assert kept
    assert item["model_p_correct"] == pytest.approx(0.55)
    assert f"difficulty=55% ({JEV})" in detail


# ----- the comparison ------------------------------------------------------------

SHELVES = ("hyougen_J3_001.json", "sougou_dokkai_J1_001.json")


@pytest.fixture
def bank(tmp_path, monkeypatch):
    d = tmp_path / "batches"
    d.mkdir()
    for name in SHELVES:
        (d / name).write_bytes((ROOT / "batches" / name).read_bytes())
    (d / withdrawn.LEDGER_NAME).write_text("# nothing withdrawn\n", encoding="utf-8")
    monkeypatch.setattr("bjt.config.BATCH_DIR", d)
    monkeypatch.setattr("bjt.config.DIFFICULTY_ENABLED", True)
    monkeypatch.setattr("bjt.config.DIFFICULTY_MODEL", "claude-haiku-4-5")
    monkeypatch.setattr("bjt.config.DIFFICULTY_TRIALS", 5)
    monkeypatch.setattr(llm, "spend", llm.Spend())
    return d


def _snapshot(d):
    return {p.name: p.read_bytes() for p in sorted(d.iterdir())}


def _measure_by_model(rates, seen):
    """difficulty.measure's stand-in: a fixed rate per model, in turn."""
    streams = {m: iter(r) for m, r in rates.items()}

    def measure(item, model=None):
        seen.append(model)
        rate = next(streams[model])
        if rate is None:
            return difficulty.DifficultyResult(model=model, trials=[
                answerability.Trial(side="difficulty", trial=0, chosen=None, correct=False)])
        return difficulty.DifficultyResult(rate=rate, model=model, measured=True, trials=[
            answerability.Trial(side="difficulty", trial=0, chosen=0, correct=rate >= 0.5)])
    return measure


def test_spearman():
    assert backfill.spearman([0.1, 0.2, 0.3, 0.4], [0.2, 0.4, 0.6, 0.9]) == pytest.approx(1.0)
    assert backfill.spearman([0.1, 0.2, 0.3], [0.9, 0.5, 0.1]) == pytest.approx(-1.0)
    assert backfill.spearman([1.0, 1.0, 0.6, 0.2], [0.9, 0.8, 0.5, 0.1]) == pytest.approx(0.9486833)
    assert backfill.spearman([1.0, 1.0, 1.0], [0.1, 0.5, 0.9]) is None, "no order on one side"
    assert backfill.spearman([0.1, 0.2], [0.1, 0.2]) is None, "too few to mean anything"


def test_the_sample_takes_a_type_at_a_time(bank):
    got = backfill.sample(batch.bundles(), 3)
    assert [it["item_type"] for it in got] == ["hyougen", "sougou_dokkai", "hyougen"]
    assert len(backfill.sample(batch.bundles(), 100)) == 4


def test_a_comparison_writes_nothing(bank, monkeypatch, tmp_path):
    before = _snapshot(bank)
    seen = []
    monkeypatch.setattr(difficulty, "measure", _measure_by_model(
        {"claude-haiku-4-5": [1.0, 0.6, 0.8, 0.2], JEV: [0.9, 0.4, 0.7, 0.3]}, seen))
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    summary = tmp_path / "s.md"

    assert cli.main(["probe", "--all", "--compare", JEV, "--summary", str(summary)]) == 0
    assert _snapshot(bank) == before
    assert seen == [JEV, "claude-haiku-4-5"] * 4, "the candidate first on every item"
    text = summary.read_text(encoding="utf-8")
    assert f"| item | type | claude-haiku-4-5 | {JEV} |" in text
    assert "rank agreement (Spearman) over the 4 item(s) both measured: +1.00" in text
    assert "Nothing was written" in text


def test_an_unreachable_candidate_costs_no_baseline_calls_and_stops(bank, monkeypatch):
    seen = []
    monkeypatch.setattr(difficulty, "measure",
                        _measure_by_model({JEV: [None] * 4, "claude-haiku-4-5": []}, seen))
    cmp = backfill.compare_bank(batch.bundles(), JEV, limit=4, log=lambda *a: None)
    assert seen == [JEV] * backfill.UNREACHABLE_PATIENCE
    assert cmp.stopped and "could not be reached" in cmp.stopped
    assert all(not b.measured for _, _, b, _ in cmp.rows)


def test_a_comparison_stops_at_the_ceiling(bank, monkeypatch):
    seen = []
    monkeypatch.setattr(difficulty, "measure", _measure_by_model(
        {"claude-haiku-4-5": [1.0] * 4, JEV: [0.5] * 4}, seen))
    monkeypatch.setattr("bjt.config.RUN_MAX_CALLS", 0)
    cmp = backfill.compare_bank(batch.bundles(), JEV, log=lambda *a: None)
    assert seen == [] and cmp.rows == [] and "ceiling" in cmp.stopped


def test_compare_dry_run_counts_both_instruments_and_spends_nothing(bank, monkeypatch, capsys):
    def explode(*a, **k):
        raise AssertionError("--dry-run must not reach the model")
    monkeypatch.setattr(difficulty, "measure", explode)
    assert cli.main(["probe", "--all", "--compare", JEV, "--dry-run", "--limit", "3"]) == 0
    out = capsys.readouterr().out
    assert out.count("would compare on") == 3
    assert "18 call(s) in all, 5 per item to claude-haiku-4-5 and 1 to jev-latest" in out
    assert "does not resume" in out


def test_compare_refuses_what_cannot_mean_anything(bank, monkeypatch, capsys):
    def explode(*a, **k):
        raise AssertionError("nothing may be measured")
    monkeypatch.setattr(difficulty, "measure", explode)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)

    assert cli.main(["probe", "--all", "--compare", "claude-haiku-4-5"]) == 2
    assert cli.main(["probe", "--all", "--limit", "3"]) == 2
    assert cli.main(["probe", "--all", "--compare", JEV, "--limit", "0"]) == 2
    assert cli.main(["probe", "--all", "--compare", JEV]) == 1
    assert "TYPESAFE_API_KEY" in capsys.readouterr().err
