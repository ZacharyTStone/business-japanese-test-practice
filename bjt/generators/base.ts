/**
 * Shared generator machinery.
 *
 * One generator per item type (subclass), each with its own prompt and few-shot
 * set — never a single generic "generate a BJT question" function with a type
 * parameter, because the item shapes differ too much and quality collapses when
 * they share a prompt.
 *
 * The base handles everything type-independent: loading licensed few-shot examples
 * from seeds/, assembling the role spec and level descriptor, handing the model one
 * seed-table cell to write about, feeding recent topics back as a do-not-repeat
 * list, validating against the schema, retrying with the validation errors
 * appended, and shuffling option order so the correct answer is never positionally
 * predictable.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import * as batchmod from "../batch.ts";
import * as config from "../config.ts";
import type { Store } from "../db/store.ts";
import * as levels from "../levels.ts";
import * as llm from "../llm.ts";
import * as phrasebook from "../phrasebook.ts";
import { floatRepr, get, has, KeyError, len, repr, rstrip, str, strip, truthy, ValueError } from "../py.ts";
import { dumps } from "../pyjson.ts";
import { Random } from "../pyrandom.ts";
import * as render from "../render/index.ts";
import * as schemas from "../schemas.ts";
import type { Cell } from "../seedtable.ts";
import * as naturalness from "../fidelity/naturalness.ts";
import * as roles from "../fidelity/roles.ts";

/** An item as the model writes it and the pipeline passes it on: plain JSON. */
export type Item = Record<string, any>;

/** What a relation means when its label cannot carry all of it. Almost every
 *  label can: 部下 → 上司 says everything a writer needs. ウチ/ソト cannot, because
 *  the person the item turns on is neither of the two people talking — it is the
 *  one being talked about — and a model shown only the arrow writes an ordinary
 *  社外 item in which nobody from the speaker's own side is mentioned at all.
 *  The relation exists so a batch can aim at that on purpose. */
export const RELATION_NOTES: Record<string, string> = {
  "uchi_to_soto": (
    "関係 is ウチ/ソト: the speaker is addressing someone outside the company — a "
    + "client, a visitor, a customer — ABOUT someone inside it, usually their own "
    + "superior. Toward an outsider one's own people are ウチ: named without a title "
    + "or さん, given no 尊敬語, what they do said in 謙譲語 （「部長の田中は外出して"
    + "おります」「田中がよろしくと申しておりました」, never 「田中部長はお出かけに"
    + "なっています」）. Put that colleague at the centre of what has to be said — "
    + "their absence, their message, their apology, their regards — so that the item "
    + "turns on how they are referred to."
  ),
};

/** The note for this cell's relation, or "" for the ones whose label says it. */
export function relationNote(cell: Cell | null): string {
  return get(RELATION_NOTES, cell?.relation ?? "", "");
}

/** A cell spec with its relation's note after it, when the relation has one.
 *  Every `cellSpec` ends here, so a relation that needs saying is said to
 *  every type whose table offers it. */
export function withRelationNote(spec: string, cell: Cell | null): string {
  const note = relationNote(cell);
  return note ? `${spec}\n${note}` : spec;
}

/** Load a licensed seed file, e.g. seeds/fewshot/goi_bunpou.json. Missing
 *  files return [] — the caller decides how loudly to complain. */
export function loadSeedJson(subdir: string, itemType: string): Item[] {
  return _loadSeed(subdir, itemType);
}

/** `loadSeedJson`, with a reviver for the one caller that writes the
 *  examples back out (`_fewshotBlock`). */
function _loadSeed(
  subdir: string, itemType: string, reviver?: (key: string, value: unknown, context?: { source?: string }) => unknown,
): Item[] {
  const p = path.join(config.SEEDS_DIR, subdir, `${itemType}.json`);
  if (!existsSync(p)) {
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(p, "utf8"), reviver);
  } catch (e) {
    // (json.JSONDecodeError, OSError): a body that is not JSON, or a file
    // the system will not give us (an OS error carries its errno code).
    if (e instanceof SyntaxError || (e instanceof Error && typeof (e as NodeJS.ErrnoException).code === "string")) {
      return [];
    }
    throw e;
  }
  return Array.isArray(data) ? data : [];
}

