"""The ceilings: what stops a broken night from being an expensive one.

Each one is independent of the others on purpose. The morning of 2026-09-18
two manual runs spent twenty-six dollars in three hours, most of it on a bug
that made every document draft cost three attempts, and then lost what they
had written. A dollar ceiling measured from real usage, a call ceiling that
needs no price table, a cap on output and effort per call, a cap on the
night's size, and a bill in every summary — a bug in any one of them is
caught by the rest.
"""
import copy
import pathlib
from types import SimpleNamespace

import pytest
import yaml

from bjt import cli, config, fixtures, llm


def _usage(**kw):
    return SimpleNamespace(**kw)


@pytest.fixture
def ledger(monkeypatch):
    fresh = llm.Spend()
    monkeypatch.setattr(llm, "spend", fresh)
    return fresh


@pytest.fixture
def answers(monkeypatch):
    """A client whose every reply is a small, well-formed structured answer,
    reporting a usage. Returns the list of requests it saw."""
    seen = []

    class Client:
        class messages:
            @staticmethod
            def create(**kw):
                seen.append(kw)
                return SimpleNamespace(
                    stop_reason="end_turn", stop_details=None,
                    content=[SimpleNamespace(type="text", text='{"choice": 0, "reason": "x"}')],
                    usage=_usage(input_tokens=1000, output_tokens=200,
                                 cache_creation_input_tokens=0, cache_read_input_tokens=0),
                )

    monkeypatch.setattr(llm, "_get_client", lambda: Client())
    return seen


# ----- pricing -----------------------------------------------------------

def test_a_response_is_priced_from_its_usage():
    u = _usage(input_tokens=1_000_000, output_tokens=1_000_000,
               cache_creation_input_tokens=0, cache_read_input_tokens=0)
    assert llm.price_usd("claude-opus-5", u) == pytest.approx(30.0)
    assert llm.price_usd("claude-sonnet-5", u) == pytest.approx(12.0)
    assert llm.price_usd("claude-haiku-4-5", u) == pytest.approx(6.0)


def test_cache_writes_and_reads_are_priced_as_the_list_has_them():
    u = _usage(input_tokens=0, output_tokens=0,
               cache_creation_input_tokens=1_000_000, cache_read_input_tokens=1_000_000)
    # Sonnet: $2 input → $2.50 to write a million, $0.20 to read a million.
    assert llm.price_usd("claude-sonnet-5", u) == pytest.approx(2.70)


def test_an_unknown_model_is_priced_as_the_dearest_known():
    u = _usage(input_tokens=1_000_000, output_tokens=1_000_000)
    assert llm.price_usd("claude-something-new", u) == pytest.approx(30.0)


def test_a_usage_with_missing_fields_still_prices():
    assert llm.price_usd("claude-opus-5", _usage(output_tokens=None)) == 0.0
    assert llm.price_usd("claude-opus-5", None) == 0.0


# ----- the ledger ---------------------------------------------------------

def test_every_call_is_added_to_the_ledger(ledger, answers):
    llm.answer_choice("q", ["a", "b"], model="claude-opus-5")
    llm.answer_choice("q", ["a", "b"], model="claude-haiku-4-5")
    assert ledger.calls == 2
    assert ledger.input_tokens == 2000 and ledger.output_tokens == 400
    assert ledger.usd == pytest.approx(0.005 + 0.005 + 0.001 + 0.001)
    assert set(ledger.calls_by_model) == {"claude-opus-5", "claude-haiku-4-5"}
    assert "claude-opus-5" in ledger.report() and "$0.01" in ledger.report()


def test_the_dollar_ceiling_stops_the_next_call_not_the_last(ledger, answers, monkeypatch):
    # Each Opus call above costs one cent; a ceiling of 2.5 cents allows
    # three (the third crosses it) and refuses the fourth before it is made.
    monkeypatch.setattr("bjt.config.RUN_BUDGET_USD", 0.025)
    for _ in range(3):
        llm.answer_choice("q", ["a", "b"], model="claude-opus-5")
    with pytest.raises(llm.LLMSpendLimitError) as err:
        llm.answer_choice("q", ["a", "b"], model="claude-opus-5")
    assert len(answers) == 3, "the refused call never reached the API"
    assert "spend ceiling" in str(err.value) and "BJT_RUN_BUDGET_USD" in str(err.value)


