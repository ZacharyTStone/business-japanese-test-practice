"""The test suite's own guard: no test reaches a vendor.

`tests/conftest.py` strips every credential from the environment and replaces
each network seam with one that fails the test. These hold it to that, so the
guard cannot be edited away without a test noticing.
"""
import os

import pytest

from bjt import http, jev, llm, r2, scene_art
from bjt.tts import providers

from conftest import UnmockedCall


def test_no_credential_reaches_a_test(monkeypatch):
    live = [k for k in os.environ
            if k.startswith(("ANTHROPIC_", "OPENAI_", "TYPESAFE_", "R2_", "CLOUDFLARE_"))]
    assert live == []


@pytest.mark.parametrize("call", [
    lambda: llm.answer_choice("q", ["a", "b"]),
    lambda: http.request("GET", "https://example.invalid"),
    lambda: providers._post("https://example.invalid", {}, {}),
    lambda: scene_art.Bucket(creds=r2.Credentials("acct", "k", "s")).list(),
    lambda: jev.choice_probabilities("q", ["a", "b"], model="jev-latest"),
])
def test_an_unfaked_call_fails_the_test_rather_than_the_item(call, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "k")  # so Jev gets as far as the wire
    """An AssertionError, not an LLMError: a tolerant call site would turn the
    latter into "did not run" and the test would pass on it."""
    with pytest.raises(UnmockedCall):
        call()
    assert not issubclass(UnmockedCall, llm.LLMError)