// Python reads a number written with a point or an exponent as a float and
// writes a whole one back as `120.0`; JavaScript has one number type, and
// `dumps` would write `120`. A few-shot file is whatever its author wrote, so
// `_fewshotBlock` reads it with every whole float marked (a string `dumps`
// writes as it is) and puts the float back in the text it wrote.
const _NUL = String.fromCharCode(0);
const _FLOAT_MARK = `${_NUL}pyfloat:`;
const _MARKED_FLOAT = /"\\u0000pyfloat:([^"\\]*)\\u0000"/g;

function _markFloats(key: string, value: unknown, context?: { source?: string }): unknown {
  if (typeof value === "number" && Number.isInteger(value) && /[.eE]/.test(context?.source ?? "")) {
    return `${_FLOAT_MARK}${floatRepr(value)}${_NUL}`;
  }
  return value;
}

function _unmarkFloats(text: string): string {
  return text.replace(_MARKED_FLOAT, "$1");
}

/** `d[key]` on a plain object: a missing key is a KeyError, as in Python. */
export function _getitem<T>(d: Record<string, T>, key: string): T {
  if (!has(d, key)) {
    throw new KeyError(repr(key));
  }
  return d[key];
}

export class Generator {
  item_type: string = "";
  /** One-line label shown in the CLI. */
  label: string = "";
  /** Type-specific guidance appended to the system prompt. */
  task_spec: string = "";
  /** When true, generation refuses to run without a seed-table cell. Types that
   *  get their variety from the table rather than from the prompt set this, so
   *  nobody can accidentally fall back to "write me a varied item". */
  requires_cell: boolean = false;

  store: Store | null;

  constructor(opts: { store?: Store | null } = {}) {
    this.store = opts.store ?? null;
  }

  // -- prompt assembly ---------------------------------------------------

  _roleSpec(): string {
    const lines = _getitem(roles.DISTRACTOR_ROLES, this.item_type).map(
      (r) => `- ${r}: ${_getitem(roles.ROLE_DESCRIPTIONS, r)}`,
    );
    return (
      "Every wrong option must be wrong for a specific, nameable reason drawn "
      + "from this fixed set of distractor roles. Write exactly FOUR options: the "
      + "correct one and three distractors with three DISTINCT roles (do not reuse a "
      + "role). The set below has more roles than that, so at least one goes unused "
      + "— never write one option per role. Mark the correct option with role "
      + "'correct'. Every option also carries a `why`: one Japanese sentence naming "
      + "the concrete reason THIS wording fails here — not a restatement of the role "
      + "label.\n" + lines.join("\n") + "\n\n"
      // The answerability gate's cold side shows a strong reader the four
      // options with the stem withheld and discards the item if the key
      // can be picked anyway. A distractor that is wrong on its own — a
      // malformed conjugation, a phrase nobody says — leaves the key as
      // the one option that reads well. Saying so here is the cheapest
      // fix there is, and it is exactly what the gate tests.
      + "The four options, read on their own with the situation hidden, must "
      + "look equally plausible: every distractor must be a real, well-formed "
      + "expression a native speaker would use in SOME other business situation, "
      + "and wrong only for this one. A distractor that is ungrammatical, "
      + "misspelled, or awkward in isolation gives the answer away and fails "
      + "review. The difficulty must live in the situation, never in the options."
    );
  }

  _fewshotBlock(): string {
    const examples = _loadSeed("fewshot", this.item_type, _markFloats);
    if (examples.length === 0) {
      return "";
    }
    const rendered: string[] = [];
    for (const ex of examples.slice(0, 5)) {
      rendered.push(_unmarkFloats(dumps(ex, { ensureAscii: false, indent: 2 })));
    }
    return (
      "Here are reference examples in the exact target style, including the "
      + "official 解説 that explains why each distractor fails. Match this item "
      + "shape and this quality of explanation — do not copy their content:\n\n"
      + rendered.join("\n\n")
    );
  }

  /**
   * How long an item of this type is on the real paper.
   *
   * Read from the same table the offline check measures against
   * (`batch.LENGTH_BANDS`), so the instruction and the check cannot disagree
   * — and so that re-calibrating the exam's shapes moves both at once.
   *
   * Length is worth spending prompt on because it is most of what makes an
   * item feel like the exam rather than like a textbook exercise, and it is
   * the part a model gets wrong by default in a consistent direction: asked
   * for a business reading passage it writes two hundred characters where
   * the paper sets seven hundred, and asked for four options it writes four
   * sentences where the paper prints four words.
   */
  _lengthSpec(): string {
    const bands = get(batchmod.LENGTH_BANDS, this.item_type) as Record<string, [number, number]> | null;
    if (!truthy(bands)) {
      return "";
    }
    const names: Record<string, string> = {
      "stem": "the stem (`stem`)",
      "option": "each option",
      "document": "all the documents together",
    };
    const lines = Object.entries(bands!).map(
      ([f, [low, high]]) => `- ${get(names, f, f)}: ${low}–${high} characters`,
    );
    return (
      "Length, in Japanese characters, as the real paper sets it. These are "
      + "the ranges an item of this type falls in; write to them rather than to "
      + "whatever length the content happens to come out at, because length is "
      + "most of what makes an item feel like the exam:\n" + lines.join("\n")
    );
  }

