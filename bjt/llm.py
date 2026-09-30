"""Thin wrapper over the Anthropic Messages API.

Six call shapes are used across the tool:
  * generate_structured  — the generators, constrained to an item JSON schema
  * sanity_check         — the proofreader (one flag per rule, on a small model)
  * answer_choice        — the answerability gate / calibration (pick 1 of N)
  * judge_synthetic      — the discriminator loop (real vs synthetic + why)
  * answer_from_image    — the 画像把握 picture gate (pick 1 of N from a picture)
  * review_scene_image   — the scene art gate (one flag per rule in the brief)

All of them use structured output (`output_config.format`) so we never parse
free text. The SDK is imported lazily so the offline commands (selftest,
checkbatch) run with neither the package nor an API key present.
"""
from __future__ import annotations

import atexit
import json
import math
import os
import random
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Optional

from . import config

_client = None


class LLMError(RuntimeError):
    pass


class LLMBillingError(LLMError):
    """The account cannot pay for the call. Nothing else will succeed either.

    A run that meets this should stop, not carry on through forty more slots
    of the same refusal. Raised as its own class so the callers that tolerate
    a failed call (one shelf, one probe) can let this one through — and they
    must: it is an `LLMError`, so a bare `except LLMError` swallows it. Every
    tolerant catch site puts `except LLMBillingError: raise` first.
    """


_BILLING_SIGNS = ("credit balance", "insufficient_quota", "billing")


class LLMTruncatedError(LLMError):
    """The reply stopped at its token ceiling (or the model's context) before
    it was finished. Paid for, and not an answer: a judge's reply cut off
    mid-thought is a trial that got no answer, never a wrong one, and a draft
    cut off mid-item is a generation that failed. Its own class so the log
    says which, and so the ceiling that caused it can be looked at."""


#: stop_reason values that mean the reply was cut off rather than finished.
_TRUNCATED = ("max_tokens", "model_context_window_exceeded")


class LLMSpendLimitError(LLMBillingError):
    """This process has spent what it was allowed to. Raised *before* the
    call that would go over, so the ceiling is never crossed by more than one
    response. A subclass of the billing error on purpose: every caller that
    stops for an empty account stops for this too, keeping what it wrote."""


# ----- the spend ledger --------------------------------------------------
#
# Dollars per million tokens (input, output), by model name prefix, as each
# provider's price list has them; the longest prefix that matches wins, so
# `claude-opus-5-5` is not priced as `claude-opus-5` and `claude-sonnet-4-6`
# is not priced as the Sonnet 5 family. Cache writes cost a quarter more than
# plain input and cache reads a tenth of it (a few newer models read the cache
# for less; a tenth over-prices them, which is the safe side). A model not in
# the table is priced at UNKNOWN_MODEL_USD_PER_MTOK, dearer than anything in
# it: the ledger exists to stop a run, and a guess that is too low is the one
# kind of wrong it must not be.
PRICES_USD_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-fable-5-1": (10.0, 50.0),
    "claude-fable-5": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-4-7": (5.0, 25.0),
    "claude-opus-4-6": (5.0, 25.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "jev": (0.042, 0.0),  # TypeSafe AI bills input only (bjt/jev.py)
}
#: For a model the table does not name. Deliberately above every row.
UNKNOWN_MODEL_USD_PER_MTOK: tuple[float, float] = (15.0, 75.0)
CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.10


def rates_for(model: str) -> tuple[float, float]:
    """(input, output) dollars per million tokens: the longest matching
    prefix's row, or the unknown-model price."""
    matches = [prefix for prefix in PRICES_USD_PER_MTOK if model.startswith(prefix)]
    if not matches:
        return UNKNOWN_MODEL_USD_PER_MTOK
    return PRICES_USD_PER_MTOK[max(matches, key=len)]


def price_usd(model: str, usage: Any) -> float:
    """What one response cost, from the usage the API reports on it."""
    per_in, per_out = rates_for(model)
    get = lambda name: int(getattr(usage, name, None) or 0)  # noqa: E731
    plain = get("input_tokens")
    written = get("cache_creation_input_tokens")
    read = get("cache_read_input_tokens")
    out = get("output_tokens")
    return (
        plain * per_in
        + written * per_in * CACHE_WRITE_MULTIPLIER
        + read * per_in * CACHE_READ_MULTIPLIER
        + out * per_out
    ) / 1_000_000