def test_the_call_ceiling_needs_no_price_table(ledger, answers, monkeypatch):
    monkeypatch.setattr("bjt.config.RUN_MAX_CALLS", 2)
    monkeypatch.setattr("bjt.config.RUN_BUDGET_USD", 1000.0)
    llm.answer_choice("q", ["a"], model="claude-opus-5")
    llm.answer_choice("q", ["a"], model="claude-opus-5")
    with pytest.raises(llm.LLMSpendLimitError) as err:
        llm.answer_choice("q", ["a"], model="claude-opus-5")
    assert len(answers) == 2 and "call ceiling" in str(err.value)


def test_a_paid_for_refusal_is_still_on_the_bill(ledger, monkeypatch):
    class Client:
        class messages:
            @staticmethod
            def create(**kw):
                return SimpleNamespace(stop_reason="refusal", stop_details="no", content=[],
                                       usage=_usage(input_tokens=500, output_tokens=0))

    monkeypatch.setattr(llm, "_get_client", lambda: Client())
    with pytest.raises(llm.LLMError):
        llm.answer_choice("q", ["a"], model="claude-opus-5")
    assert ledger.calls == 1 and ledger.usd == pytest.approx(0.0025)


def test_the_spend_limit_is_a_billing_error_so_the_run_stops(store, monkeypatch):
    """The nightly loop and run_batch already stop for an empty account; the
    ceiling reuses that path rather than adding a second one to forget."""
    assert issubclass(llm.LLMSpendLimitError, llm.LLMBillingError)
    calls = []

    def over(*a, **k):
        calls.append(1)
        raise llm.LLMSpendLimitError("spend ceiling reached")

    monkeypatch.setattr("bjt.generators.base.llm.generate_structured", over)
    monkeypatch.setattr("bjt.config.SANITY_ENABLED", False)
    with pytest.raises(llm.LLMBillingError):
        cli.run_batch(store, "goi_bunpou", "J2", 4, gate=False, sanity_check=False)
    assert len(calls) == 1


# ----- per call -----------------------------------------------------------

def test_no_call_may_ask_for_more_output_than_the_ceiling(monkeypatch):
    monkeypatch.setattr("bjt.config.MAX_TOKENS_CEILING", 4000)
    p = llm.request_params("claude-sonnet-5", "s", "u", {"type": "object"},
                           max_tokens=64000, effort="medium")
    assert p["max_tokens"] == 4000
    p = llm.request_params("claude-sonnet-5", "s", "u", {"type": "object"},
                           max_tokens=1200, effort="medium")
    assert p["max_tokens"] == 1200


def test_no_generation_may_think_harder_than_the_ceiling(monkeypatch):
    monkeypatch.setattr("bjt.config.EFFORT_CEILING", "high")
    for asked, got in (("low", "low"), ("high", "high"), ("xhigh", "high"), ("max", "high")):
        p = llm.request_params("claude-opus-5", "s", "u", {"type": "object"},
                               max_tokens=100, effort=asked)
        assert p["output_config"]["effort"] == got, asked
    monkeypatch.setattr("bjt.config.EFFORT_CEILING", "medium")
    assert llm.clamp_effort("high") == "medium"
    assert llm.clamp_effort("nonsense") == "medium"


def test_the_generator_env_cannot_lift_the_effort_ceiling(monkeypatch):
    seen = {}

    class Client:
        class messages:
            @staticmethod
            def create(**kw):
                seen.update(kw)
                raise RuntimeError("stop here")

    monkeypatch.setattr(llm, "_get_client", lambda: Client())
    monkeypatch.setattr("bjt.config.GEN_EFFORT", "max")     # as BJT_GEN_EFFORT=max would
    monkeypatch.setattr("bjt.config.EFFORT_CEILING", "high")
    with pytest.raises(llm.LLMError):
        llm.generate_structured("s", "u", {"type": "object"})
    assert seen["output_config"]["effort"] == "high"
    assert seen["max_tokens"] <= config.MAX_TOKENS_CEILING


