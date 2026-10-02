/**
 * Fidelity mechanism #3 — the discriminator loop.
 *
 * Mix official sample items with generated ones and ask a judge model to identify
 * which are synthetic. Above-chance discrimination means there is a tell; the judge
 * is asked *why*, so its stated reasons can be folded back into the generator
 * prompt as explicit constraints. The discrimination rate is the headline fidelity
 * metric and should trend toward 50% (chance) over time.
 *
 * `runDiscriminator` is async: it asks the judge.
 */
import * as llm from "../llm.ts";
import { get, truthy, ValueError } from "../py.ts";
import { Random } from "../pyrandom.ts";
import * as schemas from "../schemas.ts";
import * as textutil from "../textutil.ts";

export class DiscriminatorResult {
  item_type: string;
  n_generated: number;
  n_official: number;
  discrimination_rate: number;  // fraction the judge labelled correctly (0.5 == chance)
  reasons: string[];

  constructor(init: {
    item_type: string;
    n_generated: number;
    n_official: number;
    discrimination_rate: number;
    reasons?: string[];
  }) {
    this.item_type = init.item_type;
    this.n_generated = init.n_generated;
    this.n_official = init.n_official;
    this.discrimination_rate = init.discrimination_rate;
    this.reasons = init.reasons ?? [];
  }
}

export function _carries(items: Record<string, any>[], part: string): number {
  if (part === "資料") {
    return items.filter((it) => schemas.documentsOf(it).length > 0).length;
  }
  return items.filter((it) => truthy(get(it, "dialogue"))).length;
}

/** Refuse a comparison that would measure the seed files instead of the items.
 *
 *  The judge is shown the whole stimulus, 資料 and 会話 included. If every
 *  generated item has a 資料 and no official sample does — which is how
 *  `seeds/official/*.json` arrives, since transcribing a printed table is work
 *  somebody has to do by hand — then "has a 資料" separates the two sides
 *  perfectly and the rate is 100% no matter how good the items are. That would
 *  be bad enough as a wrong number on a dashboard. It is worse than that here,
 *  because `bjt discriminate` folds the judge's stated tells back into the
 *  generator prompt: the next night's items would be written to avoid having a
 *  document at all.
 *
 *  So this is a fault in the comparison, not a result to report. It says which
 *  seed file to fix. */
export function _refuseLopsided(generated: Record<string, any>[], official: Record<string, any>[]): void {
  for (const part of ["資料", "会話"]) {
    const [ours, theirs] = [_carries(generated, part), _carries(official, part)];
    if (ours && !theirs) {
      throw new ValueError(
        `every one of the ${ours} generated item(s) with a ${part} is being `
        + `compared against official samples that have none, so the judge `
        + `can separate the two sides on that alone. Add the ${part} to the `
        + `official samples in seeds/official/, or discriminate a type that `
        + `does not have one.`,
      );
    }
  }
}

export async function runDiscriminator(
  itemType: string,
  generatedItems: Record<string, any>[],
  officialItems: Record<string, any>[],
  opts: { seed?: number | null } = {},
): Promise<DiscriminatorResult> {
  const seed = opts.seed ?? null;
  if (generatedItems.length === 0 || officialItems.length === 0) {
    throw new ValueError("need at least one generated and one official item");
  }

  _refuseLopsided(generatedItems, officialItems);

  const rng = new Random(seed);
  const labelled: [string, string][] = generatedItems.map((it) => [textutil.renderForDiscriminator(it), "synthetic"]);
  labelled.push(...officialItems.map((it): [string, string] => [textutil.renderForDiscriminator(it), "official"]));
  rng.shuffle(labelled);

  const rendered = labelled.map(([r]) => r);
  const truth = labelled.map(([, t]) => t);

  const result = await llm.judgeSynthetic(rendered);
  const guesses: unknown[] = get(result, "labels", []);
  const reasons: string[] = get(result, "reasons", []);

  // If the judge returned the wrong number of labels, score only the aligned prefix.
  const n = Math.min(guesses.length, truth.length);
  let correct = 0;
  for (let i = 0; i < n; i++) if (guesses[i] === truth[i]) correct += 1;
  const rate = n ? correct / n : 0.0;

  return new DiscriminatorResult({
    item_type: itemType,
    n_generated: generatedItems.length,
    n_official: officialItems.length,
    discrimination_rate: rate,
    reasons: reasons,
  });
}
