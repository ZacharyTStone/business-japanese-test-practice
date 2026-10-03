/**
 * Seeds the repository can make for itself.
 *
 * `seeds/` is where licensed material goes — official sample items, the official
 * vocabulary list, the official level descriptors — and it is gitignored for that
 * reason. The generators read few-shot examples from it, and the few-shot
 * examples are most of what keeps a generated item close to the exam.
 *
 * But the repository already holds examples in exactly that shape: the reference
 * batches in `batches/`, every item of which was composed by hand, reviewed,
 * and passed the same checks generated items must pass. They are
 * original work, not licensed text. When there is no licensed seed material —
 * no laptop with the files, no secret carrying them — this module builds a
 * `seeds/` from those batches instead, so the nightly job can write items whose
 * few-shot examples are the bank's own best ones rather than nothing at all.
 *
 * What it does NOT make up: official items (`official/`, which the discriminator
 * and calibration need and which only the licence holder can supply), the JLPT
 * kanji tiers (a partial list would make the vocab gate strict about the wrong
 * set, so it is left absent and the gate stays permissive and says so), and the
 * level descriptors (the neutral built-in wording is used). A `BOOTSTRAPPED`
 * file is left in the directory saying all this, so nobody mistakes it for the
 * real thing, and the licensed material always wins when it is present.
 *
 * Only questions still in front of learners are examples. A withdrawn one
 * (`batches/withdrawn.txt`) is in its bundle as the record of what must not be
 * written — invented keigo, a key that cannot be right — and a few-shot example
 * is what the generator copies most faithfully, so it is read through
 * `withdrawn.liveItems` like everything else that counts the library. A question
 * the regate failed (`batches/regated.txt`) and nobody has overruled is left out
 * too: it is on its way to the ledger, and the diff that puts it there may not
 * be merged yet.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as batchmod from "./batch.ts";
import * as config from "./config.ts";
import { get, or, sorted, splitlines, strip, truthy } from "./py.ts";
import { dumps, loads } from "./pyjson.ts";
import * as regate from "./regate.ts";
import * as withdrawn from "./withdrawn.ts";

/** An item or a bundle: plain JSON data. */
type Item = Record<string, any>;

/** Fields of a published item that are about the bundle or the bank rather
 *  than the item as an example: identity, provenance, media, the answer key
 *  (the correct option is already marked by its role). */
export const _NOT_AN_EXAMPLE_FIELD: readonly string[] = ["id", "item_type", "level", "seed_cell", "audio", "correct_index"];

/** The generator shows at most this many examples, and so does the bootstrap. */
export const PER_TYPE = 5;

export const MARKER = "BOOTSTRAPPED";

export class Bootstrap {
  seeds_dir: string;
  fewshot: Record<string, number>;
  business_terms: number;
  skipped: string | null;

  constructor(init: { seeds_dir: string; fewshot?: Record<string, number>; business_terms?: number; skipped?: string | null }) {
    this.seeds_dir = init.seeds_dir;
    this.fewshot = init.fewshot ?? {};
    this.business_terms = init.business_terms ?? 0;
    this.skipped = init.skipped ?? null;
  }

  summary(): string {
    if (truthy(this.skipped)) {
      return this.skipped!;
    }
    const lines = [
      `Built ${this.seeds_dir} from the reference batches:`,
      ...sorted(Object.entries(this.fewshot)).map(([t, n]) => `  fewshot/${t}.json: ${n} example(s)`),
      `  vocab/business_terms.txt: ${this.business_terms} term(s)`,
      "  no official/ items, no JLPT kanji tiers, no level descriptors — "
      + "those are licensed material and only a real seeds/ carries them.",
    ];
    return lines.join("\n");
  }
}

/** The `*.json` names in a directory (`Path.glob("*.json")`): none when it is
 *  not a directory. */
function _jsonNames(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [];
  }
  return readdirSync(dir).filter((n) => n.endsWith(".json"));
}

/**
 * True when `seeds/` holds anything a person put there.
 *
 * A bootstrapped directory is recognised by its marker and does not count:
 * the licensed material must always be able to replace it.
 */
export function hasLicensedSeeds(opts: { seedsDir?: string | null } = {}): boolean {
  const seedsDir = or(opts.seedsDir ?? null, config.SEEDS_DIR) as string;
  if (!existsSync(seedsDir) || existsSync(path.join(seedsDir, MARKER))) {
    return false;
  }
  return ["fewshot", "official"].some((sub) => _jsonNames(path.join(seedsDir, sub)).length > 0);
}

/** An error reading or parsing a bundle file (`json.JSONDecodeError` or
 *  `OSError`): the file is skipped, as Python skipped it. */
function _unreadable(e: unknown): boolean {
  return e instanceof SyntaxError || (e instanceof Error && typeof (e as NodeJS.ErrnoException).code === "string");
}

