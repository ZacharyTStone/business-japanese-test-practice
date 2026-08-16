"""Item shape: the JSON schema handed to the model's structured-output mode, and
the validator we run on every item before it is allowed anywhere near the study
user or the database.

Structured output is non-negotiable (brief): the model always emits JSON against
an explicit schema; we never parse free text. We also re-validate on our side —
the schema constrains shape and role enums, but exactly-one-correct and the
no-duplicate-role rules are enforced here.
"""
from __future__ import annotations

from .fidelity import roles
from .levels import LEVELS


def build_item_schema(item_type: str) -> dict:
    """A json_schema for `output_config.format`, specialised to one item type.

    Constrains the role field to this item type's enum and the level field to
    the valid levels, so the model can't invent either.
    """
    role_values = roles.role_enum(item_type)
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "stem",
            "options",
            "explanation_ja",
            "explanation_en",
            "topic",
            "vocab_notes",
        ],
        "properties": {
            "stem": {
                "type": "string",
                "description": "The item stem exactly as the test-taker sees it. "
                "For 語彙・文法, the carrier sentence with the blank written as ＿＿＿.",
            },
            "options": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["text", "role"],
                    "properties": {
                        "text": {"type": "string"},
                        "role": {"type": "string", "enum": role_values},
                    },
                },
                "description": "Exactly four options. Exactly one has role 'correct'; "
                "the other three each carry a distinct distractor role from the enum.",
            },
            "topic": {
                "type": "string",
                "description": "A short label for the business scenario (e.g. '納期の連絡'). "
                "Used to avoid repeating scenarios across items.",
            },
            "explanation_ja": {
                "type": "string",
                "description": "解説 in Japanese: why the answer is correct and why "
                "each distractor fails, tied to its role.",
            },
            "explanation_en": {
                "type": "string",
                "description": "A one-line English gloss of the explanation.",
            },
            "vocab_notes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["term", "reading", "meaning"],
                    "properties": {
                        "term": {"type": "string"},
                        "reading": {"type": "string"},
                        "meaning": {"type": "string"},
                    },
                },
                "description": "Business vocabulary worth noting from this item.",
            },
        },
    }


def validate_item(item_type: str, item: dict) -> list[str]:
    """Return a list of problems with a generated item (empty == valid).

    Covers structure the schema can't (exactly-one-correct, distinct roles) plus
    a few basic sanity checks. Level is validated separately when known.
    """
    errors: list[str] = []

    for field in ("stem", "options", "explanation_ja", "explanation_en", "topic"):
        if not item.get(field):
            errors.append(f"missing or empty field: {field}")

    options = item.get("options")
    if not isinstance(options, list):
        errors.append("options must be a list")
        return errors  # nothing else is checkable

    for i, opt in enumerate(options):
        if not isinstance(opt, dict) or not opt.get("text") or not opt.get("role"):
            errors.append(f"option {i} missing text or role")

    errors.extend(roles.validate_roles(item_type, options))

    # Options must be distinct strings — duplicated text is a giveaway/bug.
    texts = [o.get("text") for o in options if isinstance(o, dict)]
    if len(set(texts)) != len(texts):
        errors.append("options contain duplicate text")

    return errors


def correct_index(options: list[dict]) -> int:
    """Position of the option whose role is 'correct'."""
    for i, o in enumerate(options):
        if o.get("role") == roles.CORRECT:
            return i
    raise ValueError("no correct option found")


def valid_level(level: str) -> bool:
    return level in LEVELS