@dataclass
class Spend:
    """Everything this process has spent on the API, priced as it went.

    One per process (`spend`, below). Anything that wants the bill for a run
    — the nightly summary, `bjt batch`'s last line — reads it; the ceilings in
    config are enforced against it before every call.

    Two counts, because they differ exactly when something goes wrong:
    `attempts` is every request sent, counted before it is sent — a retry, a
    request that timed out, one that failed — and it is what the call ceiling
    holds; `calls` is every response priced.

    **One job, one budget.** The nightly job runs `bjt nightly` and then `bjt
    scenes` as two processes, and each used to start with a fresh allowance
    and a fresh clock: two fifty-cent ceilings and two half-hours for one
    fifty-cent night. With `BJT_SPEND_LEDGER` naming a file, the process
    starts from what the file says was spent (dollars, calls, requests) and
    when (the clock's start), and writes its totals back after every request
    and every priced response and when it exits — atomically, so the next
    step never reads half a file. Everything that spends reads this one
    object (`llm.spend`): the Anthropic calls, Jev, and the picture job's
    image requests, so they share it too. A file that cannot be read is not
    an empty ledger: nothing is spent until it is fixed. Unset, a process has
    its own ceilings, as it always had.
    """
    calls: int = 0
    attempts: int = 0
    input_tokens: int = 0
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0
    output_tokens: int = 0
    usd: float = 0.0
    usd_by_model: dict[str, float] = field(default_factory=dict)
    calls_by_model: dict[str, int] = field(default_factory=dict)
    #: When the run's clock started, in epoch seconds: this process's start,
    #: or the first step of the job's when a ledger carries it.
    started: float = field(default_factory=time.time)
    #: The shared ledger file, or None for a process on its own.
    ledger: Optional[Path] = None
    #: What earlier steps of the job had spent when this one started.
    carried_usd: float = 0.0
    carried_calls: int = 0
    #: Why the ledger could not be read, when it could not. Checked before
    #: every request: an unreadable ledger spends nothing.
    ledger_error: Optional[str] = None

    @classmethod
    def from_environment(cls) -> "Spend":
        """The process's ledger: shared through `BJT_SPEND_LEDGER` when set."""
        raw = os.environ.get(LEDGER_ENV, "").strip()
        out = cls(ledger=Path(raw) if raw else None)
        out.load()
        return out

    def load(self) -> None:
        """Start from the shared ledger, if there is one and it exists."""
        if self.ledger is None or not self.ledger.exists():
            return
        try:
            data = json.loads(self.ledger.read_text(encoding="utf-8"))
            usd, calls = float(data["usd"]), int(data["calls"])
            attempts, started = int(data["attempts"]), float(data["started_at"])
            if not all(math.isfinite(x) and x >= 0 for x in (usd, calls, attempts, started)):
                raise ValueError("a negative or non-finite number")
        except (OSError, ValueError, TypeError, KeyError) as e:
            self.ledger_error = f"the spend ledger {self.ledger} cannot be read ({e!r})"
            return
        self.usd += usd
        self.calls += calls
        self.attempts += attempts
        self.started = min(self.started, started)
        self.carried_usd, self.carried_calls = usd, calls

    def save(self) -> None:
        """Write the totals to the shared ledger, whole or not at all."""
        if self.ledger is None or self.ledger_error is not None:
            return
        body = json.dumps({"usd": self.usd, "calls": self.calls,
                           "attempts": self.attempts, "started_at": self.started})
        self.ledger.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=self.ledger.name + ".", dir=self.ledger.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(body + "\n")
            os.replace(tmp, self.ledger)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    @property
    def minutes(self) -> float:
        return (time.time() - self.started) / 60

    def add(self, model: str, usage: Any) -> float:
        cost = price_usd(model, usage)
        get = lambda name: int(getattr(usage, name, None) or 0)  # noqa: E731
        self.calls += 1
        self.input_tokens += get("input_tokens")
        self.cache_write_tokens += get("cache_creation_input_tokens")
        self.cache_read_tokens += get("cache_read_input_tokens")
        self.output_tokens += get("output_tokens")
        self.usd += cost
        self.usd_by_model[model] = self.usd_by_model.get(model, 0.0) + cost
        self.calls_by_model[model] = self.calls_by_model.get(model, 0) + 1
        self.save()
        return cost

    def begin_request(self) -> None:
        """The ceilings, then one more request on the count. Called before
        every request any vendor is sent — each retry included — so the call
        ceiling counts what was asked for, not what came back."""
        self.check_ceilings()
        self.attempts += 1
        self.save()

    def check_ceilings(self) -> None:
        """Raise if the next call would be one too many. Called before it."""
        if self.ledger_error is not None:
            raise LLMSpendLimitError(
                f"{self.ledger_error}; nothing is spent without knowing what was "
                f"spent ({LEDGER_ENV})")
        if self.attempts >= config.RUN_MAX_CALLS:
            raise LLMSpendLimitError(
                f"call ceiling reached: {self.attempts} requests this run "
                f"(BJT_RUN_MAX_CALLS={config.RUN_MAX_CALLS}); ${self.usd:.2f} spent")
        if self.usd >= config.RUN_BUDGET_USD:
            raise LLMSpendLimitError(
                f"spend ceiling reached: ${self.usd:.2f} of "
                f"${config.RUN_BUDGET_USD:.2f} (BJT_RUN_BUDGET_USD) "
                f"in {self.calls} calls")
        if self.minutes >= config.RUN_MAX_MINUTES:
            raise LLMSpendLimitError(
                f"time ceiling reached: {self.minutes:.0f} minutes this run "
                f"(BJT_RUN_MAX_MINUTES={config.RUN_MAX_MINUTES:g}); "
                f"${self.usd:.2f} spent in {self.calls} calls")

    def report(self) -> str:
        """The bill, as a few lines for a summary."""
        lines = [
            f"Spent ${self.usd:.2f} of the ${config.RUN_BUDGET_USD:.2f} ceiling in "
            f"{self.calls} call(s) ({self.attempts} request(s) sent) over "
            f"{self.minutes:.0f} minute(s): "
            f"{self.input_tokens:,} input, "
            f"{self.cache_write_tokens:,} cache-write, {self.cache_read_tokens:,} "
            f"cache-read, {self.output_tokens:,} output token(s).",
        ]
        if self.carried_calls or self.carried_usd:
            lines.append(f"- earlier steps of this job ({LEDGER_ENV}): "
                         f"${self.carried_usd:.2f} in {self.carried_calls} call(s)")
        for model in sorted(self.usd_by_model, key=self.usd_by_model.get, reverse=True):
            lines.append(f"- {model}: ${self.usd_by_model[model]:.2f} "
                         f"in {self.calls_by_model[model]} call(s)")
        return "\n".join(lines)


