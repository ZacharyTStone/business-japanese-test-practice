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

from . import render
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

def _scene_field(description: str = "") -> dict:
    return {
        "type": "string",
        "description": description or (
            "Which reusable scene image this item is set in. Must be one of the "
            "scene ids offered for this seed cell."
        ),
    }


def _channel_field(enum: list[str]) -> dict:
    return {
        "type": "string",
        "enum": enum,
        "description": "How the item reaches the listener. Must match the seed cell.",
    }


def _dialogue_field() -> dict:
    """A multi-speaker exchange, for the types that play a conversation.

    Turns carry a role rather than a name, for the same reason 発言聴解 options
    do: the role decides the voice, and a voice cast per item would have the
    learner doing speaker identification instead of listening to Japanese.
    """
    return {
        "type": "array",
        "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["speaker_role", "text"],
            "properties": {
                "speaker_role": {
                    "type": "string",
                    "description": "Who is speaking, as a role (e.g. '営業課長'). Never a "
                    "personal name — roles drive voice casting.",
                },
                "text": {"type": "string", "description": "The turn, verbatim, as spoken."},
            },
        },
        "description": "The exchange the test-taker hears, in order. Between three and "
        "eight turns, across two or three distinct speaker roles.",
    }


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
    # 場面把握 — the situation is narrated and the question is about the
    # situation itself, so the options are statements ABOUT it rather than
    # things anyone says. Nothing here is spoken except the narration.
    "bamen_haaku": {
        "stem_description": (
            "What the narrator reads aloud: a short exchange or moment, then the question "
            "（例:「ここはどこですか。」「このあと何をしますか。」）. The test-taker hears it "
            "once, so it must contain every clue the question turns on."
        ),
        "required": ["scene_id", "channel"],
        "properties": {
            "scene_id": _scene_field(),
            "channel": _channel_field(SPOKEN_CHANNELS),
        },
    },
    # 画像把握 — a picture is shown, and four descriptions of it are heard.
    # The picture is drawn from `image_brief` after the item is written, by
    # the scene job, and reviewed against these very options (bjt/scene_art).
    "gazou_haaku": {
        "stem_description": (
            "What the narrator asks about the picture, heard once （例:「男の人は何を"
            "していますか。」「二人は何をしていますか。」）. One short sentence; it must "
            "name who is being asked about when more than one person is drawn."
        ),
        "required": ["image_brief", "channel"],
        "properties": {
            "image_brief": {
                "type": "string",
                "description": (
                    "The picture, in English, for an illustrator: 40-90 words, concrete "
                    "and complete — the place, how many people, who they are by role and "
                    "appearance, exactly what they are doing with their hands and bodies, "
                    "the objects involved, and what is deliberately NOT happening. Written "
                    "so that exactly one option is true of the drawing and each of the "
                    "other three is contradicted by something visible in it. No text, "
                    "signs, logos or real people."
                ),
            },
            "channel": _channel_field(["in_person"]),
        },
    },
    # 総合聴解 — a conversation heard once, then a question about it.
    "sougou_choukai": {
        "stem_description": (
            "The question the narrator asks after the exchange has played （例:「この件は "
            "誰が担当することになりましたか。」）, preceded by one sentence of setup if the "
            "exchange needs it. The exchange itself goes in `dialogue`, not here."
        ),
        "required": ["scene_id", "channel", "dialogue"],
        "properties": {
            "scene_id": _scene_field(),
            "channel": _channel_field(SPOKEN_CHANNELS),
            "dialogue": _dialogue_field(),
        },
    },
    # 状況把握 — read what is posted, hear what is asked, choose the action.
    "joukyou_haaku": {
        "stem_description": (
            "What the narrator reads aloud: the situation and the spoken request, ending "
            "with the question （例:「このあと、どうすればいいですか。」）. The document is "
            "read, not heard, so do not describe its contents here."
        ),
        "required": ["scene_id", "channel", "document"],
        "properties": {
            "scene_id": _scene_field(),
            "channel": _channel_field(SPOKEN_CHANNELS),
            "document": render.document_schema(),
        },
    },
    # 資料聴読解 — a document on the page, a prompt in the ear.
    "shiryou_choudokkai": {
        "stem_description": (
            "What the narrator reads aloud: the spoken prompt, ending with the question. "
            "The answer must require BOTH the document and this prompt — if either alone "
            "settles it, the item is not testing this type."
        ),
        "required": ["channel", "document"],
        "properties": {
            "scene_id": _scene_field("Optional scene image, if the seed cell offers one."),
            "channel": _channel_field(SPOKEN_CHANNELS),
            "document": render.document_schema(),
        },
    },
    # 総合聴読解 — the exchange AND its documents; the answer is in neither alone.
    "sougou_choudokkai": {
        "stem_description": (
            "The question the narrator asks after the exchange has played. The exchange "
            "goes in `dialogue` and the documents in `documents`."
        ),
        "required": ["channel", "dialogue", "documents"],
        "properties": {
            "scene_id": _scene_field("Optional scene image, if the seed cell offers one."),
            "channel": _channel_field(SPOKEN_CHANNELS),
            "dialogue": _dialogue_field(),
            "documents": {
                "type": "array",
                "items": render.document_schema(),
                "description": "One or two documents the test-taker reads alongside the "
                "exchange. Each uses a template offered by the seed cell.",
            },
        },
    },
    # 総合読解 — reading only. Never synthesised.
    "sougou_dokkai": {
        "stem_description": (
            "The question, as the test-taker reads it （例:「この後、山川さんがまずすべき "
            "ことは何ですか。」）. The passage goes in `document`, not here."
        ),
        "required": ["document"],
        "properties": {
            "document": render.document_schema(),
        },
    },
}


