"""Every request is counted, and every request passes the ceilings first.

The SDK used to retry on its own: a request it retried was invisible to the
call ceiling, a request that ended in an exception never reached the count at
all, and a request that timed out — which the server may have finished and
billed — was never priced. The SDK now retries nothing; `llm._structured`
retries the same number of times, each attempt through `begin_request`.
"""
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from bjt import config, jev, llm

_REQUEST = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def _status(code: int, retry_after: "str | None" = None):
    headers = {"retry-after": retry_after} if retry_after else {}
    return anthropic.APIStatusError(f"Error code: {code}", body=None,
                                    response=httpx2.Response(code, request=_REQUEST, headers=headers))


def _ok():
    return SimpleNamespace(
        stop_reason="end_turn", stop_details=None,
        content=[SimpleNamespace(type="text", text='{"choice": 0, "reason": "x"}')],
        usage=SimpleNamespace(input_tokens=1000, output_tokens=200))


@pytest.fixture
def ledger(monkeypatch):
    fresh = llm.Spend()
    monkeypatch.setattr(llm, "spend", fresh)
    return fresh


@pytest.fixture
def waits(monkeypatch):
    slept = []
    monkeypatch.setattr(llm, "_sleep", slept.append)
    return slept


def _client(monkeypatch, replies):
    """A client that raises or returns each of `replies` in turn."""
    sent = []

    class Client:
        class messages:
            @staticmethod
            def create(**kw):
                sent.append(kw)
                reply = replies[min(len(sent), len(replies)) - 1]
                if isinstance(reply, BaseException):
                    raise reply
                return reply

    monkeypatch.setattr(llm, "_get_client", lambda: Client())
    return sent


def test_a_transient_failure_is_retried_and_every_attempt_counted(ledger, waits, monkeypatch):
    monkeypatch.setattr(config, "API_MAX_RETRIES", 2)
    sent = _client(monkeypatch, [_status(529), anthropic.APIConnectionError(request=_REQUEST), _ok()])
    assert llm.answer_choice("q", ["a", "b"], model="claude-sonnet-5")["choice"] == 0
    assert len(sent) == 3
    assert ledger.attempts == 3, "every request sent is on the count"
    assert ledger.calls == 1, "one response was priced"
    assert len(waits) == 2


def test_the_retry_budget_is_the_configured_one(ledger, waits, monkeypatch):
    monkeypatch.setattr(config, "API_MAX_RETRIES", 2)
    sent = _client(monkeypatch, [_status(503)])
    with pytest.raises(llm.LLMError):
        llm.answer_choice("q", ["a"], model="claude-sonnet-5")
    assert len(sent) == 3 and ledger.attempts == 3


def test_a_request_that_can_never_succeed_is_not_retried(ledger, waits, monkeypatch):
    sent = _client(monkeypatch, [_status(400)])
    with pytest.raises(llm.LLMError):
        llm.answer_choice("q", ["a"], model="claude-sonnet-5")
    assert len(sent) == 1 and waits == []


def test_an_empty_account_is_not_retried(ledger, waits, monkeypatch):
    broke = anthropic.APIStatusError(
        "Your credit balance is too low to access the Anthropic API.", body=None,
        response=httpx2.Response(400, request=_REQUEST))
    sent = _client(monkeypatch, [broke])
    with pytest.raises(llm.LLMBillingError):
        llm.answer_choice("q", ["a"], model="claude-sonnet-5")
    assert len(sent) == 1


def test_the_call_ceiling_counts_requests_not_responses(ledger, waits, monkeypatch):
    """Two failed requests are two requests: the third is refused before it
    is sent, retry or not."""
    monkeypatch.setattr(config, "RUN_MAX_CALLS", 2)
    monkeypatch.setattr(config, "API_MAX_RETRIES", 5)
    sent = _client(monkeypatch, [_status(529)])
    with pytest.raises(llm.LLMSpendLimitError) as err:
        llm.answer_choice("q", ["a"], model="claude-sonnet-5")
    assert len(sent) == 2
    assert "call ceiling" in str(err.value)


def test_every_retry_passes_the_ceilings_first(ledger, waits, monkeypatch):
    """The minute ceiling reached while waiting to retry stops the retry."""
    monkeypatch.setattr(config, "RUN_MAX_MINUTES", 30)

    def later(seconds):
        ledger.started -= 31 * 60

    monkeypatch.setattr(llm, "_sleep", later)
    sent = _client(monkeypatch, [_status(529), _ok()])
    with pytest.raises(llm.LLMSpendLimitError):
        llm.answer_choice("q", ["a"], model="claude-sonnet-5")
    assert len(sent) == 1


def test_a_timed_out_request_is_priced_at_its_ceiling(ledger, waits, monkeypatch):
    monkeypatch.setattr(config, "API_MAX_RETRIES", 0)
    _client(monkeypatch, [anthropic.APITimeoutError(request=_REQUEST)])
    with pytest.raises(llm.LLMError):
        llm.answer_choice("q" * 100, ["a"], model="claude-sonnet-5")
    assert ledger.calls == 1
    assert ledger.output_tokens == 1500, "answer_choice's whole output ceiling"
    assert ledger.usd >= 1500 * 10 / 1_000_000


def test_the_servers_retry_after_is_honoured_when_short(ledger, waits, monkeypatch):
    monkeypatch.setattr(config, "API_MAX_RETRIES", 1)
    _client(monkeypatch, [_status(429, retry_after="3"), _ok()])
    llm.answer_choice("q", ["a"], model="claude-sonnet-5")
    assert waits == [3.0]


def test_a_jev_request_is_counted_before_it_is_sent(ledger, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")
    monkeypatch.setattr(jev, "_post", lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
    with pytest.raises(llm.LLMError):
        jev.choice_probabilities("q", ["a", "b"], model="jev-latest")
    assert ledger.attempts == 1 and ledger.calls == 0


# ----- what counts as a failed call ------------------------------------------

def test_a_request_this_sdk_cannot_make_is_a_crash_not_an_outage(ledger, waits, monkeypatch):
    """An SDK too old for output_config raises a TypeError on every call.
    Wrapped as an LLMError it read as an outage, and every tolerant call site
    (the proofreader, the probe) turned a broken run into a quiet one."""
    _client(monkeypatch, [TypeError("Messages.create() got an unexpected keyword argument "
                                    "'output_config'")])
    with pytest.raises(TypeError):
        llm.answer_choice("q", ["a"], model="claude-sonnet-5")
    assert waits == []


def test_no_credentials_is_a_failed_call(ledger, waits, monkeypatch):
    """The SDK reports a missing key as a TypeError too; that one is an
    outage, so a probe without a key reports unmeasured as documented."""
    _client(monkeypatch, [TypeError('"Could not resolve authentication method. Expected one of '
                                    'api_key, auth_token, or credentials to be set."')])
    with pytest.raises(llm.LLMError):
        llm.answer_choice("q", ["a"], model="claude-sonnet-5")