#: Names the JSON file one job's processes share their spend through.
LEDGER_ENV = "BJT_SPEND_LEDGER"

spend = Spend.from_environment()


@atexit.register
def _save_on_exit() -> None:
    # Whatever `spend` is by then; a process that made no request still
    # passes on when the job's clock started.
    spend.save()


_EFFORTS = ("low", "medium", "high", "xhigh", "max")


def clamp_effort(effort: str) -> str:
    """Never harder than config.EFFORT_CEILING, whatever was asked for."""
    if effort not in _EFFORTS or config.EFFORT_CEILING not in _EFFORTS:
        return effort if effort in _EFFORTS else "medium"
    return _EFFORTS[min(_EFFORTS.index(effort), _EFFORTS.index(config.EFFORT_CEILING))]


def _get_client():
    global _client
    if _client is None:
        try:
            import anthropic  # noqa: WPS433 (lazy import is deliberate)
        except ImportError as e:  # pragma: no cover
            raise LLMError(
                "The 'anthropic' package is required for generation. "
                "Install it with: pip install anthropic"
            ) from e
        # No retries in the SDK: a retry it makes is a request nobody counts
        # and nobody checks a ceiling before. `_structured` retries instead,
        # the same number of times, each one through `spend.begin_request`.
        _client = anthropic.Anthropic(timeout=config.API_TIMEOUT_SECONDS, max_retries=0)
    return _client


# ----- retries ---------------------------------------------------------------

#: The statuses the SDK itself would retry: a timeout, a conflict, a rate
#: limit, and anything the server got wrong.
_RETRY_STATUSES = (408, 409, 429)

#: The wait before a retry, in seconds: doubling from the first, never more
#: than the last, or what the server's retry-after asks when that is shorter
#: than a minute. `_sleep` is the seam the tests replace.
_BACKOFF_FIRST, _BACKOFF_MAX = 0.5, 8.0
_sleep = time.sleep


def _status_of(exc: BaseException) -> Optional[int]:
    code = getattr(exc, "status_code", None)
    return code if isinstance(code, int) else None