  /** Fold the judge's most recent tells back into the prompt as explicit
   *  constraints — this is what closes the discriminator loop (fidelity #3). */
  _discriminatorConstraints(): string {
    if (this.store === null) {
      return "";
    }
    const tells = this.store.latestTells(this.item_type);
    if (tells.length === 0) {
      return "";
    }
    const lines = tells.map((t) => `- ${t}`).join("\n");
    return (
      "A judge recently distinguished synthetic items from official ones using "
      + "the tells below. Write this item so none of them apply — make it "
      + "indistinguishable from an official item:\n" + lines
    );
  }

  /** Render the seed cell as a hard assignment. Overridden by types that
   *  need to say more about their cell (scenes, channel, and so on). */
  cellSpec(cell: Cell): string {
    return withRelationNote(
      "Write this item for the following assigned situation. These are "
      + "requirements, not suggestions — do not substitute a different "
      + "setting, relationship, or communicative function:\n"
      + `- 場面: ${cell.setting_ja}\n`
      + `- 関係: ${cell.relation_ja}\n`
      + `- 機能（この発話でしたいこと）: ${cell.function_ja}`,
      cell,
    );
  }

  systemPrompt(level: string): string {
    const parts = [
      "You are an item writer for the BJT ビジネス日本語能力テスト "
      + "(Business Japanese Proficiency Test). You write a single "
      + `${this.label} item.`,
      this.task_spec,
      this._roleSpec(),
      // Right after the roles, because most of it is about how a
      // distractor may be wrong. The principle in the role spec does not
      // hold on its own: asked for an over-polite distractor, a model
      // invents a keigo stack.
      naturalness.PROMPT,
      `Target level: ${level}. Calibrate difficulty to this descriptor:\n`
      + `${levels.descriptor(level)}`,
      "Write the 解説 (explanation) in Japanese: state why the answer is correct "
      + "and why each distractor fails, naming the failure. Add a one-line English "
      + "gloss. List any business vocabulary worth noting.",
      "Return only the structured JSON object.",
    ];
    const lengths = this._lengthSpec();
    if (lengths) {
      // After the task spec and the role spec, before the level: it is a
      // constraint on the shape rather than on the difficulty.
      parts.splice(3, 0, lengths);
    }
    const fs = this._fewshotBlock();
    if (fs) {
      parts.splice(2, 0, fs);
    }
    // For the spoken types only: the stock lines in the one wording the
    // library already has a voice for (bjt/phrasebook.ts).
    const stock = phrasebook.promptBlock(this.item_type);
    if (stock) {
      parts.splice(parts.length - 1, 0, stock);
    }
    const constraints = this._discriminatorConstraints();
    if (constraints) {
      parts.splice(parts.length - 1, 0, constraints); // just before the "return only JSON" line
    }
    return parts.join("\n\n");
  }

  userPrompt(
    level: string,
    avoidTopics: string[],
    opts: { cell?: Cell | null; feedback?: string | null } = {},
  ): string {
    const cell = opts.cell ?? null;
    const feedback = opts.feedback ?? null;
    const u = [`Write one ${this.label} item at level ${level}.`];
    if (cell !== null) {
      u.push(this.cellSpec(cell));
    }
    if (avoidTopics.length > 0) {
      const joined = [...new Set(avoidTopics)].join("、"); // de-dup, keep order
      u.push(
        "Do NOT reuse any of these recently used business scenarios; pick a "
        + `clearly different one:\n${joined}`,
      );
    }
    if (feedback) {
      // What review said about the last draft for this shelf. A generator
      // that is wrong about a type is wrong about it all night unless it
      // is told; this is the one sentence that tells it, and it costs a
      // few tokens on the uncached half of the prompt.
      u.push(
        "The previous item written for this shelf tonight was REJECTED by "
        + `review: ${feedback}. Write this one so that cannot happen.`,
      );
    }
    return u.join("\n\n");
  }

