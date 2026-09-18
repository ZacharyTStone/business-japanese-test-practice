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
    client = _get_client()
    try:
        resp = client.messages.create(**request_params(
            model, system, user, schema, max_tokens=max_tokens, effort=effort))
    except Exception as e:  # surface API errors with context
        if any(sign in str(e).lower() for sign in _BILLING_SIGNS):
            raise LLMBillingError(f"API request failed: {e}") from e
        raise LLMError(f"API request failed: {e}") from e

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