def _is_api_failure(exc: BaseException) -> bool:
    """An error from the API or the SDK's transport: an outage, a refusal, a
    status the server sent, a connection that failed — and no credentials,
    which the SDK reports as a TypeError when it resolves them. These are the
    failures a caller may tolerate. Anything else (a keyword this SDK does not
    know, a bug of ours) is a crash, and is raised as itself: wrapped as an
    `LLMError` it would read as an outage, and every tolerant call site would
    turn a broken run into a quiet one."""
    try:
        import anthropic
    except ImportError:  # pragma: no cover
        return False
    if isinstance(exc, anthropic.AnthropicError):
        return True
    return isinstance(exc, TypeError) and "authentication method" in str(exc)


def _is_connection_error(exc: BaseException) -> bool:
    """No reply at all: the connection failed or the request timed out."""
    try:
        import anthropic
    except ImportError:  # pragma: no cover
        return False
    return isinstance(exc, anthropic.APIConnectionError)


def _is_timeout(exc: BaseException) -> bool:
    try:
        import anthropic
    except ImportError:  # pragma: no cover
        return False
    return isinstance(exc, anthropic.APITimeoutError)


def _retryable(exc: BaseException) -> bool:
    status = _status_of(exc)
    if status is not None:
        return status in _RETRY_STATUSES or status >= 500
    return _is_connection_error(exc)


def _backoff(retry: int, exc: BaseException) -> float:
    wait = min(_BACKOFF_MAX, _BACKOFF_FIRST * 2 ** retry) * (0.75 + random.random() / 4)
    headers = getattr(getattr(exc, "response", None), "headers", None) or {}
    try:
        asked = float(headers.get("retry-after", ""))
    except (TypeError, ValueError):
        asked = None
    if asked is not None and 0 <= asked <= 60:
        wait = asked
    return wait


def _worst_case_usage(system: str, user: "str | list", max_tokens: int) -> SimpleNamespace:
    """What a request that timed out may have cost: its whole output ceiling,
    and an input counted a token per character (more than Japanese or English
    takes) with a picture at the most a picture is. The server may well have
    finished it and billed it; a ledger that priced it at nothing would let a
    run of timeouts spend without limit."""
    chars = len(system)
    blocks = user if isinstance(user, list) else [{"type": "text", "text": user}]
    for block in blocks:
        if isinstance(block, dict) and block.get("type") == "image":
            chars += _IMAGE_TOKENS_MAX
        elif isinstance(block, dict):
            chars += len(str(block.get("text", "")))
        else:
            chars += len(str(block))
    return SimpleNamespace(input_tokens=chars, output_tokens=max_tokens)


#: The most input tokens one picture can be, at the API's largest image size.
_IMAGE_TOKENS_MAX = 5000


def request_params(
    model: str,
    system: str,
    user: "str | list",
    schema: dict,
    *,
    max_tokens: int,
    effort: str,
) -> dict:
    """The keyword arguments of one Messages request, shaped for the model.

    The thinking and effort controls are a property of the model family, not of
    the call. Opus and Sonnet take adaptive thinking and an effort level; Haiku
    4.5 takes neither — it wants a fixed thinking budget, and sending it the
    adaptive form or an effort level is a 400 on every call, which the
    proofreader and the difficulty probe would report as not having run. The
    calls Haiku makes here are small judgements with a small ceiling, and they
    do not need thinking at all, so for Haiku the two keys are simply left out.
    """
    # Two ceilings no caller can lift: output per call, and how hard the
    # model may think. They cap the cost of one call the way the spend ledger
    # caps the cost of a run.
    max_tokens = min(max_tokens, config.MAX_TOKENS_CEILING)
    effort = clamp_effort(effort)
    params: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "output_config": {"format": {"type": "json_schema", "schema": schema}},
        # The system prompt is the stable half of every request — the task
        # spec, the role list, the few-shot examples, the level descriptor —
        # and it is identical across every attempt at a shelf. Marking it
        # cacheable means the second attempt onward reads it at a tenth of the
        # price. Below the model's minimum cacheable size the marker is simply
        # ignored, so a short prompt costs nothing extra.
        "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": user}],
    }
    if not model.startswith("claude-haiku"):
        params["thinking"] = {"type": "adaptive"}
        params["output_config"]["effort"] = effort
    return params


