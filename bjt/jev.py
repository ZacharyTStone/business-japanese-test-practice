"""Jev, TypeSafe AI's decision model, as an instrument for the difficulty probe.

A prototype, used only when `BJT_DIFFICULTY_MODEL` names it (`jev-latest`).

Jev writes no text. It is given a state and a question whose answers we name,
and it returns a probability for every answer. That is exactly the difficulty
probe's question — which of these four is right? — with a better-shaped reply:
the probe otherwise asks a small model five times and counts, so its rate can
only be 0, 0.2 … 1.0, while one Jev call gives the probability it puts on the key.

It is kept to the probe on purpose. The gate, the proofreader, the dedupe check
and the discriminator each owe the next draft a sentence saying why, and Jev
has no sentences to give; the gate also wants a strong reader, and Jev is built
to be fast. And like every model here it runs in the batch job and never while
somebody is practising.

**The request and the reply.** The shape below is TypeSafe's published
example, and the live service answers in it: the first comparison run sent 20
questions and got 20 well-formed replies.

    POST {config.JEV_URL}   Authorization: Bearer $TYPESAFE_API_KEY
    {"model": "jev-latest", "state": "...",
     "questions": {"answer": {"type": "choice", "instructions": "...",
                              "criteria": {"option_1": "...", ...}}}}
    → {"model": "jev-1.13.0",
       "answers": {"answer": {"type": "choice", "choice": "option_1",
                              "probabilities": {"option_1": 0.88, ...},
                              "confidence": 0.81}},
       "usage": {"input_tokens": 318, "output_tokens": 34}}

So every departure from that shape is an `LLMError`, which the probe reports as
unmeasured and never as a rate.

**The same ceilings as every other call.** `llm.spend.check_ceilings()` runs
before the request and the reply is priced into `llm.spend` after it, so a run
that mixes Jev with the Anthropic models has one bill and one set of limits.
Jev bills $0.042 per million input tokens and nothing for output (TypeSafe's
usage page), which is its row in `llm.PRICES_USD_PER_MTOK`. A question is about
700 tokens, so a call costs about $0.00003 and rating the whole bank costs well
under a cent: the first comparison was 20 calls, 14,040 tokens and $0.0005.
A reply that reports no usage is priced on the request's size in bytes, which
is more than its size in tokens. The output and effort ceilings have nothing to
cap: Jev neither writes nor thinks at length.
"""
from __future__ import annotations

import json
import math
import os
import urllib.error
import urllib.request
from types import SimpleNamespace
from typing import Optional

from . import config, llm

#: The name the one question is sent under, and read back from.
QUESTION = "answer"

INSTRUCTIONS = (
    "The state is a question from a business-Japanese proficiency test, with "
    "everything the candidate sees or hears. Which option is the correct answer?"
)


def is_jev(model: str) -> bool:
    return model.startswith("jev")


def option_keys(n: int) -> list[str]:
    return [f"option_{i + 1}" for i in range(n)]


def request_body(question: str, options: list[str], model: str) -> dict:
    keys = option_keys(len(options))
    return {
        "model": model,
        "state": question,
        "questions": {QUESTION: {
            "type": "choice",
            "instructions": INSTRUCTIONS,
            "criteria": dict(zip(keys, options)),
        }},
    }


def probabilities(reply: dict, n: int) -> list[float]:
    """The reply's probability for each of our `n` options, in option order.

    Renormalised over our options, so a reply that also names an answer we did
    not offer (TypeSafe's own example does) still reads as a distribution over
    ours. Anything that is not a finite, non-negative number for every option
    we sent is an error rather than a guess.
    """
    try:
        probs = reply["answers"][QUESTION]["probabilities"]
        raw = [probs[k] for k in option_keys(n)]
    except (KeyError, TypeError) as e:
        raise llm.LLMError(f"Jev reply has no probability for every option: {e!r}") from e
    if not all(isinstance(p, (int, float)) and not isinstance(p, bool)
               and math.isfinite(p) and p >= 0 for p in raw):
        raise llm.LLMError(f"Jev reply has a probability that is not one: {raw!r}")
    total = sum(raw)
    if total <= 0:
        raise llm.LLMError("Jev reply puts no probability on any option we sent")
    return [p / total for p in raw]


def usage_of(reply: dict, sent: bytes) -> SimpleNamespace:
    """What the ledger prices, in the shape `llm.price_usd` reads."""
    usage = reply.get("usage") if isinstance(reply, dict) else None
    tokens_in = usage.get("input_tokens") if isinstance(usage, dict) else None
    if not isinstance(tokens_in, int) or isinstance(tokens_in, bool) or tokens_in < 0:
        return SimpleNamespace(input_tokens=len(sent), output_tokens=0)
    tokens_out = usage.get("output_tokens")
    if not isinstance(tokens_out, int) or isinstance(tokens_out, bool) or tokens_out < 0:
        tokens_out = 0
    return SimpleNamespace(input_tokens=tokens_in, output_tokens=tokens_out)


def _post(url: str, data: bytes, headers: dict[str, str], timeout: float) -> bytes:
    """One request, the reply's body. The seam the tests replace."""
    req = urllib.request.Request(url, data=data, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def choice_probabilities(question: str, options: list[str],
                         model: Optional[str] = None) -> list[float]:
    """Ask Jev which option is right; its probability for each, in order."""
    model = model or config.DIFFICULTY_MODEL
    # Before the call, never after, as in llm._structured.
    llm.spend.check_ceilings()
    key = os.environ.get("TYPESAFE_API_KEY", "")
    if not key:
        raise llm.LLMError("TYPESAFE_API_KEY is not set")
    data = json.dumps(request_body(question, options, model), ensure_ascii=False).encode("utf-8")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    try:
        body = _post(config.JEV_URL, data, headers, config.API_TIMEOUT_SECONDS)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        if e.code == 402 or any(sign in detail.lower() for sign in llm._BILLING_SIGNS):
            raise llm.LLMBillingError(f"Jev request failed: HTTP {e.code}: {detail}") from e
        raise llm.LLMError(f"Jev request failed: HTTP {e.code}: {detail}") from e
    except (urllib.error.URLError, OSError) as e:
        raise llm.LLMError(f"Jev request failed: {e}") from e

    try:
        reply = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        # Paid for all the same, so on the bill before the error.
        llm.spend.add(model, usage_of({}, data))
        raise llm.LLMError(f"Jev reply was not JSON: {e}") from e
    llm.spend.add(model, usage_of(reply, data))
    return probabilities(reply, len(options))