# ----- per night ----------------------------------------------------------

def test_the_night_is_clamped_to_its_ceiling(monkeypatch, capsys):
    monkeypatch.setattr("bjt.config.NIGHT_MAX_BUDGET", 24)
    monkeypatch.setattr("bjt.config.NIGHT_MAX_PER_SLOT", 6)
    assert cli.clamp_night(12, 4) == (12, 4)
    assert cli.clamp_night(99, 99) == (24, 6)
    assert cli.clamp_night(-3, 0) == (0, 0)
    assert "clamped" in capsys.readouterr().err


def test_the_summary_carries_the_bill(ledger):
    ledger.add("claude-sonnet-5", _usage(input_tokens=100_000, output_tokens=10_000))
    text = cli._nightly_summary([], ["x: y"], spend=ledger)
    assert "What tonight cost" in text
    assert "$0.30" in text and "claude-sonnet-5" in text


def test_the_time_ceiling_stops_the_next_call(ledger, answers, monkeypatch):
    monkeypatch.setattr("bjt.config.RUN_MAX_MINUTES", 30)
    llm.answer_choice("q", ["a"], model="claude-sonnet-5")
    ledger.started -= 31 * 60  # thirty-one minutes ago
    with pytest.raises(llm.LLMSpendLimitError) as err:
        llm.answer_choice("q", ["a"], model="claude-sonnet-5")
    assert len(answers) == 1 and "time ceiling" in str(err.value)


def test_the_client_has_a_timeout_and_few_retries(monkeypatch):
    seen = {}

    class FakeAnthropic:
        def __init__(self, **kw):
            seen.update(kw)

    import sys, types
    fake = types.ModuleType("anthropic"); fake.Anthropic = FakeAnthropic
    monkeypatch.setitem(sys.modules, "anthropic", fake)
    monkeypatch.setattr(llm, "_client", None)
    llm._get_client()
    assert seen == {"timeout": config.API_TIMEOUT_SECONDS, "max_retries": config.API_MAX_RETRIES}
    assert config.API_TIMEOUT_SECONDS <= 600 and config.API_MAX_RETRIES <= 2


def test_the_defaults_are_the_stated_ones():
    assert config.RUN_BUDGET_USD == 2.0
    assert config.RUN_MAX_CALLS == 500
    assert config.RUN_MAX_MINUTES == 30
    assert config.MAX_TOKENS_CEILING == 8000
    assert config.EFFORT_CEILING == "high"
    assert (config.NIGHT_MAX_BUDGET, config.NIGHT_MAX_PER_SLOT) == (24, 6)


# ----- the workflow -------------------------------------------------------

ROOT = pathlib.Path(__file__).resolve().parent.parent


def test_the_workflow_keeps_its_guards():
    """The guards that live in YAML rather than Python, asserted so that an
    edit to the workflow cannot drop one without a test noticing."""
    text = (ROOT / ".github/workflows/nightly.yml").read_text(encoding="utf-8")
    wf = yaml.safe_load(text)
    job = wf["jobs"]["nightly"]
    assert job["timeout-minutes"] <= 60, "a night is minutes, not hours"
    assert job["timeout-minutes"] > config.RUN_MAX_MINUTES, "the process stops itself first"
    assert "BJT_RUN_BUDGET_USD" in job["env"], "the dollar ceiling is set for the run"
    inputs = wf[True]["workflow_dispatch"]["inputs"]  # `on:` parses as True
    assert "max_usd" in inputs and "force" in inputs
    steps = {s.get("name"): s for s in job["steps"]}
    keep = steps["keep tonight's work whatever happens next"]
    assert keep["if"].startswith("always()"), "the artifact is saved even when a later step fails"
    assert "batches" in keep["with"]["path"]
    pr = steps["open a pull request for somebody to read"]["run"]
    assert "git rebase" in pr and "git fetch origin" in pr, "tonight's commit sits on today's main"
    unlocked = steps["which of tonight's work is unlocked"]["run"]
    assert "content/nightly-*" in unlocked, "one unreviewed night at a time"
