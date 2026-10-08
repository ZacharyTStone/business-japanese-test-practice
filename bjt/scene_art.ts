/**
 * Drawing the scene bank: generate, review, upload.
 *
 * `bjt/scenes.ts` says what the bank needs. This module fills it. They are two
 * modules because they have two different kinds of trust: the survey is
 * arithmetic over committed tables, and this is a job that calls two vendors and
 * writes to a storage bucket.
 *
 * The shape is the item pipeline's. An image model drafts; a judge model checks
 * each draft against the brief's rules, the same rules `scenes.promptFor` gives a
 * human illustrator; only a draft the judge passes is written under the scene's
 * name. Drafts that fail are kept as well, under `rejected/`, each with the
 * reason, because a gate that throws away its evidence cannot be checked
 * afterwards.
 *
 * It runs with nobody in the loop, so the judge stands where a person would. The
 * rules it applies are not softer for being applied by a model: readable text, a
 * logo, a likeness, or a picture that gives the scenario away each fail the draft
 * outright, and a scene that fails every attempt ships without a picture, which
 * the app allows.
 *
 * Nothing here runs at practice time. It runs on a laptop or in the nightly job,
 * over a bank whose contents are committed.
 *
 * Everything that reaches a vendor or the bucket is async: an image provider's
 * `generate`, the review (`reviewWithModel`), `draw`, `lifetimeLedger`, every
 * `Bucket` call, `uploadApproved`. The judge is called through the `llm`
 * module (`llm.reviewSceneImage`, `llm.answerFromImage`) and the image API and
 * the bucket through `http` / `r2`, so a test replaces them there.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import * as config from "./config.ts";
import { writeAtomic } from "./files.ts";
import * as http from "./http.ts";
import * as llm from "./llm.ts";
import {
  AttributeError, errText, get, has, IndexError, isException, KeyError, OverflowError, replace, repr, RuntimeError,
  sorted, str, thousands, toInt, truthy, TypeError_, ValueError,
} from "./py.ts";
import * as r2 from "./r2.ts";
import * as scenes from "./scenes.ts";
import * as providers from "./tts/providers.ts";

// ----- image providers ------------------------------------------------------

/** What an image backend has to do. */
export interface ImageProvider {
  name: string;
  /** File extension of what `generate` returns, and its media type. */
  suffix: string;
  media_type: string;
  /** False for a stand-in whose output must never be mistaken for artwork. */
  real: boolean;

  /** Brief → image bytes. */
  generate(prompt: string): Promise<Uint8Array>;
}

/** `struct.pack(">I", n)`. */
function _u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

/**
 * A valid PNG of one flat colour, with no image library.
 *
 * Enough for the placeholder provider: the file opens, has the bank's 3:2
 * shape, and is visibly not an illustration.
 */