#: Which section of the exam each type belongs to. The database has the same
#: table (public.item_types) and tests/test_plan.py asserts the two agree;
#: the planner reads this one because the nightly job runs with no database.
SECTIONS: dict[str, str] = {
    "bamen_haaku": "choukai",
    "gazou_haaku": "choukai",
    "hatsugen_choukai": "choukai",
    "sougou_choukai": "choukai",
    "joukyou_haaku": "choudokkai",
    "shiryou_choudokkai": "choudokkai",
    "sougou_choudokkai": "choudokkai",
    "goi_bunpou": "dokkai",
    "hyougen": "dokkai",
    "sougou_dokkai": "dokkai",
}

#: How many questions of this type the real exam asks, out of its 80.
#:
#: 第1部 聴解 25 (場面把握 5, 発言聴解 10, 総合聴解 10), 第2部 聴読解 25 (状況把握 5,
#: 資料聴読解 10, 総合聴読解 10), 第3部 読解 30 (語彙・文法 10, 表現読解 10,
#: 総合読解 10). Corroborated across the exam's own published structure and the
#: endorsed publisher's workbooks; the 80 total and the 25/25/30 split are the
#: firmest part, the per-sub-part counts the least firm, and both agree that
#: **場面把握 and 状況把握 are half-size types**.
#:
#: It is one fact used twice, which is why it is a table rather than two
#: constants. The planner reads it to decide what to WRITE — a shelf is compared
#: against its share rather than against every other shelf, so a five-question
#: type is not filled to the depth of a ten-question one. The database has the
#: same column (public.item_types.exam_questions) and the queue reads it to
#: decide what to SERVE, so that a set of ten leans the way the exam does.
#: tests/test_plan.py asserts the two agree.
#:
#: 画像把握 is ours rather than the exam's — the closest thing to it is the
#: picture half of 第1部 — so it is given the smallest non-zero share there is.
#: What actually keeps it rare is plan.NIGHT_TYPE_CAPS; this only stops it
#: looking like a ten-question type to the arithmetic.
EXAM_QUESTIONS: dict[str, int] = {
    "bamen_haaku": 5,
    "gazou_haaku": 2,
    "hatsugen_choukai": 10,
    "sougou_choukai": 10,
    "joukyou_haaku": 5,
    "shiryou_choudokkai": 10,
    "sougou_choudokkai": 10,
    "goi_bunpou": 10,
    "hyougen": 10,
    "sougou_dokkai": 10,
}

#: Types whose stimulus is a picture of their own: an item is not served until
#: its picture is drawn and approved (public.item_types.needs_picture).
PICTURE_TYPES: tuple[str, ...] = ("gazou_haaku",)

#: The reading types: no audio, no picture, the cheapest item there is to
#: ship, and the ones the owner asked to see written every night (2026-09-19).
READING_TYPES: tuple[str, ...] = tuple(t for t, sec in SECTIONS.items() if sec == "dokkai")