  // -- validation hook ---------------------------------------------------

  /** Type-specific checks beyond the shared schema. Default: none. */
  validateExtra(item: Item, opts: { cell?: Cell | null } = {}): string[] {
    return [];
  }

  // -- generation --------------------------------------------------------

  async generate(
    opts: {
      level?: string | null;
      cell?: Cell | null;
      maxAttempts?: number;
      seed?: number | null;
      feedback?: string | null;
    } = {},
  ): Promise<Item> {
    let level = opts.level ?? null;
    const cell = opts.cell ?? null;
    const maxAttempts = opts.maxAttempts ?? 3;
    const seed = opts.seed ?? null;
    const feedback = opts.feedback ?? null;
    if (cell !== null) {
      level = cell.level;
    }
    if (this.requires_cell && cell === null) {
      throw new ValueError(
        `${this.item_type} requires a seed-table cell; variety for this type `
        + "comes from the table, not from the prompt (see bjt/seedtable.py)",
      );
    }
    if (level === null || !schemas.validLevel(level)) {
      throw new ValueError(`invalid level ${repr(level)}`);
    }

    let avoid: string[] = [];
    if (this.store !== null) {
      avoid = this.store.recentTopics(this.item_type, config.RECENT_TOPICS_WINDOW);
    }

    const schema = schemas.buildItemSchema(this.item_type);
    const system = this.systemPrompt(level);
    const user = this.userPrompt(level, avoid, { cell, feedback });

    let lastErrors: string[] = [];
    for (let _attempt = 0; _attempt < maxAttempts; _attempt++) {
      let prompt = user;
      if (lastErrors.length > 0) {
        prompt = (
          user
          + "\n\nThe previous attempt was rejected for these reasons — fix them:\n"
          + lastErrors.map((e) => `- ${e}`).join("\n")
        );
      }
      const item = await llm.generateStructured(system, prompt, schema);
      // The model's output does not name its own type — the schema has
      // no item_type field — and everything below that looks a document
      // up by type (documentsOf, and through it the pruning) reads
      // item["item_type"]. Stamp it first, or the pruning below finds no
      // document and every blank callout costs the full three attempts.
      item["item_type"] = this.item_type;
      // Every block field is required, so the unused ones arrive empty;
      // take them off first. Then a blank heading or callout is a model
      // tic, not a fault in the item; drop it rather than spend an
      // attempt asking for it back.
      for (const doc of schemas.documentsOf(item)) {
        render.dropUnusedFields(doc);
        render.pruneEmptyBlocks(doc);
      }
      // Numbers spelled out in kanji are the same kind of tic and get the
      // same answer: rewritten here rather than costing the draft, and
      // rewritten *before* the gate, the proofreader and the
      // discriminator see it, so all three judge the item as it will
      // ship. `toBundleItem` does this too — this is the copy that
      // makes the fidelity checks honest.
      batchmod.normaliseNumerals(item);
      repairSurplusOptions(item);
      const errors = schemas.validateItem(this.item_type, item);
      errors.push(...this.validateExtra(item, { cell }));
      // The tells a pattern can see — invented keigo, a placeholder, a
      // bracket in something heard, a narration that says the answer —
      // cost a retry here rather than a proofreader's call, and the
      // retry is told which line and why.
      errors.push(...naturalness.faults(item));
      if (errors.length === 0) {
        return this._finalize(item, level, seed, { cell });
      }
      lastErrors = errors;
    }

    throw new llm.LLMError(
      `could not produce a valid ${this.item_type} item in ${maxAttempts} attempts; `
      + `last errors: ${repr(lastErrors)}`,
    );
  }

  /** Shuffle option order so the correct answer is not positionally
   *  predictable, and stamp the level and the cell it came from. */
  _finalize(item: Item, level: string, seed: number | null, opts: { cell?: Cell | null } = {}): Item {
    const cell = opts.cell ?? null;
    const rng = new Random(seed);
    const options = [..._getitem(item, "options") as unknown[]];
    rng.shuffle(options);
    item["options"] = options;
    item["level"] = level;
    item["item_type"] = this.item_type;
    if (cell !== null) {
      item["seed_cell"] = cell.toDict();
    }
    return item;
  }
}

