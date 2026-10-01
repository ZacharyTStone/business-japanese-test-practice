"""One job, one budget, one clock: `BJT_SPEND_LEDGER`.

The nightly job runs `bjt nightly` and then `bjt scenes`, two processes, and
each used to start with its own fifty cents and its own half-hour. With the
ledger set, the second starts where the first stopped.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from bjt import config, http, jev, llm

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def shared(tmp_path, monkeypatch):
    path = tmp_path / "night" / "spend.json"
    monkeypatch.setenv(llm.LEDGER_ENV, str(path))
    return path


def _usage(i=100_000, o=10_000):
    return SimpleNamespace(input_tokens=i, output_tokens=o)


def test_the_second_process_starts_where_the_first_stopped(shared, monkeypatch):
    first = llm.Spend.from_environment()
    first.begin_request()
    first.add("claude-sonnet-5", _usage())
    assert json.loads(shared.read_text()) == {
        "usd": pytest.approx(0.3), "calls": 1, "attempts": 1, "started_at": first.started}

    second = llm.Spend.from_environment()  # what a fresh process builds at import
    assert (second.usd, second.calls, second.attempts) == (pytest.approx(0.3), 1, 1)
    assert second.started == first.started, "one clock for the job"
    assert "earlier steps of this job" in second.report()

    monkeypatch.setattr(config, "RUN_BUDGET_USD", 0.25)
    with pytest.raises(llm.LLMSpendLimitError, match="spend ceiling"):
        second.check_ceilings()


def test_the_clock_is_the_jobs_not_the_process(shared, monkeypatch):
    monkeypatch.setattr(config, "RUN_MAX_MINUTES", 30)
    first = llm.Spend.from_environment()
    first.started = time.time() - 31 * 60
    first.save()
    with pytest.raises(llm.LLMSpendLimitError, match="time ceiling"):
        llm.Spend.from_environment().check_ceilings()


def test_the_call_ceiling_is_shared(shared, monkeypatch):
    monkeypatch.setattr(config, "RUN_MAX_CALLS", 2)
    first = llm.Spend.from_environment()
    first.begin_request()
    first.begin_request()
    with pytest.raises(llm.LLMSpendLimitError, match="call ceiling"):
        llm.Spend.from_environment().begin_request()


def test_an_unreadable_ledger_spends_nothing(shared):
    shared.parent.mkdir(parents=True)
    shared.write_text("{not json", encoding="utf-8")
    spend = llm.Spend.from_environment()
    with pytest.raises(llm.LLMSpendLimitError, match="cannot be read"):
        spend.begin_request()
    assert shared.read_text() == "{not json", "an unreadable ledger is left for a person"


@pytest.mark.parametrize("body", ['{"usd": -1, "calls": 0, "attempts": 0, "started_at": 1}',
                                  '{"usd": 0.1, "calls": 0}',
                                  '{"usd": NaN, "calls": 0, "attempts": 0, "started_at": 1}'])
def test_a_ledger_with_a_wrong_number_is_unreadable(shared, body):
    shared.parent.mkdir(parents=True)
    shared.write_text(body, encoding="utf-8")
    with pytest.raises(llm.LLMSpendLimitError):
        llm.Spend.from_environment().check_ceilings()


def test_unset_is_a_process_on_its_own(tmp_path, monkeypatch):
    monkeypatch.delenv(llm.LEDGER_ENV, raising=False)
    spend = llm.Spend.from_environment()
    spend.begin_request()
    spend.add("claude-sonnet-5", _usage())
    assert spend.ledger is None
    assert list(tmp_path.iterdir()) == []


def test_the_write_is_whole_or_nothing(shared):
    spend = llm.Spend.from_environment()
    for _ in range(5):
        spend.begin_request()
        spend.add("claude-haiku-4-5", _usage(10, 10))
    assert [p.name for p in shared.parent.iterdir()] == [shared.name], "no temp file left behind"
    assert json.loads(shared.read_text())["attempts"] == 5


def test_jev_is_held_to_the_shared_ledger(shared, monkeypatch):
    first = llm.Spend.from_environment()
    first.begin_request()
    first.add("claude-sonnet-5", _usage(1_000_000, 0))
    monkeypatch.setattr(config, "RUN_BUDGET_USD", 1.0)
    monkeypatch.setattr(llm, "spend", llm.Spend.from_environment())
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    posted = []
    monkeypatch.setattr(http, "request", lambda *a, **k: posted.append(a) or b"{}")
    with pytest.raises(llm.LLMSpendLimitError):
        jev.choice_probabilities("q", ["a", "b"], model="jev-latest")
    assert posted == []


def _run(code: str, ledger: Path) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("ANTHROPIC_", "OPENAI_", "TYPESAFE_", "R2_", "CLOUDFLARE_"))}
    env[llm.LEDGER_ENV] = str(ledger)
    env["BJT_RUN_BUDGET_USD"] = "0.5"
    return subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env,
                          capture_output=True, text=True, timeout=60)


def test_two_real_processes_share_one_night(tmp_path):
    """Two interpreters, as the workflow's two steps are: the first spends
    forty cents and exits; the second may not spend the other fifty."""
    ledger = tmp_path / "spend.json"
    first = _run(
        "from types import SimpleNamespace as N\n"
        "from bjt import llm\n"
        "llm.spend.begin_request()\n"
        "llm.spend.add('claude-sonnet-5', N(input_tokens=200_000, output_tokens=0))\n"
        "llm.spend.begin_request()\n"
        "llm.spend.add('claude-sonnet-5', N(input_tokens=0, output_tokens=0))\n", ledger)
    assert first.returncode == 0, first.stderr
    assert json.loads(ledger.read_text())["usd"] == pytest.approx(0.4)

    second = _run(
        "from types import SimpleNamespace as N\n"
        "from bjt import llm\n"
        "llm.spend.begin_request()\n"
        "llm.spend.add('claude-sonnet-5', N(input_tokens=100_000, output_tokens=0))\n"
        "try:\n"
        "    llm.spend.begin_request()\n"
        "except llm.LLMSpendLimitError as e:\n"
        "    print('stopped:', e)\n", ledger)
    assert second.returncode == 0, second.stderr
    assert "stopped: spend ceiling reached: $0.60 of $0.50" in second.stdout
    data = json.loads(ledger.read_text())
    assert data["calls"] == 3 and data["attempts"] == 3