#: Which extra fields hold documents, per item type. Used by validation, by the
#: TTS planner (a document is never spoken) and by the app.
DOCUMENT_FIELDS: dict[str, str] = {
    "joukyou_haaku": "document",
    "shiryou_choudokkai": "document",
    "sougou_dokkai": "document",
    "sougou_choudokkai": "documents",
}

#: Types whose stimulus includes a multi-speaker exchange.
DIALOGUE_TYPES = ("sougou_choukai", "sougou_choudokkai")


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

    if item.get("channel") is not None and item["channel"] not in CHANNELS:
        errors.append(f"channel {item['channel']!r} is not one of {CHANNELS}")

    errors.extend(_document_errors(item_type, item))
    errors.extend(_dialogue_errors(item_type, item))

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


#: A conversation with two turns is not a conversation, and one with twelve is a
#: memory test rather than a listening test. Both ends are enforced.
DIALOGUE_MIN_TURNS, DIALOGUE_MAX_TURNS = 3, 10

#: At most this many documents per item. Two is already a lot to hold on a
#: phone screen; three would be testing scrolling.
MAX_DOCUMENTS = 2


def documents_of(item: dict) -> list[dict]:
    """An item's document stimulus, always as a list.

    The generator's schema calls it `document` for the three types that have one
    and `documents` for the one type that has two. Everything that reads a
    document rather than validating it — the bundle, the sanity check — would
    rather deal with one shape than with that distinction, so the translation
    lives here once instead of in each of them.
    """
    field = DOCUMENT_FIELDS.get(item.get("item_type", ""))
    if field is None:
        return []
    value = item.get(field)
    if isinstance(value, list):
        return [d for d in value if isinstance(d, dict)]
    return [value] if isinstance(value, dict) else []


def _document_errors(item_type: str, item: dict) -> list[str]:
    """Validate whatever documents this item type carries.

    The structured-output schema constrains a document's shape, but not that its
    table rows match its header or that it carries the header fields its
    template promises — that lives in bjt/render, and this is where it is run.
    """
    field = DOCUMENT_FIELDS.get(item_type)
    if field is None:
        return []

    value = item.get(field)
    if field == "document":
        if not isinstance(value, dict):
            return [f"{field} must be an object"]
        docs = [value]
    else:
        if not isinstance(value, list) or not value:
            return [f"{field} must be a non-empty list"]
        if len(value) > MAX_DOCUMENTS:
            return [f"{len(value)} documents; at most {MAX_DOCUMENTS} fit on a phone screen"]
        docs = value

    errors = []
    for i, doc in enumerate(docs):
        prefix = f"{field}" if field == "document" else f"{field}[{i}]"
        errors.extend(f"{prefix}: {e}" for e in render.validate_document(doc))
    return errors


def _dialogue_errors(item_type: str, item: dict) -> list[str]:
    """A dialogue has to be long enough to carry a question and short enough to
    hold in your head, and it has to have more than one person in it — a
    'conversation' with one speaker is a monologue with extra formatting."""
    if item_type not in DIALOGUE_TYPES:
        return []

    turns = item.get("dialogue")
    if not isinstance(turns, list):
        return ["dialogue must be a list"]
    if not DIALOGUE_MIN_TURNS <= len(turns) <= DIALOGUE_MAX_TURNS:
        return [
            f"dialogue has {len(turns)} turn(s); expected "
            f"{DIALOGUE_MIN_TURNS}-{DIALOGUE_MAX_TURNS}"
        ]

    errors = []
    speakers = set()
    for i, turn in enumerate(turns):
        if not isinstance(turn, dict) or not turn.get("speaker_role") or not turn.get("text"):
            errors.append(f"dialogue turn {i} is missing speaker_role or text")
            continue
        speakers.add(turn["speaker_role"])
    if len(speakers) < 2 and not errors:
        errors.append(f"dialogue has only one speaker ({speakers}); it needs at least two")
    return errors


def correct_index(options: list[dict]) -> int:
    """Position of the option whose role is 'correct'."""
    for i, o in enumerate(options):
        if o.get("role") == roles.CORRECT:
            return i
    raise ValueError("no correct option found")


def valid_level(level: str) -> bool:
    return level in LEVELS
