/**
 * Batch generation and the bundle format.
 *
 * Items are never generated while somebody is practising. Generation is a batch job
 * run here, on a laptop, against a seed table; what ships is a plain JSON bundle
 * plus an audio manifest. That is the whole reason the running cost of the app is
 * zero, and it is also why the quality gates can afford to be expensive — they run
 * once per item, offline, before anything is published.
 *
 * A bundle is self-contained and app-facing: it carries the items with their
 * answers and 解説, the clip ids the audio files will be named after, and the scene
 * ids the images come from.
 *
 * `checkBundle` is the part that runs without an API key. It catches the
 * failures that survive a per-item gate but only show up across a batch — the same
 * question asked twice, the answer drifting to position C, the correct option being
 * the longest one every time. That last pair matter more than they look: they are
 * how a test-taker learns to score without understanding anything.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as config from "./config.ts";
import { unreadable, writeAtomic } from "./files.ts";
import * as dedupe from "./fidelity/dedupe.ts";
import * as naturalness from "./fidelity/naturalness.ts";
import * as roles from "./fidelity/roles.ts";
import {
  deepcopy, errText, fixed, FileNotFoundError, get, getitem, has, IndexError, isDict, isoformatUtc, KeyError, len, max, min, or,
  percent, repr, sorted, str, truthy, utf8, ValueError, zip,
} from "./py.ts";
import { BUNDLE_FLOAT_KEYS, dumps, loads } from "./pyjson.ts";
import * as document from "./render/document.ts";
import * as numerals from "./render/numerals.ts";
// scenes.ts imports this module to read the bundles; the cycle is safe because
// neither uses the other while it is being loaded.
import * as scenes from "./scenes.ts";
import * as schemas from "./schemas.ts";
import * as seedtable from "./seedtable.ts";
import * as tts_plan from "./tts/plan.ts";
import * as withdrawn from "./withdrawn.ts";

/** An item or a bundle: plain JSON data. */
type Item = Record<string, any>;
type Bundle = Record<string, any>;

/** The bundle format: audio clip ids filed by role (`narration` / `options` /
 *  `dialogue`), and items that may carry `documents` and `dialogue`. Older
 *  bundles are not read anywhere: the source files are the authority, so a
 *  format change means re-running `importbatch`, not a compatibility path. */
export const BUNDLE_VERSION = 2;

/** A listening stem is heard once. Shorter than this and it cannot have set up a
 *  situation; longer and the test-taker is being tested on memory. */
export const STEM_MIN_CHARS = 20;
export const STEM_MAX_CHARS = 140;

/** How long the exam's own questions are, per type and per part, in characters.
 *
 *  An item can be correct, answerable, un-leaky and still not feel like the
 *  exam, and length is most of the difference. The 語彙・文法 options on the real
 *  paper are two to six characters — 「こそ／のみ／だけ／まで」, 「使いきり／使いはじめ／
 *  使いよう／使いづくめ」 — so a set of fifteen-character options has drifted into
 *  表現読解 whatever else is right about it. A 総合読解 passage is described by the
 *  level guide as two to three minutes of reading, which is four hundred to nine
 *  hundred characters; under three hundred, the type becomes a comprehension
 *  question rather than the sustained read it is.
 *
 *  `stem` is measured on OUR stem field, which is not always the exam's question:
 *  for the narrated types it carries the whole narration, so those bands are
 *  wider than the published question lengths. `document` is the rendered text of
 *  every document on the item together.
 *
 *  These are bands, not rules, and they report as `note` rather than `warn` —
 *  see `Check.status`. Provenance: the exam's published sample material and the
 *  endorsed publisher's workbooks, read at second hand (the official pages could
 *  not be fetched directly), so treat them as a calibration to re-measure rather
 *  than as a specification. */
export const LENGTH_BANDS: Record<string, Record<string, [number, number]>> = {
  // 第1部 聴解 — heard once, so the narration carries the whole situation.
  "bamen_haaku":        { "stem": [50, 160], "option": [6, 30] },
  "gazou_haaku":        { "stem": [8, 40], "option": [8, 30] },
  "hatsugen_choukai":   { "stem": [STEM_MIN_CHARS, STEM_MAX_CHARS], "option": [8, 45] },
  "sougou_choukai":     { "stem": [12, 45], "option": [5, 35] },
  // 第2部 聴読解 — a document on screen and a prompt in the ear. 資料聴読解's
  // options are the document's own field labels on the real paper, which is
  // why its band is so much shorter than the others'.
  "joukyou_haaku":      { "stem": [50, 160], "option": [5, 50], "document": [80, 320] },
  "shiryou_choudokkai": { "stem": [40, 150], "option": [2, 20], "document": [80, 320] },
  "sougou_choudokkai":  { "stem": [12, 45], "option": [4, 45], "document": [80, 400] },
  // 第3部 読解 — nothing is heard. 語彙・文法 is a blank and four short fillers;
  // 総合読解 is the long one, and the only type on the paper that is.
  "goi_bunpou":         { "stem": [20, 60], "option": [1, 10] },
  "hyougen":            { "stem": [35, 110], "option": [8, 32] },
  "sougou_dokkai":      { "stem": [15, 45], "option": [8, 40], "document": [350, 950] },
};

