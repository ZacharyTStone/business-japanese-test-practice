"""Thin wrapper over the Anthropic Messages API.

Five call shapes are used across the tool:
  * generate_structured  — the generators, constrained to an item JSON schema
  * sanity_check         — the proofreader (one flag per rule, on a small model)
  * answer_choice        — the answerability gate / calibration (pick 1 of N)
  * judge_synthetic      — the discriminator loop (real vs synthetic + why)
  * review_scene_image   — the scene art gate (one flag per rule in the brief)

All five use structured output (`output_config.format`) so we never parse free
text. The SDK is imported lazily so the offline commands (selftest, demo) run
with neither the package nor an API key present.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional

from . import config

_client = None


class LLMError(RuntimeError):
    pass


class LLMBillingError(LLMError):
    """The account cannot pay for the call. Nothing else will succeed either.

    A run that meets this should stop, not carry on through forty more slots
    of the same refusal — the first real night did exactly that, and the log
    was pages of one error. Raised as its own class so the callers that
    tolerate a failed call (one shelf, one probe) can let this one through.
    """


_BILLING_SIGNS = ("credit balance", "insufficient_quota", "billing")


class LLMSpendLimitError(LLMBillingError):
    """This process has spent what it was allowed to. Raised *before* the
    call that would go over, so the ceiling is never crossed by more than one
    response. A subclass of the billing error on purpose: every caller that
    stops for an empty account stops for this too, keeping what it wrote."""


# ----- the spend ledger --------------------------------------------------
#
# Dollars per million tokens, by model family, as the price list has them
# (2026-09). Cache writes cost a quarter more than plain input and cache
# reads a tenth of it. A model not in the table is priced as the dearest one
# there — the ledger exists to stop a run, and a guess that is too low is the
# one kind of wrong it must not be.
PRICES_USD_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-opus": (5.0, 25.0),
    "claude-sonnet": (2.0, 10.0),
    "claude-haiku": (1.0, 5.0),
}
CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.10


def price_usd(model: str, usage: Any) -> float:
    """What one response cost, from the usage the API reports on it."""
    rates = next((r for prefix, r in PRICES_USD_PER_MTOK.items()
                  if model.startswith(prefix)), None)
    if rates is None:
        rates = max(PRICES_USD_PER_MTOK.values(), key=lambda r: r[1])
    per_in, per_out = rates
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
    """
    calls: int = 0
    input_tokens: int = 0
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0
    output_tokens: int = 0
    usd: float = 0.0
    usd_by_model: dict[str, float] = field(default_factory=dict)
    calls_by_model: dict[str, int] = field(default_factory=dict)

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
        return cost

    def check_ceilings(self) -> None:
        """Raise if the next call would be one too many. Called before it."""
        if self.calls >= config.RUN_MAX_CALLS:
            raise LLMSpendLimitError(
                f"call ceiling reached: {self.calls} calls this run "
                f"(BJT_RUN_MAX_CALLS={config.RUN_MAX_CALLS}); ${self.usd:.2f} spent")
        if self.usd >= config.RUN_BUDGET_USD:
            raise LLMSpendLimitError(
                f"spend ceiling reached: ${self.usd:.2f} of "
                f"${config.RUN_BUDGET_USD:.2f} (BJT_RUN_BUDGET_USD) "
                f"in {self.calls} calls")

    def report(self) -> str:
        """The bill, as a few lines for a summary."""
        lines = [
            f"Spent ${self.usd:.2f} of the ${config.RUN_BUDGET_USD:.2f} ceiling in "
            f"{self.calls} call(s): {self.input_tokens:,} input, "
            f"{self.cache_write_tokens:,} cache-write, {self.cache_read_tokens:,} "
            f"cache-read, {self.output_tokens:,} output token(s).",
        ]
        for model in sorted(self.usd_by_model, key=self.usd_by_model.get, reverse=True):
            lines.append(f"- {model}: ${self.usd_by_model[model]:.2f} "
                         f"in {self.calls_by_model[model]} call(s)")
        return "\n".join(lines)


spend = Spend()


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
        _client = anthropic.Anthropic()
    return _client


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
    adaptive form or an effort level is a 400. The first real night lost every
    proofread and every difficulty probe to exactly that: the cheap model was
    asked in the expensive model's dialect, refused every call, and both steps
    reported themselves as not having run. The calls Haiku makes here are
    small judgements with a small ceiling, and they do not need thinking at
    all, so for Haiku the two keys are simply left out.
    """
    # Two ceilings no caller can lift: output per call, and how hard the
    # model may think. They cap the cost of one call the way the ledger below
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
    """One structured-output request. Returns the parsed JSON object."""
    # The ceilings are checked before the call, never after: a run that is
    # over its budget makes no further request, not one more.
    spend.check_ceilings()
    client = _get_client()
    try:
        resp = client.messages.create(**request_params(
            model, system, user, schema, max_tokens=max_tokens, effort=effort))
    except Exception as e:  # surface API errors with context
        if any(sign in str(e).lower() for sign in _BILLING_SIGNS):
            raise LLMBillingError(f"API request failed: {e}") from e
        raise LLMError(f"API request failed: {e}") from e

    # Priced from what the API says it used, before anything else can fail:
    # a refusal or a malformed reply was paid for too.
    spend.add(model, getattr(resp, "usage", None))

    if resp.stop_reason == "refusal":
        raise LLMError(f"model refused the request ({resp.stop_details})")

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
        "are wrong on purpose. Set every flag you are unsure about to false.\n\n"
        + rendered_item
    )
    system = (
        "You are the proofreader for a business-Japanese test bank. You are a native "
        "reader of Japanese and you check finished items for defects: a marked answer "
        "that cannot be right, a second answer that is just as right, an explanation "
        "that does not match the marked answer, broken Japanese, options that do not "
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