/** A plain JSON object (Python's `isinstance(x, dict)`). */
function _isDict(x: unknown): x is Item {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/**
 * Trim a draft with more than four options down to four, in place.
 *
 * A fifth option is the one schema fault the structured-output schema cannot
 * forbid (the API's JSON-schema subset has no `maxItems`), and regenerating
 * for it costs a whole generation per occurrence. The surplus is always a
 * spare distractor: keep the correct option and the first three distractors
 * with distinct roles, drop the rest, and let the ordinary validation and the
 * gate judge what is left. Returns the texts dropped, for the log. A draft
 * with fewer than four options, or with no single correct one, is left alone
 * for the validator to reject.
 *
 * The 解説 was written about all five, so the sentences that quote a dropped
 * option go with it (`dropSentencesAbout`). Left in, they described an
 * option the item no longer has, the proofreader rejected the draft as
 * `explanation_mismatch`, and the trim saved nothing: 表現読解 J3 lost every
 * draft that way on 2026-09-28 and 2026-10-01.
 */
export function repairSurplusOptions(item: Item): string[] {
  const options = get(item, "options");
  if (!Array.isArray(options) || options.length <= 4) {
    return [];
  }
  const correct = options.filter((o) => _isDict(o) && get(o, "role") === roles.CORRECT);
  if (correct.length !== 1) {
    return [];
  }
  const kept: unknown[] = [correct[0]];
  const seenRoles = new Set<unknown>();
  const dropped: string[] = [];
  for (const o of options) {
    if (o === correct[0]) {
      continue;
    }
    const role = _isDict(o) ? get(o, "role") : null;
    if (kept.length < 4 && truthy(role) && !seenRoles.has(role)) {
      kept.push(o);
      seenRoles.add(role);
    } else {
      dropped.push(_isDict(o) ? str(get(o, "text", "")) : str(o));
    }
  }
  // Keep the model's own order for what survives.
  item["options"] = options.filter((o) => kept.some((k) => o === k));
  const keptTexts = kept.filter(_isDict).map((o) => str(get(o, "text", "")));
  for (const field of ["explanation_ja", "explanation_en"]) {
    if (typeof get(item, field) === "string") {
      item[field] = dropSentencesAbout(item[field], dropped, keptTexts);
    }
  }
  return dropped;
}

// Python's `\s` (what `str.isspace()` says is whitespace), which is wider than
// JavaScript's: written out so the two split at the same characters.
const _PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

/** Quotation marks a 解説 quotes an option in: 「」『』 and the double quotes. */
export const _QUOTED = /「([^」]+)」|『([^』]+)』|“([^”]+)”|"([^"]+)"/gu;
/** One sentence with its own ending and the space after it: up to 。！？, to
 *  .!? before a space (so 1.5 stays whole), or to a line break. The pieces
 *  join back into exactly the text they came from. */
export const _SENTENCE = new RegExp(`.+?(?:[。！？]+|[.!?]+(?=[${_PY_WS}]|$)|\\n|$)[${_PY_WS}]*`, "gsu");

/** `_SENTENCE.findall(text)`: every sentence of `text`, in order. */
export function _sentences(text: string): string[] {
  return text.match(_SENTENCE) ?? [];
}

export function _bare(text: string): string {
  return strip(rstrip(strip(text), "。．.！!？?"));
}

/**
 * `text` without the sentences that quote a dropped option.
 *
 * A sentence goes if it quotes something found in a dropped option and in no
 * kept one — a 解説 often quotes a fragment （「遅れられまして」）, not the whole
 * line — or carries a dropped option whole. Everything else stays, in order.
 * If that would leave nothing, the text is returned as it was, for the
 * proofreader to judge.
 */
export function dropSentencesAbout(text: string, dropped: string[], kept: string[]): string {
  const gone = dropped.filter((d) => _bare(d)).map((d) => _bare(d));
  if (gone.length === 0) {
    return text;
  }
  const keep = kept.map((k) => _bare(k));

  const aboutDropped = (sentence: string): boolean => {
    for (const match of sentence.matchAll(_QUOTED)) {
      const quote = _bare(match.slice(1).find((g) => g)!);
      if (len(quote) >= 2 && gone.some((d) => d.includes(quote)) && !keep.some((k) => k.includes(quote))) {
        return true;
      }
    }
    return gone.some((d) => sentence.includes(d));
  };

  const sentences = _sentences(text);
  const survivors = sentences.filter((s) => !aboutDropped(s));
  if (survivors.length === sentences.length || !survivors.some((s) => strip(s))) {
    return text;
  }
  return strip(survivors.join(""));
}