/** Stable id: derived from the seed cell, so regenerating a cell replaces its
 *  item rather than adding a second copy. */
export function itemId(item: Item): string {
  const key = or(get(or(get(item, "seed_cell"), {}), "id"), get(item, "stem", ""));
  return createHash("sha1").update(utf8(`${str(get(item, "item_type", ""))}|${str(key)}`)).digest("hex").slice(0, 10);
}

/**
 * Make every printed part of a document item agree with its document about
 * how a number is written. Returns how many strings moved.
 *
 * `bjt/render/numerals.ts` says why a 資料 sets its numbers in Arabic digits.
 * The document alone is not enough, because the learner is not reading the
 * document alone: 資料聴読解 asks for a figure off a table and offers 「七十点」
 * as an answer, and a table reading 70点 beside an option reading 七十点 makes
 * the learner convert between two notations to do a task that is supposed to
 * be about reading Japanese. So the rule is the screen, not the file — the
 * document, the printed options, the printed stem and the 解説 all follow the
 * document's style.
 *
 * **What is left alone, and why.** Anything `bjt/tts/plan.ts` synthesises: the
 * narrated stem of the three 聴読解 types, the spoken options of 第1部, a
 * dialogue's turns. A clip id hashes its text, so rewriting a number the
 * narrator reads would orphan a clip that is already live, and a live clip is
 * never re-made. Nothing is lost by it either — spoken text is never on the
 * screen to disagree with anything.
 *
 * Types with no document (語彙・文法, 表現読解, and the 聴解 types) are out of
 * scope altogether. Their options are utterances and word choices rather than
 * figures read off a page, 「十二台」 against 「十二枚」 is the question being
 * asked in one of them, and no table is beside them to contradict.
 */
export function normaliseNumerals(item: Item): number {
  if (schemas.documentField(get(item, "item_type", "")) === null) {
    return 0;
  }
  const spoken = tts_plan.audioPolicy(getitem(item, "item_type"));
  let moved = 0;
  // Rewrite one string in place, counting it if it changed.
  const rewrite = (obj: Item, key: string) => {
    const before = obj[key];
    obj[key] = numerals.toArabicText(before);
    moved += Number(obj[key] !== before);
  };

  for (const doc of schemas.documentsOf(item)) {
    moved += numerals.toArabic(doc);
  }

  if (!truthy(spoken.stem) && truthy(get(item, "stem"))) {
    rewrite(item, "stem");
  }

  if (!truthy(spoken.options)) {
    for (const option of or(get(item, "options"), []) as Item[]) {
      for (const key of ["text", "why"]) {
        if (typeof get(option, key) === "string") rewrite(option, key);
      }
    }
  }

  for (const key of ["explanation_ja", "explanation_en"]) {
    if (typeof get(item, key) === "string") rewrite(item, key);
  }

  return moved;
}

/** One item in app-facing shape: answer resolved to an index, audio clip ids
 *  attached, documents normalised to a list, our internal metrics left out. */
