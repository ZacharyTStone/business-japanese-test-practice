/**
 * Item shape: the JSON schema handed to the model's structured-output mode, and
 * the validator we run on every item before it is allowed anywhere near the study
 * user or the database.
 *
 * Structured output is non-negotiable (brief): the model always emits JSON against
 * an explicit schema; we never parse free text. We also re-validate on our side —
 * the schema constrains shape and role enums, but exactly-one-correct, the
 * no-duplicate-role rule, and the per-option `why` are enforced here.
 *
 * Item types share one core shape (stem, four role-tagged options, 解説, vocab) and
 * add their own fields through TYPE_EXTRAS. 発言聴解 needs the extra fields because
 * its stimulus is not text on a page: it is a narrated situation over a reused
 * scene image, spoken by a named role over a named channel.
 */
import * as render from "./render/index.ts";
import * as roles from "./fidelity/roles.ts";
import { LEVELS } from "./levels.ts";
import { get, has, repr, truthy, ValueError } from "./py.ts";

/** Channels an utterance can be delivered over. Drives TTS treatment: a phone
 *  line is band-limited on purpose so the listening practice matches the exam. */
export const SPOKEN_CHANNELS = ["in_person", "phone", "video"];

/** The stimulus is text on a page. Never synthesised — bjt/tts/plan.ts has no
 *  profile for it on purpose. It exists so a 定型表現 inside an email lands in a
 *  different weakness bucket from face-to-face 敬語, which is the whole point of
 *  the reading types. */
export const WRITTEN_CHANNEL = "written";

/** Every channel an item may carry. Spoken types constrain themselves to
 *  SPOKEN_CHANNELS through their own schema; the column accepts all four. */
export const CHANNELS = [...SPOKEN_CHANNELS, WRITTEN_CHANNEL];

export function _sceneField(description: string = ""): Record<string, any> {
  return {
    "type": "string",
    "description": description || (
      "Which reusable scene image this item is set in. Must be one of the " +
      "scene ids offered for this seed cell."
    ),
  };
}

export function _channelField(enumValues: string[]): Record<string, any> {
  return {
    "type": "string",
    "enum": enumValues,
    "description": "How the item reaches the listener. Must match the seed cell.",
  };
}

/** A multi-speaker exchange, for the types that play a conversation.
 *
 *  Turns carry a role rather than a name, for the same reason 発言聴解 options
 *  do: the role decides the voice, and a voice cast per item would have the
 *  learner doing speaker identification instead of listening to Japanese. */
export function _dialogueField(): Record<string, any> {
  return {
    "type": "array",
    "items": {
      "type": "object",
      "additionalProperties": false,
      "required": ["speaker_role", "text"],
      "properties": {
        "speaker_role": {
          "type": "string",
          "description": "Who is speaking, as a role (e.g. '営業課長'). Never a " +
          "personal name — roles drive voice casting.",
        },
        "text": { "type": "string", "description": "The turn, verbatim, as spoken." },
      },
    },
    "description": "The exchange the test-taker hears, in order. Between three and " +
    "eight turns, across two or three distinct speaker roles.",
  };
}

/** What a type adds to the core shape. */
export type TypeExtras = {
  stem_description?: string;
  required?: string[];
  properties?: Record<string, any>;
};