def _structured(
    system: str,
    user: "str | list",
    schema: dict,
    model: str,
    *,
    max_tokens: int = 8000,
    effort: str = "high",
) -> dict:
    """One structured-output request. Returns the parsed JSON object.

    A transient failure (a timeout, a dropped connection, a rate limit, an
    overloaded server) is retried here, up to config.API_MAX_RETRIES times,
    and every attempt goes through the ceilings and onto the count first.
    """
    # The ceilings are checked before the call, never after: a run that is
    # over its budget makes no further request, not one more.
    spend.check_ceilings()
    client = _get_client()
    params = request_params(model, system, user, schema, max_tokens=max_tokens, effort=effort)
    retry = 0
    while True:
        spend.begin_request()
        try:
            resp = client.messages.create(**params)
            break
        except Exception as e:  # surface API errors with context
            if not _is_api_failure(e):
                raise
            if _is_timeout(e):
                # Sent, and perhaps finished and billed with nobody listening.
                spend.add(model, _worst_case_usage(system, user, params["max_tokens"]))
            if _retryable(e) and retry < config.API_MAX_RETRIES:
                _sleep(_backoff(retry, e))
                retry += 1
                continue
            if any(sign in str(e).lower() for sign in _BILLING_SIGNS):
                raise LLMBillingError(f"API request failed: {e}") from e
            raise LLMError(f"API request failed: {e}") from e

    # Priced from what the API says it used, before anything else can fail:
    # a refusal or a malformed reply was paid for too.
    spend.add(model, getattr(resp, "usage", None))

    if resp.stop_reason == "refusal":
        raise LLMError(f"model refused the request ({resp.stop_details})")
    if resp.stop_reason in _TRUNCATED:
        raise LLMTruncatedError(
            f"reply cut off ({resp.stop_reason}) at a ceiling of "
            f"{min(max_tokens, config.MAX_TOKENS_CEILING)} output tokens")

    text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), None)
    if not text:
        raise LLMError("no text block in response")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMError(f"structured output was not valid JSON: {e}") from e


def generate_structured(system: str, user: str, schema: dict, model: Optional[str] = None) -> dict:
    return _structured(system, user, schema, model or config.GEN_MODEL,
                       max_tokens=8000, effort=config.GEN_EFFORT)


# ----- the proofreader --------------------------------------------------

def sanity_check(rendered_item: str, rules: dict[str, str], model: Optional[str] = None) -> dict:
    """Read one finished item and say which of the rules it breaks.

    Returns {rule: bool, ..., "notes": str}; a true flag means the fault is
    present. Same shape as `review_scene_image`, for the same reason: the caller
    owns the rule list (`sanity.RULES`, key → fault in words) so the schema and
    the wording the model is judged against cannot drift apart.

    Small model, low effort, small ceiling — this is the cheap pass that runs on
    every item before the expensive one runs on any of them. Deliberately NOT
    asked to re-answer the question: an item is meant to be hard, and a cheap
    model's disagreement about which 敬語 form fits is not evidence of a defect.
    """
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": [*rules, "notes"],
        "properties": {
            **{rule: {"type": "boolean", "description": f"true if this fault is present: {fault}"}
               for rule, fault in rules.items()},
            "notes": {"type": "string", "description": "one sentence on anything you flagged"},
        },
    }
    user = (
        "Proofread the finished test item below. It is meant to be difficult, and a "
        "hard item is not a broken one — flag a rule only when the fault is actually "
        "there, not when you would have written the item differently. The distractors "
        "are wrong on purpose — but wrong the way real people are wrong, so a "
        "distractor nobody would ever say is a fault. Set every flag you are unsure "
        "about to false.\n\n"
        + rendered_item
    )
    system = (
        "You are the proofreader for a business-Japanese test bank. You are a native "
        "reader of Japanese and you check finished items for defects: a marked answer "
        "that cannot be right, a second answer that is just as right, an explanation "
        "that does not match the marked answer, broken Japanese, Japanese no native "
        "would say, a situation that does not hang together, options that do not "
        "answer the question. You report faults, not preferences."
    )
    return _structured(system, user, schema, model or config.SANITY_MODEL,
                       max_tokens=1200, effort="low")


# ----- answering (gate + calibration) -----------------------------------

_ANSWER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["choice", "reason"],
    "properties": {
        "choice": {"type": "integer", "description": "0-based index of the chosen option"},
        "reason": {"type": "string", "description": "one short sentence of justification"},
    },
}


def answer_choice(question: str, options: list[str], model: Optional[str] = None) -> dict:
    """Pick one option. Used by the answerability gate and calibration.

    Returns {"choice": int, "reason": str}. Low effort: this is a judgement call,
    not a generation task, and we run it many times.
    """
    numbered = "\n".join(f"{i}. {t}" for i, t in enumerate(options))
    user = (
        f"{question}\n\nOptions:\n{numbered}\n\n"
        "Choose the single best option and return its 0-based index."
    )
    system = (
        "You are a highly proficient reader of Japanese taking a business-Japanese "
        "proficiency test. Answer to the best of your ability. If the information "
        "given is insufficient to determine the answer, pick your best guess anyway."
    )
    return _structured(system, user, _ANSWER_SCHEMA, model or config.JUDGE_MODEL, max_tokens=1500, effort="low")