export function toBundleItem(item: Item): Item {
  // The one funnel every item passes through on its way into a bundle, whether
  // a generator wrote it or a person hand-wrote a `.source.json`. Copied first
  // because the numeral pass rewrites strings and the caller's item is not
  // ours to edit; the clip ids below are unaffected, since what it rewrites is
  // by definition the text nothing synthesises.
  item = deepcopy(item);
  normaliseNumerals(item);
  const iid = itemId(item);
  const clips = tts_plan.planItem(item, iid);
  const byKind = new Map<string, tts_plan.Clip[]>();
  for (const clip of clips) {
    if (!byKind.has(clip.kind)) byKind.set(clip.kind, []);
    byKind.get(clip.kind)!.push(clip);
  }
  const narration = or(byKind.get("narration") ?? null, []) as tts_plan.Clip[];
  const options = getitem(item, "options") as Item[];
  const out: Item = {
    "id": iid,
    "item_type": get(item, "item_type"),
    "level": get(item, "level"),
    "seed_cell": get(item, "seed_cell"),
    "topic": get(item, "topic", ""),
    "stem": getitem(item, "stem"),
    "options": options.map((o) => ({ "text": getitem(o, "text"), "role": getitem(o, "role"), "why": get(o, "why", "") })),
    "correct_index": schemas.correctIndex(options),
    "explanation_ja": get(item, "explanation_ja", ""),
    "explanation_en": get(item, "explanation_en", ""),
    "vocab_notes": get(item, "vocab_notes", []),
    // Clip ids by role rather than by position. "Narration first, options
    // after" is not true of most types: a dialogue type would have its turns
    // filed as options, and a reading type has no clips at all to take a
    // first element from.
    "audio": {
      "narration": narration.length ? narration[0].clip_id : null,
      "options": (byKind.get("option") ?? []).map((c) => c.clip_id),
      "dialogue": (byKind.get("dialogue") ?? []).map((c) => c.clip_id),
    },
  };

  const documents = schemas.documentsOf(item);
  if (documents.length) {
    out["documents"] = documents;
  }

  const turns = get(item, "dialogue");
  if (truthy(turns)) {
    const dialogueClips = byKind.get("dialogue") ?? [];
    out["dialogue"] = (turns as Item[]).map((t, i) => ({
      "speaker_role": get(t, "speaker_role", ""),
      "text": get(t, "text", ""),
      "clip_id": i < dialogueClips.length ? dialogueClips[i].clip_id : null,
    }));
  }

  for (const key of ["scene_id", "speaker_role", "listener_role", "channel"]) {
    if (has(item, key)) {
      out[key] = item[key];
    }
  }

  // A type whose picture is its own: the brief travels with the item, and
  // the scene id is derived from the item id so the picture job, the
  // database and the app all find it under one name (bjt/scenes.ts, which
  // alone spells it).
  if (truthy(get(item, "image_brief"))) {
    out["image_brief"] = item["image_brief"];
    out["scene_id"] = scenes.pictureSceneId(iid);
  }

  // The difficulty prior: how often the difficulty model (a deliberately weak
  // one, bjt/fidelity/difficulty.ts) answered this item correctly with the
  // full stimulus — or, when that probe did not run, how often the
  // answerability gate's strong model did, which is a coarser number. Absent
  // for hand-written batches, which are the one path that skips both — and
  // absent is the honest value there, not 1.0. The practice queue reads it as
  // the difficulty prior for an item nobody has met yet, and replaces it with
  // the measured rate as soon as the shared bank has one.
  if (get(item, "model_p_correct") !== null) {
    out["model_p_correct"] = item["model_p_correct"];
  }
  return out;
}

export function buildBundle(itemType: string, level: string, items: Item[], model: string): Bundle {
  const bundleItems = items.map((it) => toBundleItem(it));
  const manifest = tts_plan.manifest(zip(bundleItems, items, { strict: true }).map(([bi, raw]): [string, Item] => [bi["id"], raw]));
  const sceneIds = sorted(new Set(bundleItems.filter((bi) => truthy(get(bi, "scene_id"))).map((bi) => bi["scene_id"])));
  return {
    "bundle_version": BUNDLE_VERSION,
    "item_type": itemType,
    "level": level,
    "generated_at": isoformatUtc(new Date(), "seconds"),
    "generator_model": model,
    "items": bundleItems,
    "audio_manifest": manifest,
    "scenes": sceneIds,
  };
}

/** The bytes a bundle is committed as (`json.dumps(bundle, ensure_ascii=False,
 *  indent=2)` and a newline). */
export function _bundleText(bundle: Bundle): string {
  return dumps(bundle, { ensureAscii: false, indent: 2, floatKeys: BUNDLE_FLOAT_KEYS }) + "\n";
}

export function save(bundle: Bundle, opts: { path?: string | null } = {}): string {
  const p = truthy(opts.path) ? opts.path! : defaultPath(bundle["item_type"], bundle["level"]);
  return writeAtomic(p, _bundleText(bundle));
}

function _load(p: string): Bundle {
  return loads(readFileSync(p, "utf8"));
}

export function load(p: string): Bundle {
  return seams.load(p);
}

/** `bundles()` itself; callers go through `seams.bundles`. */
function _bundles(opts: { itemType?: string | null } = {}): string[] {
  const itemType = opts.itemType ?? null;
  if (!existsSync(config.BATCH_DIR)) {
    return [];
  }
  const out: string[] = [];
  for (const name of sorted(readdirSync(config.BATCH_DIR).filter((n) => n.endsWith(".json")))) {
    if (name.endsWith(".source.json")) {
      continue;
    }
    if (truthy(itemType) && !name.startsWith(`${itemType}_`)) {
      continue;
    }
    out.push(path.join(config.BATCH_DIR, name));
  }
  return out;
}

/**
 * Every committed bundle, optionally narrowed to one item type.
 *
 * `.source.json` files are the hand-written inputs to `importbatch`, not
 * bundles, so they are skipped — counting both would double every cell a
 * hand-written batch spends.
 */
export function bundles(opts: { itemType?: string | null } = {}): string[] {
  return seams.bundles(opts);
}