/**
 * Up to PER_TYPE items per type, spread across the levels the bank has.
 *
 * Spread rather than the first five, so a type with items at three levels
 * shows the model all three registers instead of five J3s. Live questions
 * only, and none the regate failed (see the module docstring); both ledgers
 * are read from `batchDir`, beside the bundles they speak for.
 *
 * Each is turned back into what the generator emits (`batch.asGeneratorShape`)
 * before it is an example, since the prompt asks the model to match the
 * example's shape. A bundle item is not that shape: its documents are a list
 * under `documents` where 状況把握, 資料聴読解 and 総合読解 write one `document`,
 * its dialogue turns carry clip ids, and it carries the bank's measured
 * `model_p_correct`. Copied as it was, every example of those three types
 * failed its own type's validation.
 */
export function examplesFromBatches(opts: { batchDir?: string | null } = {}): Record<string, Item[]> {
  const batchDir = or(opts.batchDir ?? null, config.BATCH_DIR) as string;
  const gone = withdrawn.ids({ path: path.join(batchDir, withdrawn.LEDGER_NAME) });
  const failed = new Set<string>();
  for (const [itemId, entry] of regate.loadRegated({ path: path.join(batchDir, regate.REGATE_LEDGER_NAME) })) {
    if (entry.failed) failed.add(itemId);
  }
  const byType = new Map<string, Map<unknown, Item[]>>();
  for (const name of sorted(_jsonNames(batchDir))) {
    if (name.endsWith(".source.json")) {
      continue;
    }
    let bundle: Item;
    try {
      bundle = loads(readFileSync(path.join(batchDir, name), "utf8"));
    } catch (e) {
      if (!_unreadable(e)) throw e;
      continue;
    }
    if (!Array.isArray(get(bundle, "items")) || !truthy(get(bundle, "item_type"))) {
      continue;
    }
    const items = withdrawn.liveItems(bundle, { withdrawn: new Set([...gone, ...failed]) });
    if (!byType.has(bundle["item_type"])) byType.set(bundle["item_type"], new Map());
    const levels = byType.get(bundle["item_type"])!;
    const level = get(bundle, "level", "?");
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level)!.push(...items);
  }

  const out: Record<string, Item[]> = {};
  for (const [itemType, levels] of byType) {
    const chosen: Item[] = [];
    const queues = sorted(levels.keys()).map((lvl) => [...levels.get(lvl)!]);
    while (chosen.length < PER_TYPE && queues.some((q) => q.length > 0)) {
      for (const queue of queues) {
        if (queue.length && chosen.length < PER_TYPE) {
          chosen.push(queue.shift()!);
        }
      }
    }
    out[itemType] = chosen.map((item) => Object.fromEntries(
      Object.entries(batchmod.asGeneratorShape({ ...item, "item_type": itemType }))
        .filter(([k]) => !_NOT_AN_EXAMPLE_FIELD.includes(k))));
  }
  return out;
}

/** Write a `seeds/` the generators can use, from committed material only. */
export function bootstrap(opts: {
  seedsDir?: string | null;
  batchDir?: string | null;
  exampleDir?: string | null;
  force?: boolean;
} = {}): Bootstrap {
  const seedsDir = or(opts.seedsDir ?? null, config.SEEDS_DIR) as string;
  const exampleDir = or(opts.exampleDir ?? null, path.join(config.ROOT, "seeds.example")) as string;
  const force = opts.force ?? false;
  const result = new Bootstrap({ seeds_dir: seedsDir });

  if (hasLicensedSeeds({ seedsDir }) && !force) {
    result.skipped = (`${seedsDir} already holds seed material that is not bootstrapped; `
                      + "leaving it alone (--force overrides).");
    return result;
  }

  mkdirSync(path.join(seedsDir, "fewshot"), { recursive: true });
  mkdirSync(path.join(seedsDir, "vocab"), { recursive: true });

  for (const [itemType, examples] of Object.entries(examplesFromBatches({ batchDir: opts.batchDir ?? null }))) {
    writeFileSync(path.join(seedsDir, "fewshot", `${itemType}.json`),
                  dumps(examples, { ensureAscii: false, indent: 2 }) + "\n",
                  { encoding: "utf8" });
    result.fewshot[itemType] = examples.length;
  }

  // The business-term list in seeds.example is our own short list, not the
  // licensed one; it only ever adds a positive note to the quality report.
  const termsSrc = path.join(exampleDir, "vocab", "business_terms.txt");
  if (existsSync(termsSrc)) {
    const terms = splitlines(readFileSync(termsSrc, "utf8"))
      .filter((ln) => strip(ln) && !ln.startsWith("#"))
      .map((ln) => strip(ln));
    writeFileSync(path.join(seedsDir, "vocab", "business_terms.txt"), terms.join("\n") + "\n", { encoding: "utf8" });
    result.business_terms = terms.length;
  }

  writeFileSync(
    path.join(seedsDir, MARKER),
    "This seeds/ was built by `bjt seeds --bootstrap` from the reference batches in\n"
    + "batches/. It holds no licensed material: no official items, no JLPT kanji\n"
    + "tiers, no official level descriptors. Replace it with the real thing when you\n"
    + "have it — `bjt seeds --bootstrap` will not overwrite a real seeds/.\n",
    { encoding: "utf8" },
  );
  return result;
}