// Per-type additions to the core shape: what the stem means for this type, plus
// any extra required fields and their schema.
export const TYPE_EXTRAS: Record<string, TypeExtras> = {
  "goi_bunpou": {
    "stem_description": "The carrier sentence with the blank written as ＿＿＿.",
  },
  "hyougen": {
    "stem_description": "The situation, then the question, as the test-taker reads it.",
  },
  "hatsugen_choukai": {
    "stem_description": (
      "The situation as the narrator reads it aloud, ending with the question " +
      "（例:「…こんなとき、何と言いますか。」）. Two or three sentences. It must " +
      "name who the speaker is talking to and what they are trying to do, because " +
      "the test-taker hears it once and cannot re-read it."
    ),
    "required": ["scene_id", "speaker_role", "listener_role", "channel"],
    "properties": {
      "scene_id": {
        "type": "string",
        "description": "Which reusable scene image this item is set in. " +
        "Must be one of the scene ids offered for this seed cell.",
      },
      "speaker_role": {
        "type": "string",
        "description": "The role of the person speaking the options, e.g. '営業担当（若手）'. " +
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
  // 場面把握 — the situation is narrated and the question is about the
  // situation itself, so the options are statements ABOUT it rather than
  // things anyone says. Nothing here is spoken except the narration.
  "bamen_haaku": {
    "stem_description": (
      "What the narrator reads aloud: a short exchange or moment, then the question " +
      "（例:「ここはどこですか。」「このあと何をしますか。」）. The test-taker hears it " +
      "once, so it must contain every clue the question turns on."
    ),
    "required": ["scene_id", "channel"],
    "properties": {
      "scene_id": _sceneField(),
      "channel": _channelField(SPOKEN_CHANNELS),
    },
  },
  // 画像把握 — a picture is shown, and four descriptions of it are heard.
  // The picture is drawn from `image_brief` after the item is written, by
  // the scene job, and reviewed against these very options (bjt/scene_art).
  "gazou_haaku": {
    "stem_description": (
      "What the narrator asks about the picture, heard once （例:「男の人は何を" +
      "していますか。」「二人は何をしていますか。」）. One short sentence; it must " +
      "name who is being asked about when more than one person is drawn."
    ),
    "required": ["image_brief", "channel"],
    "properties": {
      "image_brief": {
        "type": "string",
        "description": (
          "The picture, in English, for an illustrator: 40-90 words, concrete " +
          "and complete — the place, how many people, who they are by role and " +
          "appearance, exactly what they are doing with their hands and bodies, " +
          "the objects involved, and what is deliberately NOT happening. Written " +
          "so that exactly one option is true of the drawing and each of the " +
          "other three is contradicted by something visible in it. No text, " +
          "signs, logos or real people."
        ),
      },
      "channel": _channelField(["in_person"]),
    },
  },
  // 総合聴解 — a conversation heard once, then a question about it.
  "sougou_choukai": {
    "stem_description": (
      "The question the narrator asks after the exchange has played （例:「この件は " +
      "誰が担当することになりましたか。」）, preceded by one sentence of setup if the " +
      "exchange needs it. The exchange itself goes in `dialogue`, not here."
    ),
    "required": ["scene_id", "channel", "dialogue"],
    "properties": {
      "scene_id": _sceneField(),
      "channel": _channelField(SPOKEN_CHANNELS),
      "dialogue": _dialogueField(),
    },
  },
  // 状況把握 — read what is posted, hear what is asked, choose the action.
  "joukyou_haaku": {
    "stem_description": (
      "What the narrator reads aloud: the situation and the spoken request, ending " +
      "with the question （例:「このあと、どうすればいいですか。」）. The document is " +
      "read, not heard, so do not describe its contents here."
    ),
    "required": ["scene_id", "channel", "document"],
    "properties": {
      "scene_id": _sceneField(),
      "channel": _channelField(SPOKEN_CHANNELS),
      "document": render.documentSchema(),
    },
  },
  // 資料聴読解 — a document on the page, a prompt in the ear.
  "shiryou_choudokkai": {
    "stem_description": (
      "What the narrator reads aloud: the spoken prompt, ending with the question. " +
      "The answer must require BOTH the document and this prompt — if either alone " +
      "settles it, the item is not testing this type."
    ),
    "required": ["channel", "document"],
    "properties": {
      "scene_id": _sceneField("Optional scene image, if the seed cell offers one."),
      "channel": _channelField(SPOKEN_CHANNELS),
      "document": render.documentSchema(),
    },
  },
  // 総合聴読解 — the exchange AND its documents; the answer is in neither alone.
  "sougou_choudokkai": {
    "stem_description": (
      "The question the narrator asks after the exchange has played. The exchange " +
      "goes in `dialogue` and the documents in `documents`."
    ),
    "required": ["channel", "dialogue", "documents"],
    "properties": {
      "scene_id": _sceneField("Optional scene image, if the seed cell offers one."),
      "channel": _channelField(SPOKEN_CHANNELS),
      "dialogue": _dialogueField(),
      "documents": {
        "type": "array",
        "items": render.documentSchema(),
        "description": "One or two documents the test-taker reads alongside the " +
        "exchange. Each uses a template offered by the seed cell.",
      },
    },
  },
  // 総合読解 — reading only. Never synthesised.
  "sougou_dokkai": {
    "stem_description": (
      "The question, as the test-taker reads it （例:「この後、山川さんがまずすべき " +
      "ことは何ですか。」）. The passage goes in `document`, not here."
    ),
    "required": ["document"],
    "properties": {
      "document": render.documentSchema(),
    },
  },
};

/** Which section of the exam each type belongs to. The database has the same
 *  table (public.item_types) and tests/plan.test.ts asserts the two agree;
 *  the planner reads this one because the nightly job runs with no database. */
export const SECTIONS: Record<string, string> = {
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
};

/** How many questions of this type the real exam asks, out of its 80.
 *
 *  第1部 聴解 25 (場面把握 5, 発言聴解 10, 総合聴解 10), 第2部 聴読解 25 (状況把握 5,
 *  資料聴読解 10, 総合聴読解 10), 第3部 読解 30 (語彙・文法 10, 表現読解 10,
 *  総合読解 10). Corroborated across the exam's own published structure and the
 *  endorsed publisher's workbooks; the 80 total and the 25/25/30 split are the
 *  firmest part, the per-sub-part counts the least firm, and both agree that
 *  **場面把握 and 状況把握 are half-size types**.
 *
 *  It is one fact used twice, which is why it is a table rather than two
 *  constants. The planner reads it to decide what to WRITE — a shelf is compared
 *  against its share rather than against every other shelf, so a five-question
 *  type is not filled to the depth of a ten-question one. The database has the
 *  same column (public.item_types.exam_questions) and the queue reads it to
 *  decide what to SERVE, so that a set of ten leans the way the exam does.
 *  tests/plan.test.ts asserts the two agree.
 *
 *  画像把握 is ours rather than the exam's — the closest thing to it is the
 *  picture half of 第1部 — so it is given the smallest non-zero share there is.
 *  What actually keeps it rare is plan.NIGHT_TYPE_CAPS; this only stops it
 *  looking like a ten-question type to the arithmetic. */
export const EXAM_QUESTIONS: Record<string, number> = {
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
};

/** The reading types: no audio, no picture, the cheapest item there is to
 *  ship, and the ones written on every night's run. */
export const READING_TYPES: readonly string[] = Object.entries(SECTIONS)
  .filter(([, sec]) => sec === "dokkai")
  .map(([t]) => t);

/** Which extra fields hold documents, per item type. Used by validation, by the
 *  TTS planner (a document is never spoken) and by the app. */
export const DOCUMENT_FIELDS: Record<string, string> = {
  "joukyou_haaku": "document",
  "shiryou_choudokkai": "document",
  "sougou_dokkai": "document",
  "sougou_choudokkai": "documents",
};

/** Types whose stimulus includes a multi-speaker exchange. */
export const DIALOGUE_TYPES: readonly string[] = ["sougou_choukai", "sougou_choudokkai"];

function extrasOf(itemType: string): TypeExtras {
  return has(TYPE_EXTRAS, itemType) ? TYPE_EXTRAS[itemType] : {};
}

/** A json_schema for `output_config.format`, specialised to one item type.
 *
 *  Constrains the role field to this item type's enum, so the model can't invent
 *  one, and folds in whatever extra fields the type declares. */
export function buildItemSchema(itemType: string): Record<string, any> {
  const roleValues = roles.roleEnum(itemType);
  const extras = extrasOf(itemType);

  const schema: Record<string, any> = {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "stem",
      "options",
      "explanation_ja",
      "explanation_en",
      "topic",
      "vocab_notes",
      ...(extras.required ?? []),
    ],
    "properties": {
      "stem": {
        "type": "string",
        "description": "The item stem exactly as the test-taker receives it. " +
        (extras.stem_description ?? ""),
      },
      "options": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["text", "role", "why"],
          "properties": {
            "text": { "type": "string" },
            "role": { "type": "string", "enum": roleValues },
            "why": {
              "type": "string",
              "description": "One sentence in Japanese naming the specific reason " +
              "THIS option fails (or, for the correct option, why it fits). Not a " +
              "restatement of the role label — the concrete thing that is wrong " +
              "with this exact wording in this exact situation.",
            },
          },
        },
        "description": "Exactly four options. Exactly one has role 'correct'; " +
        "the other three each carry a distinct distractor role from the enum.",
      },
      "topic": {
        "type": "string",
        "description": "A short label for the business scenario (e.g. '納期の連絡'). " +
        "Used to avoid repeating scenarios across items.",
      },
      "explanation_ja": {
        "type": "string",
        "description": "解説 in Japanese: why the answer is correct and why " +
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
          "additionalProperties": false,
          "required": ["term", "reading", "meaning"],
          "properties": {
            "term": { "type": "string" },
            "reading": { "type": "string" },
            "meaning": { "type": "string" },
          },
        },
        "description": "Business vocabulary worth noting from this item.",
      },
    },
  };
  Object.assign(schema["properties"], extras.properties ?? {});
  return schema;
}