/** What the tests fake: `bundles()` and `load()`, and every call this module
 *  makes to them (`spentCellIds`), go through these, so a test that replaces
 *  one here is obeyed everywhere (`patch(batch.seams, "bundles", ...)`). A
 *  test that patches the export itself (`patch(batch, "bundles", ...)`) is
 *  obeyed by every other module. */
export const seams = { bundles: _bundles, load: _load };

/**
 * Seed cells already spent by the bundles in this repository.
 *
 * The local SQLite database also knows this, but it is gitignored: a fresh
 * clone reports nothing spent however many items are committed, and the next
 * `bjt batch` on that machine would quietly re-spend cells the library already
 * used. Since `itemId` is a hash of (item type, cell), the second item would
 * REPLACE the first on publish — the library would shrink without saying so.
 *
 * The bundles are the thing that actually ships, so they are the ledger. The
 * database is still consulted as well (it holds cells spent on items that have
 * not been bundled yet); the two are unioned at the call sites.
 *
 * A bundle that cannot be read is an error, not a bundle with nothing in it:
 * skipped, its cells would look free, and the next item written on one of
 * them would take over a live question's id.
 */
export function spentCellIds(itemType: string): Set<string> {
  const spent = new Set<string>();
  for (const p of seams.bundles({ itemType })) {
    let bundle: Bundle;
    try {
      bundle = seams.load(p);
    } catch (e) {
      if (!unreadable(e)) throw e;
      throw new ValueError(`${p} cannot be read, so the seed cells it spends are ` +
                           `unknown: ${errText(e)}`, { cause: e });
    }
    if (get(bundle, "item_type") !== itemType) {
      continue;
    }
    for (const item of get(bundle, "items", []) as Item[]) {
      const cellId = get(or(get(item, "seed_cell"), {}), "id");
      if (truthy(cellId)) {
        spent.add(cellId);
      }
    }
  }
  return spent;
}

/** Next free numbered bundle for this type and level. */
export function defaultPath(itemType: string, level: string): string {
  mkdirSync(config.BATCH_DIR, { recursive: true });
  let n = 1;
  for (;;) {
    const p = path.join(config.BATCH_DIR, `${str(itemType)}_${str(level)}_${String(n).padStart(3, "0")}.json`);
    if (!existsSync(p)) {
      return p;
    }
    n += 1;
  }
}

// ----- offline batch checks ---------------------------------------------

export class Check {
  name: string;
  /** "pass" | "note" | "warn" | "fail".
   *
   *  `note` is weaker than `warn` on purpose. A warning says the bundle has
   *  something wrong with it; a note says it differs from the exam in a way
   *  worth knowing about but does not make the item defective. The one thing
   *  that reports notes is the length band, and the distinction matters
   *  there: a 総合読解 item with a 200-character passage is a perfectly good
   *  question that is nothing like the 400-to-900-character passage the exam
   *  sets, and calling that a fault would mean either shipping nothing or
   *  silencing the check. */
  status: string;
  detail: string;

  constructor(init: { name: string; status: string; detail: string }) {
    this.name = init.name;
    this.status = init.status;
    this.detail = init.detail;
  }
}

export class BundleReport {
  checks: Check[];

  constructor(init: { checks?: Check[] } = {}) {
    this.checks = init.checks ?? [];
  }

  get failed(): Check[] {
    return this.checks.filter((c) => c.status === "fail");
  }

  get warned(): Check[] {
    return this.checks.filter((c) => c.status === "warn");
  }

  get noted(): Check[] {
    return this.checks.filter((c) => c.status === "note");
  }

  get ok(): boolean {
    return this.failed.length === 0;
  }
}

/**
 * Every check that needs no API key. Run on every batch before it ships.
 *
 * `withdrawnIds` defaults to the committed ledger (`batches/withdrawn.txt`);
 * only the per-item tells (the naturalness lint, the key off the document)
 * look at it.
 */