# ----- discriminator judge ----------------------------------------------

def judge_synthetic(rendered_items: list[str], model: Optional[str] = None) -> dict:
    """Ask a judge to label each item real (official) or synthetic (generated),
    and to state the tells it used.

    Returns {"labels": ["official"|"synthetic", ...], "reasons": [str, ...]}.
    """
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["labels", "reasons"],
        "properties": {
            "labels": {
                "type": "array",
                "items": {"type": "string", "enum": ["official", "synthetic"]},
            },
            "reasons": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Concrete tells you used to separate synthetic from official items.",
            },
        },
    }
    blocks = "\n\n".join(f"=== Item {i} ===\n{txt}" for i, txt in enumerate(rendered_items))
    user = (
        "Below are BJT-style items. Some are from official sample material, some were "
        "generated by a model. For each item, label it 'official' or 'synthetic'. Then "
        "list the concrete tells that let you separate the synthetic ones — if you cannot "
        "tell them apart, say so.\n\n" + blocks
    )
    system = "You are an expert BJT item writer with an eye for synthetic-item tells."
    return _structured(system, user, schema, model or config.JUDGE_MODEL, max_tokens=4000, effort="high")


# ----- answering from a picture ------------------------------------------

def answer_from_image(image: bytes, media_type: str, question: str, options: list[str],
                      model: Optional[str] = None) -> dict:
    """Look at a picture and pick which of the options describes it.

    The visual half of the answerability gate for 画像把握 (bjt/scene_art.py):
    the same shape as `answer_choice`, with the picture where the stem would
    be. Low effort, small ceiling, run a few times per draft like the text
    gate; the draft ships only if every trial picks the marked option.
    """
    import base64

    numbered = "\n".join(f"{i}. {t}" for i, t in enumerate(options))
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": media_type,
                                     "data": base64.b64encode(image).decode("ascii")}},
        {"type": "text", "text": (
            f"{question}\n\nOptions:\n{numbered}\n\n"
            "Look at the picture and choose the single option that describes what it "
            "shows. Return its 0-based index."
        )},
    ]
    system = (
        "You are a highly proficient reader of Japanese taking a business-Japanese "
        "listening test in which a picture is shown and four descriptions are heard. "
        "Answer from what is actually visible. If none fits well, pick the closest."
    )
    return _structured(system, content, _ANSWER_SCHEMA, model or config.JUDGE_MODEL,
                       max_tokens=1500, effort="low")


# ----- scene artwork review ---------------------------------------------

def review_scene_image(image: bytes, media_type: str, brief: str, rules: dict[str, str],
                       model: Optional[str] = None) -> dict:
    """Look at one draft and say which of the brief's rules it breaks.

    Returns {rule: bool, ..., "notes": str}; a true flag means the rule is
    broken. The rules are named by the caller so the schema and the verdict
    stay in one place (`scene_art.RULES`, key → fault in words). Strict on purpose: a picture that
    is doubtful on any rule is a picture the whole bank inherits.
    """
    import base64

    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": [*rules, "notes"],
        "properties": {
            **{rule: {"type": "boolean", "description": f"true if the image has this fault: {fault}"}
               for rule, fault in rules.items()},
            "notes": {"type": "string", "description": "one or two sentences on what you see"},
        },
    }
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": media_type,
                                     "data": base64.b64encode(image).decode("ascii")}},
        {"type": "text", "text": (
            "This image was drawn for the brief below. It will be shared by many "
            "listening-comprehension items about the same setting, so it must show the "
            "setting and nothing more specific. Check it against every clause of the "
            "brief and set each flag to true only if that fault is actually present. "
            "Be strict: readable text of any language, a logo, a recognisable real "
            "person, or a picture that tells the viewer what is being said are each a "
            "fault on their own.\n\n=== Brief ===\n" + brief
        )},
    ]
    system = ("You are the art reviewer for a shared illustration bank used by a "
              "business-Japanese listening test. You judge drafts against a written "
              "brief and report faults, not taste.")
    return _structured(system, content, schema, model or config.JUDGE_MODEL,
                       max_tokens=1500, effort="medium")
