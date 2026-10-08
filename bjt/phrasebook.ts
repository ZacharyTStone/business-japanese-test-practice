/**
 * The stock lines of office Japanese, in the one wording the library records.
 *
 * Audio clips are content-addressed — `bjt/tts/plan.ts` hashes (voice, channel,
 * text) — so an utterance that occurs in twenty items is synthesised once, *if*
 * its text is byte-identical every time. A model writing 「少々お待ちください」
 * one night and 「少々お待ち下さい」 the next produces two clips of one phrase,
 * and a bank in which the same formula is heard in slightly different words,
 * which is not how an office sounds either.
 *
 * So the generator is shown this list for the types whose options or dialogue
 * are spoken, and asked to use these exact wordings whenever a line *is* one of
 * these formulas. Two sources, both small:
 *
 *   * `STOCK_LINES` — the fixed formulas of business Japanese, spelled the way
 *     the reference batches spell them.
 *   * `libraryLines()` — every spoken line the committed bank already uses
 *     more than once. A line that has recurred is a line the library has a
 *     voice for.
 *
 * This is a nudge toward reuse where reuse is right, not a quota: a distractor
 * that has to be wrong in a particular way is still written fresh. Nothing here
 * is licensed material — these are the phrases on every business-manners poster.
 */
import * as batchmod from "./batch.ts";
import { unreadable } from "./files.ts";
import { counter, get, getitem, mostCommon } from "./py.ts";
import * as withdrawn from "./withdrawn.ts";

/** Spelled once, here, and nowhere else. Keep the punctuation: it is part of
 *  the hash. */
export const STOCK_LINES: readonly string[] = [
  "いつもお世話になっております。",
  "お世話になっております。",
  "かしこまりました。",
  "承知いたしました。",
  "承知しました。",
  "少々お待ちください。",
  "少々お待ちいただけますでしょうか。",
  "お待たせいたしました。",
  "恐れ入りますが、",
  "お手数をおかけしますが、",
  "申し訳ございません。",
  "失礼いたします。",
  "お疲れさまです。",
  "お先に失礼いたします。",
  "ただいま席を外しております。",
  "折り返しご連絡いたします。",
  "よろしくお願いいたします。",
  "ありがとうございます。",
];

/** Types whose options or dialogue turns are spoken, and so have clips to share. */
export const SPOKEN_TYPES: ReadonlySet<string> = new Set([
  "hatsugen_choukai", "sougou_choukai", "sougou_choudokkai", "gazou_haaku",
]);

/** Spoken lines the committed bank already uses more than once, most
 *  common first. Read from the bundles' audio manifests, so what counts is
 *  exactly what has a clip. A withdrawn item's lines are not the library's:
 *  its wording is the reason it was withdrawn often enough. */
export function libraryLines(opts: { minCount?: number; limit?: number } = {}): string[] {
  const minCount = opts.minCount ?? 2;
  const limit = opts.limit ?? 20;
  const texts: string[] = [];
  const gone = withdrawn.ids();
  for (const p of batchmod.bundles()) {
    let bundle: Record<string, any>;
    try {
      bundle = batchmod.load(p);
    } catch (e) {
      // (OSError, json.JSONDecodeError): a bundle that cannot be read adds
      // nothing to the phrasebook.
      if (unreadable(e)) continue;
      throw e;
    }
    for (const clip of get(withdrawn.liveBundle(bundle, { withdrawn: gone }), "audio_manifest", []) as Record<string, any>[]) {
      if (["option", "dialogue"].includes(get(clip, "kind"))) {
        texts.push(getitem(clip, "text"));
      }
    }
  }
  // Counter.most_common: by count, ties in the order first seen.
  const counts = counter(texts);
  return mostCommon(counts, limit)
    .filter(([text, n]) => n >= minCount && !STOCK_LINES.includes(text))
    .map(([text]) => text);
}

/** The lines, as a paragraph of the system prompt, or nothing for a type
 *  whose options are read rather than heard. */
export function promptBlock(itemType: string): string {
  if (!SPOKEN_TYPES.has(itemType)) {
    return "";
  }
  const lines = [...STOCK_LINES, ...libraryLines()];
  return (
    "Stock phrases. The library's audio is shared between items, so when a "
    + "spoken line (an option, or a turn of a conversation) IS one of the standard "
    + "formulas below, write it in exactly this wording — same kanji, same "
    + "punctuation — rather than a variant. Do not force one in where the "
    + "situation does not call for it:\n"
    + lines.map((line) => `- ${line}`).join("\n")
  );
}