export function _flatPng(width: number, height: number, rgb: readonly [number, number, number]): Uint8Array {
  const chunk = (kind: string, body: Uint8Array): Buffer => {
    const kindBody = Buffer.concat([Buffer.from(kind, "latin1"), body]);
    return Buffer.concat([_u32(body.length), kindBody, _u32(crc32(kindBody) >>> 0)]);
  };

  // `bytes(rgb)`: a value outside a byte is refused, as Python refuses it.
  for (const v of rgb) {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new ValueError("bytes must be in range(0, 256)");
  }
  const row = Buffer.alloc(1 + 3 * width);
  for (let x = 0; x < width; x++) {
    row[1 + 3 * x] = rgb[0];
    row[2 + 3 * x] = rgb[1];
    row[3 + 3 * x] = rgb[2];
  }
  const raw = Buffer.concat(new Array<Buffer>(height).fill(row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    // `zlib.compress(raw, 9)`: the zlib container, best compression.
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * A flat grey rectangle of the right shape.
 *
 * The same role `silent` plays for audio: it exercises the whole job —
 * drafting, review, the file layout, the SQL, the upload — with no vendor
 * account and no network. Its output is written under `placeholder/` so the
 * survey never counts it as artwork and nothing ever uploads it.
 */
export class PlaceholderProvider implements ImageProvider {
  name: string = "placeholder";
  suffix: string = ".png";
  media_type: string = "image/png";
  real: boolean = false;

  async generate(prompt: string): Promise<Uint8Array> {
    return _flatPng(96, 64, [0xD8, 0xD8, 0xD8]);
  }
}

/**
 * OpenAI's image API, over plain HTTPS so no extra package is needed.
 *
 * Asked for WebP directly: these are flat illustrations downloaded on a
 * phone, and a transcode step would need an image library this tool
 * otherwise does without. 1536×1024 is the landscape 3:2 the brief asks for.
 */
export class OpenAIImageProvider implements ImageProvider {
  name: string = "openai";
  suffix: string = ".webp";
  media_type: string = "image/webp";
  real: boolean = true;
  static ENDPOINT = "https://api.openai.com/v1/images/generations";
  static SIZE = "1536x1024";

  api_key: string | null;

  constructor(opts: { apiKey?: string | null } = {}) {
    this.api_key = truthy(opts.apiKey) ? opts.apiKey! : (process.env.OPENAI_API_KEY ?? null);
  }

  async generate(prompt: string): Promise<Uint8Array> {
    const cls = this.constructor as typeof OpenAIImageProvider;
    if (!truthy(this.api_key)) {
      throw new RuntimeError("OPENAI_API_KEY is not set");
    }
    const body = {
      "model": config.IMAGE_MODEL,
      "prompt": prompt,
      "n": 1,
      "size": cls.SIZE,
      "quality": config.IMAGE_QUALITY,
      "output_format": "webp",
      // Without this the API returns a lossless-grade file that can pass
      // the bucket's 2 MiB limit; see config.IMAGE_COMPRESSION.
      "output_compression": config.IMAGE_COMPRESSION,
    };
    let data: unknown;
    try {
      data = await http.jsonRequest(
        "POST", cls.ENDPOINT, body,
        { headers: { "Authorization": `Bearer ${this.api_key}` } },
      );
    } catch (exc) {
      if (!(exc instanceof RuntimeError)) throw exc;
      // An account that cannot pay refuses every picture after this one
      // the same way: the drawing stops rather than trying them all.
      if (llm._BILLING_SIGNS.some((sign) => errText(exc).toLowerCase().includes(sign))) {
        throw new llm.LLMBillingError(`image request failed: ${errText(exc)}`, { cause: exc });
      }
      throw exc;
    }
    try {
      return providers._b64decode(_sub(_sub(_sub(data, "data"), 0), "b64_json"));
    } catch (exc) {
      // A reply without the picture where it should be, or something other
      // than text there. Text that does not decode (binascii.Error, a
      // ValueError) is not caught, as in Python.
      if (exc instanceof KeyError || exc instanceof IndexError || exc instanceof TypeError_) {
        throw new RuntimeError(`unexpected response from the image API: ${errText(exc)}`, { cause: exc });
      }
      throw exc;
    }
  }
}

export const PROVIDERS: Record<string, new () => ImageProvider> = {
  "placeholder": PlaceholderProvider,
  "openai": OpenAIImageProvider,
};

export function getProvider(name: string): ImageProvider {
  if (!has(PROVIDERS, name)) {
    throw new KeyError(`unknown image provider ${repr(name)}; available: ${repr(sorted(Object.keys(PROVIDERS)))}`);
  }
  return new PROVIDERS[name]();
}

// ----- the review gate ------------------------------------------------------

export class Verdict {
  readonly approved: boolean;
  /** Why not, one entry per rule broken. Empty when approved. */
  readonly reasons: readonly string[];

  constructor(init: { approved: boolean; reasons?: readonly string[] }) {
    this.approved = init.approved;
    this.reasons = init.reasons ?? [];
  }
}

/** What the judge is asked, one flag per rule in the brief. The wording of the
 *  rules lives in `scenes.promptFor`; these are the names the verdict uses. */
export const RULES: Record<string, string> = {
  "readable_text": "readable text, signage, a chart or a user interface is drawn in",
  "logo_or_brand": "a logo or brand mark is drawn in",
  "real_likeness": "a recognisable likeness of a real person",
  "gives_scenario_away": "the picture fixes the situation more tightly than the setting does",
  "anatomy": "malformed hands, extra limbs, or more people than the setting calls for",
  "no_focus": "a second principal figure — a listener or partner drawn as prominently " +
              "as the speaker, or a crowd of equals — so it is not clear who is " +
              "speaking to the viewer",
  "wrong_setting": "the picture does not show the setting the brief names",
};

/** The rules for a per-item picture. Fewer than the bank's: this picture is
 *  allowed — required — to fix the situation, and to have as many people in it
 *  as the moment needs. What it may not do is be unclear about it. */
export const PICTURE_RULES: Record<string, string> = {
  "readable_text": "readable text, signage, a chart or a user interface is drawn in",
  "logo_or_brand": "a logo or brand mark is drawn in",
  "real_likeness": "a recognisable likeness of a real person",
  "anatomy": "malformed hands, extra limbs, or more people than the brief calls for",
  "not_the_brief": "the picture does not clearly show what the brief describes",
  "unclear": "what is happening is not readable at a glance — the action, or who is " +
             "doing it to whom, could be taken more than one way",
};

export type Reviewer = (image: Uint8Array, mediaType: string, scene: scenes.Scene) => Verdict | Promise<Verdict>;

/**
 * Show the draft to the judge model with the brief, and read its flags.
 *
 * A per-item picture then sits the item itself: the judge is shown the
 * picture with the question and the four descriptions, a few times, and the
 * draft is refused unless every trial picks the marked one. That is the
 * picture's answerability gate — the text gate cannot see it — and it is
 * strict on purpose: the pictures must be clear and not generic, and a
 * picture two readers describe differently is neither.
 *
 * A reader that gave no answer — an outage, a refusal, a reply that is not
 * an index — is an error, raised, never a refusal of the picture: a refusal
 * goes into the bucket's lifetime ledger, and a picture refused for its
 * judge's outages would be given up on and its item never served.
 */
export async function reviewWithModel(image: Uint8Array, mediaType: string, scene: scenes.Scene): Promise<Verdict> {
  const rules = scene.is_picture ? PICTURE_RULES : RULES;
  const flags = await llm.reviewSceneImage(image, mediaType, scenes.promptFor(scene), rules);
  const broken = Object.keys(rules).filter((rule) => truthy(_dictGet(flags, rule))).map((rule) => rules[rule]);
  if (scene.is_picture && broken.length === 0 && scene.options.length > 0 && scene.answer !== null) {
    for (let trial = 0; trial < config.GATE_TRIALS; trial++) {
      const res = await llm.answerFromImage(image, mediaType, scene.question, [...scene.options]);
      let chosen: number;
      try {
        chosen = _int(_dictGet(res, "choice", -1));
      } catch (exc) {
        if (exc instanceof ValueError || exc instanceof TypeError_ || exc instanceof AttributeError) {
          throw new llm.LLMError(`the picture's reader gave no answer: ${repr(res)}`, { cause: exc });
        }
        throw exc;
      }
      if (chosen !== scene.answer) {
        const picked = 0 <= chosen && chosen < scene.options.length ? scene.options[chosen] : "nothing";
        broken.push(`a reader shown the picture chose ${str(chosen)} (${str(picked)}) ` +
                    `rather than the marked description ${str(scene.answer)}`);
        break;
      }
    }
  }
  return new Verdict({ approved: broken.length === 0, reasons: broken });
}

/** For the placeholder provider only: a grey rectangle has nothing to judge. */
export function approveEverything(image: Uint8Array, mediaType: string, scene: scenes.Scene): Verdict {
  return new Verdict({ approved: true });
}

// ----- the job --------------------------------------------------------------

export class Drawn {
  scene_id: string;
  /** Storage path of the approved file, or null when every attempt failed. */
  path: string | null;
  attempts: number;
  /** Reasons each rejected attempt was rejected, in order. */
  rejected: (readonly string[])[];
  error: string | null;
  /** Refused drafts before tonight, from the bucket's ledger. */
  prior: number;
  /** True when the scene was not drawn because its lifetime allowance of
   *  refused drafts is spent. Not an error: the summary names it and the
   *  scene ships on its stand-in, or (a per-item picture) its item waits. */
  given_up: boolean;

  constructor(init: {
    scene_id: string;
    path: string | null;
    attempts: number;
    rejected?: (readonly string[])[];
    error?: string | null;
    prior?: number;
    given_up?: boolean;
  }) {
    this.scene_id = init.scene_id;
    this.path = init.path;
    this.attempts = init.attempts;
    this.rejected = init.rejected ?? [];
    this.error = init.error ?? null;
    this.prior = init.prior ?? 0;
    this.given_up = init.given_up ?? false;
  }

  get ok(): boolean {
    return this.path !== null;
  }
}

export class DrawResult {
  drawn: Drawn[];
  provider: string;
  /** Why the job ended before its list did: the run's ceiling, or an
   *  account that cannot pay. null when every wanted scene was tried. */
  stopped: string | null;

  constructor(init: { drawn: Drawn[]; provider: string; stopped?: string | null }) {
    this.drawn = init.drawn;
    this.provider = init.provider;
    this.stopped = init.stopped ?? null;
  }

  get approved(): Drawn[] {
    return this.drawn.filter((d) => d.ok);
  }

  get failed(): Drawn[] {
    return this.drawn.filter((d) => !d.ok);
  }

  summary(): string {
    const lines = [
      `## Scene artwork (${str(this.provider)})`,
      "",
      `${this.approved.length} approved, ${this.failed.length} without a picture.`,
    ];
    if (this.provider === "placeholder") {
      lines.push("");
      lines.push("**Placeholder provider: nothing here is artwork.** Files are " +
                 "under `placeholder/` and are never uploaded.");
    }
    lines.push("");
    lines.push("| scene | result | attempts (before tonight) | rejected because |");
    lines.push("|---|---|---:|---|");
    for (const d of this.drawn) {
      let result: string;
      if (d.given_up) {
        result = "given up: lifetime allowance of refused drafts spent";
      } else {
        result = d.ok ? (d.path || "") : (
          truthy(d.error) ? `error: ${str(d.error)}` : "no draft passed");
      }
      const why = d.rejected.map((r) => r.join(" / ")).join("; ") || "—";
      lines.push(`| ${str(d.scene_id)} | ${result} | ${str(d.attempts)} (${str(d.prior)}) | ${why} |`);
    }
    if (truthy(this.stopped)) {
      lines.push("", `**Stopped before the end:** ${str(this.stopped)}. The scenes not ` +
                     "listed were not tried; the next run draws them.");
    }
    return lines.join("\n");
  }
}

/** The run's ceiling (or an empty account) ended the drawing part-way.
 *
 *  Raised by `draw` with what it had drawn by then (`result`), so the caller
 *  can still upload the pictures already approved and paid for — and must
 *  not draw another: the next draft would be an image bought over the
 *  ceiling. */
export class DrawStopped extends llm.LLMBillingError {
  result: DrawResult;

  constructor(cause: llm.LLMBillingError, result: DrawResult) {
    super(errText(cause), { cause });
    this.result = result;
  }
}

/** Told about each refused draft: (scene_id, lifetime attempt number, reasons).
 *  The bucket's ledger is written through this. */
export type OnReject = (sceneId: string, n: number, reasons: readonly string[]) => void | Promise<void>;

/**
 * Draft, review and write each wanted scene.
 *
 * Approved files land at `media/scenes/<scene_id><ext>`, which is exactly
 * where `scenes.survey` looks, so a scene drawn here counts as having art
 * from then on. Rejected drafts go to `media/scenes/rejected/` with a text
 * file beside each saying which rule it broke. A provider that is not real
 * writes under `placeholder/` instead and its drafts are not reviewed.
 *
 * `prior` is how many drafts of each scene were refused on earlier runs
 * (the bucket's ledger); a scene at or over `lifetime` is not drawn again,
 * and says so. `onReject` is called for every refused draft with its
 * lifetime number, which is how the ledger grows.
 *
 * The run's ceilings (bjt/llm.ts `state.spend`, the ledger the whole job
 * shares) are checked before every image a real provider is asked for, as
 * before every model call. Reached — or an account that cannot pay, from the
 * image vendor or the judge — the drawing stops at once with `DrawStopped`;
 * any other failure is that scene's error and the job goes on to the next.
 */
export async function draw(
  wanted: readonly scenes.Scene[],
  opts: {
    provider: ImageProvider;
    review: Reviewer;
    mediaDir?: string | null;
    attempts?: number | null;
    prior?: Record<string, number> | null;
    lifetime?: number | null;
    onReject?: OnReject | null;
  },
): Promise<DrawResult> {
  const provider = opts.provider;
  let review = opts.review;
  const attempts = opts.attempts || config.SCENE_ATTEMPTS;
  const lifetime = opts.lifetime || config.SCENE_LIFETIME_ATTEMPTS;
  const prior: Record<string, number> = opts.prior ?? {};
  const onReject = opts.onReject ?? null;
  const root = path.join(truthy(opts.mediaDir) ? opts.mediaDir! : config.MEDIA_DIR, "scenes");
  const outDir = provider.real ? root : path.join(root, "placeholder");
  const rejectedDir = path.join(root, "rejected");
  mkdirSync(outDir, { recursive: true });
  if (!provider.real) {
    review = approveEverything;
  }

  const drawn: Drawn[] = [];
  for (const scene of wanted) {
    const before: number = get(prior, scene.scene_id, 0);
    const record = new Drawn({ scene_id: scene.scene_id, path: null, attempts: 0, prior: before });
    if (provider.real && before >= lifetime) {
      record.given_up = true;
      drawn.push(record);
      continue;
    }
    const prompt = scenes.imagePrompt(scene);
    // Tonight's drafts stop at the per-run allowance or at the lifetime
    // one, whichever comes first.
    const tonight = provider.real ? Math.min(attempts, lifetime - before) : attempts;
    for (let n = 1; n < tonight + 1; n++) {
      let image: Uint8Array;
      let verdict: Verdict;
      try {
        if (provider.real) {
          // An image is bought here: the ceilings first, as before
          // any request, and the request on the count.
          llm.state.spend.beginRequest();
        }
        record.attempts = n;
        image = await provider.generate(prompt);
        verdict = await review(image, provider.media_type, scene);
      } catch (exc) {
        if (exc instanceof llm.LLMBillingError) {
          record.error = `stopped: ${errText(exc)}`;
          drawn.push(record);
          throw new DrawStopped(exc, new DrawResult({ drawn, provider: provider.name,
                                                      stopped: errText(exc) }));
        }
        if (!isException(exc)) throw exc;
        // a vendor error is a result, not a crash
        record.error = errText(exc);
        break;
      }
      if (verdict.approved) {
        // Whole or not at all: the survey counts any file here as the
        // scene's artwork, and the upload sends it.
        writeAtomic(path.join(outDir, `${scene.scene_id}${provider.suffix}`), image);
        const rel = scenes.storagePath(scene.scene_id, provider.suffix);
        record.path = provider.real ? rel : `placeholder/${rel}`;
        break;
      }
      record.rejected.push(verdict.reasons);
      mkdirSync(rejectedDir, { recursive: true });
      const stem = path.join(rejectedDir, `${scene.scene_id}-${before + n}`);
      writeFileSync(_withSuffix(stem, provider.suffix), image);
      writeFileSync(_withSuffix(stem, ".txt"), verdict.reasons.join("\n") + "\n", "utf8");
      if (onReject !== null) {
        try {
          await onReject(scene.scene_id, before + n, verdict.reasons);
        } catch (exc) { // the ledger is a courtesy, not the job
          if (!(exc instanceof RuntimeError)) throw exc;
          record.error = `could not record the refusal: ${errText(exc)}`;
        }
      }
    }
    drawn.push(record);
  }
  return new DrawResult({ drawn, provider: provider.name });
}

// ----- what a run draws ------------------------------------------------------

/**
 * The scenes a run draws, in the order it draws them.
 *
 * `names` narrows it to those scenes (an unknown one is a ValueError, named);
 * without `force` a scene that has art is left alone; `only` is "bank" or
 * "pictures". The shared bank comes first, then at most `maxPictures`
 * per-item pictures (config.NIGHT_MAX_PICTURES): each is an image call and
 * several vision calls per draft, and the tree may hold more new 画像把握
 * items than one night should pay for.
 */
export function select(
  survey: readonly scenes.Scene[],
  opts: { names?: readonly string[] | null; force?: boolean; only?: string | null; maxPictures?: number | null } = {},
): scenes.Scene[] {
  const names = opts.names ?? null;
  const force = opts.force ?? false;
  const only = opts.only ?? null;
  let wanted: scenes.Scene[];
  if (names !== null && names.length > 0) {
    const known = new Set(survey.map((s) => s.scene_id));
    const unknown = sorted(new Set(names.filter((n) => !known.has(n))));
    if (unknown.length > 0) {
      throw new ValueError(`no such scene(s): ${unknown.join(", ")}`);
    }
    wanted = survey.filter((s) => names.includes(s.scene_id));
  } else {
    wanted = [...survey];
  }
  if (!force) {
    wanted = wanted.filter((s) => !s.has_art);
  }
  if (only === "bank") {
    wanted = wanted.filter((s) => !s.is_picture);
  } else if (only === "pictures") {
    wanted = wanted.filter((s) => s.is_picture);
  }
  const cap = opts.maxPictures ?? config.NIGHT_MAX_PICTURES;
  const pictures = wanted.filter((s) => s.is_picture).slice(0, cap);
  return [...wanted.filter((s) => !s.is_picture), ...pictures];
}

/**
 * What the bucket remembers refusing, so a scene at its lifetime allowance
 * is not drawn again; and, with `record`, the callback that grows the ledger
 * as tonight refuses. Returns [prior refusals, onReject, a warning or null].
 *
 * An unconfigured bucket remembers nothing and records nothing. A ledger
 * that cannot be read is a warning, not a stop: the lifetime cap then does
 * not hold tonight, and the run's own ceilings still do.
 */
export async function lifetimeLedger(
  bucket: Pick<Bucket, "configured" | "refusals" | "recordRefusal">,
  opts: { record: boolean },
): Promise<[Record<string, number>, OnReject | null, string | null]> {
  if (!bucket.configured) {
    return [{}, null, null];
  }
  let prior: Record<string, number> = {};
  let warning: string | null = null;
  try {
    prior = await bucket.refusals();
  } catch (exc) {
    if (!(exc instanceof RuntimeError)) throw exc;
    warning = `could not read the refusals ledger: ${errText(exc)}`;
  }
  return [prior, opts.record ? bucket.recordRefusal.bind(bucket) : null, warning];
}

// ----- the bucket -----------------------------------------------------------

/**
 * One folder of the media bucket in R2 (bjt/r2.ts): `scenes` for the
 * pictures, `audio` for the clips. A file at `path` is the object
 * `<name>/<path>`, which is where the app's Worker looks for it.
 *
 * Needs an R2 token's S3 pair in the environment, because writing here is
 * nobody's but the pipeline's — a client that could write here could replace
 * the picture of a question with anything at all. The secret is read when the
 * bucket is used, never stored in config, and must never reach the client or
 * a commit.
 *
 * `new Bucket()` reads the pair from the environment, as the nightly
 * workflow's one-liner relies on: `(await new Bucket().list()).size`.
 */
export class Bucket {
  name: string;
  creds: r2.Credentials | null;

  constructor(opts: { name?: string; creds?: r2.Credentials | null } = {}) {
    this.name = opts.name ?? "scenes";
    this.creds = opts.creds != null ? opts.creds : r2.Credentials.fromEnv();
  }

  get configured(): boolean {
    return this.creds !== null;
  }

  _creds(): r2.Credentials {
    if (this.creds === null) {
      throw new RuntimeError(r2.NOT_CONFIGURED);
    }
    return this.creds;
  }

  /** Names of the files at the folder's top — the artwork already shipped.
   *
   *  With a prefix, the names under that folder (without the folder). Every
   *  page of them: the refusals ledger grows by a file per refused draft,
   *  and a ledger read only to its thousandth file would forget the rest and
   *  draw given-up pictures again. */
  async list(opts: { prefix?: string } = {}): Promise<Set<string>> {
    const prefix = opts.prefix ?? "";
    const base = `${this.name}/${prefix}`;
    const keys = await r2.listKeys(this._creds(), base, { delimiter: "/" });
    const names = new Set(keys.filter((k) => k.startsWith(base) && k !== base).map((k) => k.slice(base.length)));
    if (prefix) {
      return names;
    }
    return new Set([...names].filter((n) => scenes.IMAGE_EXTENSIONS.includes(_suffix(n))));
  }

  // The ledger of refused drafts: one small text file per refusal, under
  // `rejected/`, named `<scene_id>-<n>.txt`. The runner forgets everything
  // each night; this is how it knows a scene has been refused six times
  // already and is not worth a seventh dollar.
  static LEDGER = "rejected/";

  /** scene_id → how many drafts have been refused, over all time. */
  async refusals(): Promise<Record<string, number>> {
    const cls = this.constructor as typeof Bucket;
    const counts: Record<string, number> = {};
    for (const name of await this.list({ prefix: cls.LEDGER })) {
      const stem = _stem(name);
      const dash = stem.lastIndexOf("-");
      const [sceneId, n] = dash < 0 ? ["", stem] : [stem.slice(0, dash), stem.slice(dash + 1)];
      if (sceneId && _isdigit(n)) {
        counts[sceneId] = Math.max(get(counts, sceneId, 0), _digitsToInt(n));
      }
    }
    return counts;
  }

  async recordRefusal(sceneId: string, n: number, reasons: readonly string[]): Promise<void> {
    const cls = this.constructor as typeof Bucket;
    const body = new TextEncoder().encode(reasons.join("\n") + "\n");
    await this.upload(`${cls.LEDGER}${sceneId}-${str(n)}.txt`, body, "text/plain; charset=utf-8");
  }

  /** Put one file at `path`. With `upsert` it replaces whatever is
   *  there; without, a file already there is left alone and
   *  `AlreadyExists` says so. */
  async upload(filePath: string, data: Uint8Array, contentType: string, opts: { upsert?: boolean } = {}): Promise<void> {
    const upsert = opts.upsert ?? true;
    await r2.put(this._creds(), `${this.name}/${filePath}`, data, contentType, { overwrite: upsert });
  }
}

/** The bucket already holds a file at that path, and it was not replaced. */
export const AlreadyExists = r2.AlreadyExists;
export type AlreadyExists = r2.AlreadyExists;

export const _MEDIA_TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export class UploadResult {
  /** Storage paths now in the bucket because of this call. */
  sent: string[];
  /** [storage path, why] for every local file that did not get there. */
  failed: [string, string][];
  /** Storage paths the bucket already held and this call left alone. */
  existing: string[];

  constructor(init: { sent?: string[]; failed?: [string, string][]; existing?: string[] } = {}) {
    this.sent = init.sent ?? [];
    this.failed = init.failed ?? [];
    this.existing = init.existing ?? [];
  }

  get failed_paths(): Set<string> {
    return new Set(this.failed.map(([p]) => p));
  }

  /** Markdown for the run summary. Empty when nothing went wrong. */
  summary(): string {
    if (this.failed.length === 0) {
      return "";
    }
    const lines = [
      "### Not uploaded",
      "",
      `${this.failed.length} approved picture(s) did not reach the bucket and are ` +
      "not pointed at by the database. They are in this run's artifact; the " +
      "next night draws them again.",
      "",
      "| file | why |",
      "|---|---|",
    ];
    lines.push(...this.failed.map(([p, why]) => `| ${p} | ${why} |`));
    return lines.join("\n");
  }
}

/** A file there and a regular file (`Path.is_file()`). */
function _isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Push every locally approved file to the bucket.
 *
 * One file failing must not stop the rest: an exception that ended the loop
 * would lose every approved picture after it, to be paid for again the next
 * night. A file the bucket would refuse is caught here before a byte is sent,
 * and any other failure is recorded against its file and the loop goes on.
 * The caller uses `failed_paths` to keep those files out of the SQL, so the
 * database is never pointed at a picture that is not there.
 */
export async function uploadApproved(survey: readonly scenes.Scene[], bucket: Pick<Bucket, "upload">,
                                     opts: { mediaDir?: string | null } = {}): Promise<UploadResult> {
  const root = path.join(truthy(opts.mediaDir) ? opts.mediaDir! : config.MEDIA_DIR, "scenes");
  const result = new UploadResult();
  for (const scene of survey) {
    if (!truthy(scene.path)) {
      continue;
    }
    const scenePath = scene.path!;
    const local = path.join(root, scenePath);
    if (!_isFile(local)) {
      continue; // known only from the bucket listing; nothing to send
    }
    const size = statSync(local).size;
    if (size > config.SCENE_MAX_BYTES) {
      result.failed.push([
        scenePath,
        `${thousands(size)} bytes is over the bucket's ${thousands(config.SCENE_MAX_BYTES)} byte limit`,
      ]);
      continue;
    }
    try {
      await bucket.upload(scenePath, readFileSync(local), _mediaType(_suffix(local)));
    } catch (exc) {
      if (!(exc instanceof RuntimeError)) throw exc;
      result.failed.push([scenePath, errText(exc)]);
      continue;
    }
    result.sent.push(scenePath);
  }
  return result;
}

/** `_MEDIA_TYPES[suffix]`: a KeyError for a suffix that is not artwork. */
function _mediaType(suffix: string): string {
  if (!has(_MEDIA_TYPES, suffix)) throw new KeyError(repr(suffix));
  return _MEDIA_TYPES[suffix];
}

/**
 * The survey with those files forgotten, as if they had never been drawn.
 *
 * For the SQL after an upload with failures: a scene whose file is on this
 * machine but not in the bucket must read as having no picture, or the app
 * would be pointed at a URL that 404s.
 */
export function without(survey: scenes.Scene[], paths: ReadonlySet<string>): scenes.Scene[] {
  if (paths.size === 0) {
    return survey;
  }
  return survey.map((s) => (s.path !== null && paths.has(s.path) ? replace(s, { path: null }) : s));
}

/** A request the server refused (bjt/http.ts). Named here too because the
 *  bucket's callers read its status: an upload onto a file that exists. */
export const RequestFailed = http.RequestFailed;
export type RequestFailed = http.RequestFailed;

// ----- Python's behaviour where JavaScript's differs --------------------------

/** `pathlib.PurePosixPath(p).name`: the last component, slashes collapsed. */
function _name(p: string): string {
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  return parts.length ? parts[parts.length - 1] : "";
}

/** `Path(p).suffix`: the last dot and what follows, unless the dot starts or
 *  ends the name. */
export function _suffix(p: string): string {
  const name = _name(p);
  const i = name.lastIndexOf(".");
  return 0 < i && i < name.length - 1 ? name.slice(i) : "";
}

/** `Path(p).stem`: the name without its suffix. */
export function _stem(p: string): string {
  const name = _name(p);
  const i = name.lastIndexOf(".");
  return 0 < i && i < name.length - 1 ? name.slice(0, i) : name;
}

/** `Path(p).with_suffix(suffix)`: the suffix replaced, or added. */
export function _withSuffix(p: string, suffix: string): string {
  const name = _name(p);
  const old = _suffix(p);
  const renamed = old ? name.slice(0, name.length - old.length) + suffix : name + suffix;
  return path.join(path.dirname(p), renamed);
}

/** `s.isdigit()`. */
function _isdigit(s: string): boolean {
  return /^\p{Nd}+$/u.test(s);
}

/** `int(s)` of a string `isdigit` accepted: full-width digits read as their
 *  ASCII forms. */
function _digitsToInt(s: string): number {
  return toInt(s.normalize("NFKC"));
}

/** Python's name for the type of a JSON value, for a TypeError's message. */
function _typeName(v: unknown): string {
  if (v === null || v === undefined) return "NoneType";
  if (Array.isArray(v)) return "list";
  if (typeof v === "object") return "dict";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  return Number.isInteger(v) ? "int" : "float";
}

/** `d.get(key, default)` on a reply that should be a dict: an
 *  AttributeError when it is not one. */
function _dictGet(d: unknown, key: string, dflt: unknown = null): any {
  if (d === null || d === undefined || typeof d !== "object" || Array.isArray(d)) {
    throw new AttributeError(`'${_typeName(d)}' object has no attribute 'get'`);
  }
  return get(d as Record<string, unknown>, key, dflt);
}

/** `int(x)` for a JSON value: an int as it is, a bool as 0 or 1, a float
 *  truncated, a string read as base 10; anything else a TypeError. An
 *  infinity is an OverflowError, which `reviewWithModel` does not read as
 *  "no answer", as in Python. */
function _int(x: unknown): number {
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "number") {
    if (Number.isNaN(x)) throw new ValueError("cannot convert float NaN to integer");
    if (!Number.isFinite(x)) throw new OverflowError("cannot convert float infinity to integer");
    return Math.trunc(x);
  }
  if (typeof x === "string") return toInt(x);
  throw new TypeError_(`int() argument must be a string, a bytes-like object or a real number, not '${_typeName(x)}'`);
}

/** `obj[key]` on a parsed JSON value, as Python subscripts it: a dict by its
 *  key, a list by an integer index, anything else a TypeError. */
function _sub(obj: unknown, key: string | number): unknown {
  if (typeof key === "number") {
    if (Array.isArray(obj) || typeof obj === "string") {
      const seq: unknown[] = typeof obj === "string" ? [...obj] : obj;
      const i = key < 0 ? seq.length + key : key;
      if (i < 0 || i >= seq.length) throw new IndexError(`${_typeName(obj)} index out of range`);
      return seq[i];
    }
    if (obj !== null && typeof obj === "object") throw new KeyError(String(key));
    throw new TypeError_(`'${_typeName(obj)}' object is not subscriptable`);
  }
  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    if (!has(obj, key)) throw new KeyError(repr(key));
    return (obj as Record<string, unknown>)[key];
  }
  if (Array.isArray(obj)) {
    throw new TypeError_("list indices must be integers or slices, not str");
  }
  if (typeof obj === "string") {
    throw new TypeError_("string indices must be integers, not 'str'");
  }
  throw new TypeError_(`'${_typeName(obj)}' object is not subscriptable`);
}