export function checkBundle(
  bundle: Bundle,
  opts: { threshold?: number; withdrawnIds?: Iterable<string> | null } = {},
): BundleReport {
  const threshold = opts.threshold ?? dedupe.DEFAULT_THRESHOLD;
  const withdrawnIds = opts.withdrawnIds ?? null;
  const items = get(bundle, "items", []) as Item[];
  const itemType = get(bundle, "item_type", "") as string;
  const report = new BundleReport();
  const add = (name: string, status: string, detail: string) => {
    report.checks.push(new Check({ name, status, detail }));
  };

  if (!truthy(items)) {
    add("non-empty", "fail", "bundle contains no items");
    return report;
  }

  // A withdrawn item is no longer served; the per-item tells skip it.
  const gone: ReadonlySet<unknown> = withdrawnIds === null ? withdrawn.ids() : new Set(withdrawnIds);

  // 1. Every item still validates on its own.
  const invalid: string[] = [];
  for (const it of items) {
    const errs = schemas.validateItem(itemType, asGeneratorShape(it));
    if (errs.length) {
      invalid.push(`${str(get(it, "id"))}: ${repr(errs)}`);
    }
  }
  add(
    "item validity",
    invalid.length ? "fail" : "pass",
    invalid.length ? invalid.join("; ") : `all ${items.length} items valid`,
  );

  // 2. One item per seed cell.
  const cells = items.map((it) => get(or(get(it, "seed_cell"), {}), "id"));
  const missing = cells.filter((c) => !truthy(c)).length;
  const used = cells.filter((c) => truthy(c));
  const dupes = new Set(used.filter((c) => used.filter((x) => x === c).length > 1));
  if (missing) {
    add("seed cells present", "fail", `${missing} item(s) carry no seed cell`);
  } else if (dupes.size) {
    add("seed cells distinct", "fail", `cells used more than once: ${repr(sorted(dupes))}`);
  } else {
    add("seed cells distinct", "pass", `${new Set(used).size} distinct cells`);
  }

  // 3. Near-duplicate questions.
  const pairs = dedupe.findDuplicates(items, { threshold });
  if (pairs.length) {
    const detail = pairs.slice(0, 5).map(
      (p) => `#${p.i}(${str(p.topic_i)}) ≈ #${p.j}(${str(p.topic_j)}) at ${fixed(p.score, 2)}`,
    ).join("; ");
    add("no near-duplicates", "fail", detail);
  } else {
    const worst = _worstPairScore(items);
    add("no near-duplicates", "pass", `closest pair ${fixed(worst, 2)} (threshold ${fixed(threshold, 2)})`);
  }

  // 4. Answer position must not drift. A learner who notices C is right half the
  //    time can score without listening.
  const n = items.length;
  const counts = [0, 0, 0, 0];
  for (const it of items) {
    const ci = get(it, "correct_index", 0);
    if (0 <= ci && ci < 4) {
      counts[_index(counts, ci)] += 1;
    }
  }
  const worstShare = max(counts) / n;
  const positionsUsed = counts.filter((c) => c).length;
  // Two rules, because the share rule is blind to exactly the batch a new
  // item type starts as: it needs eight items before a 45% lean means
  // anything, so a batch of six with every answer at A would pass it, and
  // "the answer is always A" is the most exploitable pattern there is.
  if (n >= 8 && worstShare > 0.45) {
    add("answer position spread", "warn",
        `positions ${repr(counts)} — ${percent(worstShare)} on one position; reshuffle`);
  } else if (n >= 4 && positionsUsed < 3) {
    add("answer position spread", "warn",
        `positions ${repr(counts)} — the answer only ever lands in ${positionsUsed} ` +
        "of 4 places; reshuffle");
  } else {
    add("answer position spread", "pass", `positions ${repr(counts)}`);
  }

  // 5. Length must not give the answer away. "Pick the longest / most elaborate
  //    option" is the single easiest way to pass a 敬語 item without knowing any.
  const longest = items.filter((it) => _correctIsExtreme(it, { longest: true })).length;
  const shortest = items.filter((it) => _correctIsExtreme(it, { longest: false })).length;
  if (n >= 8 && (longest / n > 0.5 || shortest / n > 0.5)) {
    add("length does not leak", "warn",
        `correct option is the longest in ${longest}/${n} and the shortest in ${shortest}/${n}`);
  } else {
    add("length does not leak", "pass", `longest ${longest}/${n}, shortest ${shortest}/${n}`);
  }

  // 5b. The key must not be the one option the 資料 leaves off. Per item, and
  //     a failure like the naturalness lint: a new draft with this tell is
  //     sent back (`Generator.generate`), and a served one either leaves the
  //     bank through the ledger or fails CI.
  const offPage: string[] = [];
  for (const it of items) {
    if (gone.has(get(it, "id"))) continue;
    if (keyOnlyOffDocument(asGeneratorShape(it)) !== null) offPage.push(str(get(it, "id", "?")));
  }
  add("key is not the only option off the document", offPage.length ? "fail" : "pass",
      offPage.length ? `only the key is missing from the document in ${repr(offPage)}`
      : "no item's key is the one option the document leaves out");

  // 6. Distractor roles actually get exercised — an enum of eight used as three
  //    is a prompt that has settled into a rut.
  //
  //    Held to what the bundle could possibly manage, not to a flat four. An
  //    item has exactly three distractors, so a one-item bundle cannot show
  //    more than three distinct roles however varied its prompt is, and the
  //    nightly job writes one-item bundles all the time. Warning about that
  //    would be warning about arithmetic.
  const enumRoles = (get(roles.DISTRACTOR_ROLES, itemType, []) as string[]);
  const usedRoles = new Set<unknown>();
  for (const it of items) {
    for (const o of getitem(it, "options") as Item[]) {
      if (getitem(o, "role") !== roles.CORRECT) usedRoles.add(o["role"]);
    }
  }
  const unused = enumRoles.filter((r) => !usedRoles.has(r));
  const reachable = min([4, enumRoles.length, 3 * n]);
  if (enumRoles.length && usedRoles.size < reachable) {
    add("distractor role coverage", "warn",
        `only ${usedRoles.size}/${enumRoles.length} roles used; unused: ${repr(unused)}`);
  } else {
    add("distractor role coverage", "pass",
        `${usedRoles.size}/${enumRoles.length} roles used`
        + (reachable < min([4, enumRoles.length]) ? ` (at most ${reachable} fit in ${n} item(s))` : "")
        + (unused.length ? `; unused: ${repr(unused)}` : ""));
  }

  // 7. The per-option reason has to say something. An empty or one-word `why`
  //    means the app has nothing to show after a wrong answer.
  const thin: string[] = [];
  for (const it of items) {
    (getitem(it, "options") as Item[]).forEach((o, i) => {
      if (len(get(o, "why", "")) < 12) thin.push(`${str(getitem(it, "id"))}#${i}`);
    });
  }
  add("per-option why", thin.length ? "fail" : "pass",
      thin.length ? `too thin: ${repr(thin)}` : "every option explains itself");

  // 8. Length against the exam's own shapes. A note rather than a warning:
  //    see LENGTH_BANDS and Check.status for why being unlike the exam is not
  //    the same as being wrong.
  const bands = has(LENGTH_BANDS, itemType) ? LENGTH_BANDS[itemType] : null;
  if (bands !== null) {
    const outOfBand: string[] = [];
    const summary: string[] = [];
    for (const [fieldName, [low, high]] of Object.entries(bands)) {
      const lengths = _measuredLengths(fieldName, items);
      if (!lengths.length) {
        continue;
      }
      const outside = lengths.filter((x) => !(low <= x && x <= high));
      summary.push(
        `${fieldName} ${min(lengths)}–${max(lengths)}字 (band ${low}–${high})`,
      );
      if (outside.length) {
        outOfBand.push(
          `${outside.length}/${lengths.length} ${fieldName}(s) outside ${low}-${high}字`,
        );
      }
    }
    add("length matches the exam", outOfBand.length ? "note" : "pass",
        outOfBand.length ? outOfBand.join("; ") + ` — ${summary.join(", ")}`
        : summary.join(", "));
  }

  // 9. A document is printed to look like something, so everything printed
  //    beside it writes its numbers the way print does — see
  //    `normaliseNumerals`, which is what this check is checking.
  //    `toBundleItem` runs that on the way in, so a failure here means a
  //    bundle assembled some other way: a hand-edited `.json`, or a batch
  //    older than the rule. A failure rather than a note because it is
  //    mechanical and unambiguous, and re-importing the batch fixes it.
  //
  //    Re-normalising a copy and diffing is the whole test: it cannot
  //    disagree with the converter about what a number is, and it stays true
  //    if the converter's mind is changed later.
  // (Maps, not objects, for everything keyed by item id: an id that happens
  // to be all digits would jump the queue in a JavaScript object.)
  const spelledOut = new Map<unknown, string>();
  let nDocs = 0;
  for (const it of items) {
    const shaped = asGeneratorShape(it);
    const docs = schemas.documentsOf(shaped);
    nDocs += docs.length;
    const moved = normaliseNumerals(deepcopy(shaped));
    if (moved) {
      // Name what is wrong where we can. The runs come from the documents
      // because that is what `documentFaults` reads; an item whose only
      // spelled-out number is in an option still reports its count.
      const runs = sorted(new Set(docs.flatMap((doc) => numerals.documentFaults(doc))));
      spelledOut.set(getitem(it, "id"), runs.length ? runs.join(", ") : `${moved} string(s)`);
    }
  }
  if (nDocs) {
    add("numbers are written as digits", spelledOut.size ? "fail" : "pass",
        spelledOut.size
          ? "still spelled out — "
            + [...spelledOut].map(([iid, what]) => `${str(iid)}: ${what}`).join("; ")
          : `${nDocs} document(s) and their options read like print`);
  }

  // 10. The other half of check 9. The converter only moves a number with a
  //     counter after it; this reports the ones it cannot see, where a single
  //     sentence ends up carrying both notations. A warning rather than a
  //     failure because only a reader can tell 「二案」 (a count) from 「案二」
  //     (a label), and a check that cannot tell them apart must not be the
  //     thing that blocks a batch.
  const mixed = new Map<unknown, string[]>();
  for (const it of items) {
    const shaped = asGeneratorShape(it);
    if (schemas.documentField(get(shaped, "item_type", "")) === null) {
      continue;
    }
    const spoken = tts_plan.audioPolicy(getitem(shaped, "item_type"));
    const texts: string[] = [get(shaped, "explanation_ja", "")];
    if (!truthy(spoken.options)) {
      for (const o of or(get(shaped, "options"), []) as Item[]) {
        texts.push(get(o, "text", ""), get(o, "why", ""));
      }
    }
    if (!truthy(spoken.stem)) {
      texts.push(get(shaped, "stem", ""));
    }
    const runs = sorted(new Set(texts.flatMap((t) => numerals.mixedNotation(t))));
    if (runs.length) {
      mixed.set(getitem(it, "id"), runs);
    }
  }
  if (items.some((it) => schemas.documentField(get(it, "item_type", "")) !== null)) {
    add("one sentence, one notation", mixed.size ? "warn" : "pass",
        mixed.size
          ? "both notations in: "
            + [...mixed].map(([iid, r]) => `${str(iid)} (${r.join(", ")})`).join("; ")
          : "no sentence mixes digits with spelled-out numbers");
  }

  // 11. Japanese somebody would say. The mechanical half of the naturalness
  //     rules (bjt/fidelity/naturalness.ts): invented keigo stacks, a
  //     placeholder where a name belongs, brackets in something heard, a
  //     narration that says the answer. A failure, like the numerals, because
  //     each pattern is unambiguous and each is taken from a real question a
  //     learner was served. A withdrawn item is not held to it — it is
  //     no longer served, and is kept only as the record of why — which also
  //     makes the ledger compulsory: a committed item with one of these tells
  //     either leaves the bank or fails CI.
  const unnatural = new Map<unknown, string[]>();
  for (const it of items) {
    if (gone.has(get(it, "id"))) {
      continue;
    }
    const found = naturalness.faults(asGeneratorShape(it));
    if (found.length) {
      unnatural.set(get(it, "id", "?"), found);
    }
  }
  const served = items.filter((it) => !gone.has(get(it, "id"))).length;
  add("reads like Japanese", unnatural.size ? "fail" : "pass",
      unnatural.size
        ? [...unnatural].map(([iid, f]) => `${str(iid)}: ${f.join(" / ")}`).join("; ")
        : `no mechanical tell in ${served} served item(s)`
          + (served < n ? ` (${n - served} withdrawn)` : ""));

  // 12. Listening-specific: the scene must exist in the bank.
  if (itemType === "hatsugen_choukai") {
    let bank: Set<string>;
    try {
      bank = new Set(seedtable.load(itemType).scene_bank);
    } catch (e) {
      if (!(e instanceof FileNotFoundError)) throw e;
      bank = new Set();
    }
    if (bank.size) {
      const unknown = sorted(new Set(items
        .filter((it) => truthy(get(it, "scene_id")) && !bank.has(it["scene_id"]))
        .map((it) => get(it, "scene_id"))));
      const nScenes = new Set(items.filter((it) => truthy(get(it, "scene_id"))).map((it) => get(it, "scene_id"))).size;
      add("scenes come from the bank", unknown.length ? "fail" : "pass",
          unknown.length ? `not in the bank: ${repr(unknown)}`
          : `${nScenes} scene(s) reused across ${n} items`);
    }
  }

  // 13. Shared utterances are supposed to collapse into one file, so the
  //    manifest should be smaller than the clips the items ask for between
  //    them. The count is what each item plans rather than a flat five
  //    (narration plus four spoken options): a dialogue item plans more than
  //    five, and a reading item plans none.
  const clips = get(bundle, "audio_manifest", []) as unknown[];
  let planned = 0;
  for (const it of items) {
    planned += tts_plan.planItem(asGeneratorShape(it), getitem(it, "id")).length;
  }
  if (!planned) {
    add("audio manifest", "pass", "no audio — this item type is read, not heard");
  } else if (clips.length > planned) {
    add("audio manifest", "fail",
        `${clips.length} clip(s) for ${planned} planned — the manifest has entries ` +
        "no item asked for");
  } else {
    const saved = planned - clips.length;
    add("audio manifest", "pass",
        `${clips.length} clip(s) for ${n} items`
        + (saved ? ` — ${saved} shared utterance(s) collapsed` : ""));
  }

  return report;
}

