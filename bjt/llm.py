"""Thin wrapper over the Anthropic Messages API.

Four call shapes are used across the tool:
  * generate_structured  — the generators, constrained to an item JSON schema
  * answer_choice        — the answerability gate / calibration (pick 1 of N)
  * judge_synthetic      — the discriminator loop (real vs synthetic + why)
  * review_scene_image   — the scene art gate (one flag per rule in the brief)

All four use structured output (`output_config.format`) so we never parse free
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
        resp = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            thinking={"type": "adaptive"},
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            system=system,
            messages=[{"role": "user", "content": user}],
        )
    except Exception as e:  # surface API errors with context
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
    return _structured(system, user, schema, model or config.GEN_MODEL, max_tokens=8000, effort="high")


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