/** Return a list of problems with a generated item (empty == valid).
 *
 *  Covers structure the schema can't (exactly-one-correct, distinct roles, a
 *  real per-option `why`) plus a few basic sanity checks. Level is validated
 *  separately when known. */
export function validateItem(itemType: string, item: Record<string, any>): string[] {
  const errors: string[] = [];

  const extras = extrasOf(itemType);
  for (const field of ["stem", "options", "explanation_ja", "explanation_en", "topic",
                       ...(extras.required ?? [])]) {
    if (!truthy(get(item, field))) {
      errors.push(`missing or empty field: ${field}`);
    }
  }

  const channel = get(item, "channel");
  if (channel !== null && channel !== undefined && !CHANNELS.includes(channel)) {
    errors.push(`channel ${repr(channel)} is not one of ${repr(CHANNELS)}`);
  }

  errors.push(..._documentErrors(itemType, item));
  errors.push(..._dialogueErrors(itemType, item));

  const options = get(item, "options");
  if (!Array.isArray(options)) {
    errors.push("options must be a list");
    return errors;  // nothing else is checkable
  }

  options.forEach((opt: unknown, i: number) => {
    if (!isDict(opt) || !truthy(get(opt, "text")) || !truthy(get(opt, "role"))) {
      errors.push(`option ${i} missing text or role`);
      return;
    }
    // The per-option reason is the whole point of the role system: without it
    // the app has nothing specific to show after a wrong answer.
    if (!truthy(get(opt, "why"))) {
      errors.push(`option ${i} missing why`);
    }
  });

  errors.push(...roles.validateRoles(itemType, options));

  // Options must be distinct strings — duplicated text is a giveaway/bug.
  const texts = options.filter(isDict).map((o) => get(o, "text"));
  if (new Set(texts).size !== texts.length) {
    errors.push("options contain duplicate text");
  }

  return errors;
}