/**
 * Character counts for one measured field, across a bundle.
 *
 * One number per stem, one per option, and — for `document` — one per ITEM
 * rather than per document, because what a reader faces is everything on the
 * page at once and the two-document types would otherwise each look half as
 * long as they are.
 */
export function _measuredLengths(fieldName: string, items: Item[]): number[] {
  if (fieldName === "stem") {
    return items.map((it) => len(get(it, "stem", "")));
  }
  if (fieldName === "option") {
    return items.flatMap((it) => (get(it, "options", []) as Item[]).map((o) => len(get(o, "text", ""))));
  }
  if (fieldName === "document") {
    const out: number[] = [];
    for (const it of items) {
      const docs = schemas.documentsOf(asGeneratorShape(it));
      if (docs.length) {
        let total = 0;
        for (const d of docs) total += len(document.textOf(d));
        out.push(total);
      }
    }
    return out;
  }
  return [];
}

/**
 * Turn a bundle item back into what the generator emitted, so the same
 * validator can be re-run over it.
 *
 * Mostly this drops bundle-only keys. The one real translation is documents:
 * the bundle normalises them to a list under `documents`, because everything
 * downstream would rather deal with one shape — but the validator checks the
 * type's own field, singular for the three types that have exactly one. Left
 * untranslated, every committed document item would fail its own
 * re-validation with "missing field: document" while being perfectly well
 * formed.
 */
