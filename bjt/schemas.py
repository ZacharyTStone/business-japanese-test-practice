"""Item shape: the JSON schema handed to the model's structured-output mode, and
the validator we run on every item before it is allowed anywhere near the study
user or the database.

Structured output is non-negotiable (brief): the model always emits JSON against
an explicit schema; we never parse free text. We also re-validate on our side —
the schema constrains shape and role enums, but exactly-one-correct, the
no-duplicate-role rule, and the per-option `why` are enforced here.

Item types share one core shape (stem, four role-tagged options, 解説, vocab) and
add their own fields through TYPE_EXTRAS. 発言聴解 needs the extra fields because
its stimulus is not text on a page: it is a narrated situation over a reused
scene image, spoken by a named role over a named channel.
"""
from __future__ import annotations

from .fidelity import roles
from .levels import LEVELS

#: Channels an utterance can be delivered over. Drives TTS treatment: a phone
#: line is band-limited on purpose so the listening practice matches the exam.
SPOKEN_CHANNELS = ["in_person", "phone", "video"]

#: The stimulus is text on a page. Never synthesised — bjt/tts/plan.py has no
#: profile for it on purpose. It exists so a 定型表現 inside an email lands in a
#: different weakness bucket from face-to-face 敬語, which is the whole point of
#: the reading types.
WRITTEN_CHANNEL = "written"

#: Every channel an item may carry. Spoken types constrain themselves to
#: SPOKEN_CHANNELS through their own schema; the column accepts all four.
CHANNELS = [*SPOKEN_CHANNELS, WRITTEN_CHANNEL]

# Per-type additions to the core shape: what the stem means for this type, plus
# any extra required fields and their schema.
TYPE_EXTRAS: dict[str, dict] = {
    "goi_bunpou": {
        "stem_description": "The carrier sentence with the blank written as ＿＿＿.",
    },
    "hyougen": {
        "stem_description": "The situation, then the question, as the test-taker reads it.",
    },
    "hatsugen_choukai": {
        "stem_description": (
            "The situation as the narrator reads it aloud, ending with the question "
            "（例:「…こんなとき、何と言いますか。」）. Two or three sentences. It must "
            "name who the speaker is talking to and what they are trying to do, because "
            "the test-taker hears it once and cannot re-read it."
        ),
        "required": ["scene_id", "speaker_role", "listener_role", "channel"],
        "properties": {
            "scene_id": {
                "type": "string",
                "description": "Which reusable scene image this item is set in. "
                "Must be one of the scene ids offered for this seed cell.",
            },
            "speaker_role": {
                "type": "string",
                "description": "The role of the person speaking the options, e.g. '営業担当（若手）'. "
                "A role, never a personal name — roles drive voice casting.",
            },
            "listener_role": {
                "type": "string",
                "description": "The role of the person being addressed, e.g. '取引先の課長'.",
            },
            "channel": {
                "type": "string",
                "enum": SPOKEN_CHANNELS,
                "description": "How the utterance reaches the listener. Must match the seed cell.",
            },
        },
    },
}


def build_item_schema(item_type: str) -> dict:
    """A json_schema for `output_config.format`, specialised to one item type.

    Constrains the role field to this item type's enum, so the model can't invent
    one, and folds in whatever extra fields the type declares.
    """
    role_values = roles.role_enum(item_type)
    extras = TYPE_EXTRAS.get(item_type, {})

    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "stem",
            "options",
            "explanation_ja",
            "explanation_en",
            "topic",
            "vocab_notes",
            *extras.get("required", []),
        ],
        "properties": {
            "stem": {
                "type": "string",
                "description": "The item stem exactly as the test-taker receives it. "
                + extras.get("stem_description", ""),
            },
            "options": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["text", "role", "why"],
                    "properties": {
                        "text": {"type": "string"},
                        "role": {"type": "string", "enum": role_values},
                        "why": {
                            "type": "string",
                            "description": "One sentence in Japanese naming the specific reason "
                            "THIS option fails (or, for the correct option, why it fits). Not a "
                            "restatement of the role label — the concrete thing that is wrong "
                            "with this exact wording in this exact situation.",
                        },
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
    schema["properties"].update(extras.get("properties", {}))
    return schema


def validate_item(item_type: str, item: dict) -> list[str]:
    """Return a list of problems with a generated item (empty == valid).

    Covers structure the schema can't (exactly-one-correct, distinct roles, a
    real per-option `why`) plus a few basic sanity checks. Level is validated
    separately when known.
    """
    errors: list[str] = []

    extras = TYPE_EXTRAS.get(item_type, {})
    for field in ("stem", "options", "explanation_ja", "explanation_en", "topic",
                  *extras.get("required", [])):
        if not item.get(field):
            errors.append(f"missing or empty field: {field}")

    if item_type == "hatsugen_choukai" and item.get("channel") not in (None, *SPOKEN_CHANNELS):
        errors.append(f"channel {item['channel']!r} is not one of {SPOKEN_CHANNELS}")

    options = item.get("options")
    if not isinstance(options, list):
        errors.append("options must be a list")
        return errors  # nothing else is checkable

    for i, opt in enumerate(options):
        if not isinstance(opt, dict) or not opt.get("text") or not opt.get("role"):
            errors.append(f"option {i} missing text or role")
            continue
        # The per-option reason is the whole point of the role system: without it
        # the app has nothing specific to show after a wrong answer.
        if not opt.get("why"):
            errors.append(f"option {i} missing why")

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