/** `isinstance(v, dict)` for parsed JSON. */
function isDict(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** A conversation with two turns is not a conversation, and one with twelve is a
 *  memory test rather than a listening test. Both ends are enforced, and they
 *  are the bounds the model is told (the dialogue schema's description above). */
export const DIALOGUE_MIN_TURNS = 3;
export const DIALOGUE_MAX_TURNS = 8;

/** At most this many documents per item. Two is already a lot to hold on a
 *  phone screen; three would be testing scrolling. */
export const MAX_DOCUMENTS = 2;

/** An item's document stimulus, always as a list.
 *
 *  The generator's schema calls it `document` for the three types that have one
 *  and `documents` for the one type that has two. Everything that reads a
 *  document rather than validating it — the bundle, the sanity check — would
 *  rather deal with one shape than with that distinction, so the translation
 *  lives here once instead of in each of them. */
export function documentsOf(item: Record<string, any>): Record<string, any>[] {
  const itemType = get(item, "item_type", "");
  const field = typeof itemType === "string" && has(DOCUMENT_FIELDS, itemType) ? DOCUMENT_FIELDS[itemType] : null;
  if (field === null) {
    return [];
  }
  const value = get(item, field);
  if (Array.isArray(value)) {
    return value.filter(isDict);
  }
  return isDict(value) ? [value] : [];
}

/** Validate whatever documents this item type carries.
 *
 *  The structured-output schema constrains a document's shape, but not that its
 *  table rows match its header or that it carries the header fields its
 *  template promises — that lives in bjt/render, and this is where it is run. */
export function _documentErrors(itemType: string, item: Record<string, any>): string[] {
  const field = has(DOCUMENT_FIELDS, itemType) ? DOCUMENT_FIELDS[itemType] : null;
  if (field === null) {
    return [];
  }

  const value = get(item, field);
  let docs: unknown[];
  if (field === "document") {
    if (!isDict(value)) {
      return [`${field} must be an object`];
    }
    docs = [value];
  } else {
    if (!Array.isArray(value) || value.length === 0) {
      return [`${field} must be a non-empty list`];
    }
    if (value.length > MAX_DOCUMENTS) {
      return [`${value.length} documents; at most ${MAX_DOCUMENTS} fit on a phone screen`];
    }
    docs = value;
  }

  const errors: string[] = [];
  docs.forEach((doc, i) => {
    const prefix = field === "document" ? `${field}` : `${field}[${i}]`;
    for (const e of render.validateDocument(doc)) errors.push(`${prefix}: ${e}`);
  });
  return errors;
}

/** A dialogue has to be long enough to carry a question and short enough to
 *  hold in your head, and it has to have more than one person in it — a
 *  'conversation' with one speaker is a monologue with extra formatting. */
export function _dialogueErrors(itemType: string, item: Record<string, any>): string[] {
  if (!DIALOGUE_TYPES.includes(itemType)) {
    return [];
  }

  const turns = get(item, "dialogue");
  if (!Array.isArray(turns)) {
    return ["dialogue must be a list"];
  }
  if (!(DIALOGUE_MIN_TURNS <= turns.length && turns.length <= DIALOGUE_MAX_TURNS)) {
    return [
      `dialogue has ${turns.length} turn(s); expected ` +
      `${DIALOGUE_MIN_TURNS}-${DIALOGUE_MAX_TURNS}`,
    ];
  }

  const errors: string[] = [];
  const speakers = new Set<unknown>();
  turns.forEach((turn: unknown, i: number) => {
    if (!isDict(turn) || !truthy(get(turn, "speaker_role")) || !truthy(get(turn, "text"))) {
      errors.push(`dialogue turn ${i} is missing speaker_role or text`);
      return;
    }
    speakers.add(turn["speaker_role"]);
  });
  if (speakers.size < 2 && errors.length === 0) {
    errors.push(`dialogue has only one speaker (${repr(speakers)}); it needs at least two`);
  }
  return errors;
}

/** Position of the option whose role is 'correct'. */
export function correctIndex(options: Record<string, any>[]): number {
  for (let i = 0; i < options.length; i++) {
    if (get(options[i], "role") === roles.CORRECT) {
      return i;
    }
  }
  throw new ValueError("no correct option found");
}

export function validLevel(level: string): boolean {
  return LEVELS.includes(level);
}