export function asGeneratorShape(bundleItem: Item): Item {
  const it: Item = { ...bundleItem };
  delete it["correct_index"];
  delete it["audio"];
  delete it["id"];
  delete it["model_p_correct"];
  if (truthy(get(it, "image_brief"))) {
    delete it["scene_id"];  // derived by the bundle, never emitted by the model
  }

  const field = schemas.documentField(get(it, "item_type", ""));
  const documents = has(it, "documents") ? it["documents"] : null;
  delete it["documents"];
  if (field !== null && documents !== null) {
    it[field] = field === "documents" ? documents : (truthy(documents) ? documents : [null])[0];
  }

  const dialogue = get(it, "dialogue");
  if (Array.isArray(dialogue)) {
    // The bundle staples a clip id onto each turn; the generator did not.
    it["dialogue"] = dialogue
      .filter((t) => isDict(t))
      .map((t: Item) => ({ "speaker_role": get(t, "speaker_role", ""), "text": get(t, "text", "") }));
  }
  return it;
}

export function _worstPairScore(items: Item[]): number {
  let worst = 0.0;
  const sigs = items.map((it) => dedupe.itemSignature(it));
  for (let i = 0; i < sigs.length; i++) {
    for (let j = i + 1; j < sigs.length; j++) {
      worst = max([worst, dedupe.similarity(sigs[i], sigs[j])]);
    }
  }
  return worst;
}

/** The sentence a draft is sent back with when the key is the one option the
 *  資料 does not print, or null.
 *
 *  Three rooms on the timetable and a fourth only heard is a question a
 *  learner passes unheard by picking the one that is not on the sheet: two
 *  committed 資料聴読解 items did exactly this (a room changed aloud, the new
 *  room the only option off the page). Compared without punctuation or
 *  spaces, on the text every reader of the document sees. An item without a
 *  document, or whose distractors are not all on it, says nothing. Takes an
 *  item in generator shape. */
export function keyOnlyOffDocument(item: Item): string | null {
  const docs = schemas.documentsOf(item);
  if (!docs.length) return null;
  const flat = (s: string): string => s.replace(naturalness._PUNCT, "");
  const page = flat(docs.map((d) => document.textOf(d)).join("\n"));
  const options = (or(get(item, "options"), []) as Item[]).map((o) => flat(str(get(o, "text", ""))));
  let key: number;
  try {
    key = schemas.correctIndex(get(item, "options", []));
  } catch (e) {
    if (!(e instanceof ValueError || e instanceof KeyError)) throw e;
    return null;
  }
  if (!options[key] || page.includes(options[key])) return null;
  if (!options.every((o, i) => i === key || (o && page.includes(o)))) return null;
  return (
    `the key 「${str(get(item["options"][key], "text", ""))}」 is the only option the document `
    + "does not print, so a learner passes by picking the one not on the page; make at "
    + "least one distractor something heard but not printed too (a value mentioned and "
    + "set aside, an alternative proposed and turned down)"
  );
}

export function _correctIsExtreme(item: Item, opts: { longest: boolean }): boolean {
  const lengths = (getitem(item, "options") as Item[]).map((o) => len(getitem(o, "text")));
  const target = opts.longest ? max(lengths) : min(lengths);
  const ci = get(item, "correct_index", 0);
  // Ties do not count as a leak — if two options share the extreme, length
  // does not single the answer out.
  return lengths[_index(lengths, ci)] === target && lengths.filter((x) => x === target).length === 1;
}

// ----- Python's behaviour where JavaScript's differs --------------------------

/** `xs[i]` as Python indexes a list: a negative index counts from the end, and
 *  one out of range is an IndexError rather than `undefined`. */
function _index(xs: readonly unknown[], i: number): number {
  const j = i < 0 ? xs.length + i : i;
  if (!Number.isInteger(j) || j < 0 || j >= xs.length) throw new IndexError("list index out of range");
  return j;
}
