/**
 * Item-type generators. One module, prompt, and schema per type.
 *
 * All nine BJT types are represented, plus 画像把握, the picture variant of 場面把握. They are grouped by what their stimulus is
 * rather than by which section of the exam they belong to, because that is what
 * decides the shape of the code: an utterance, a heard scene, and a document need
 * different prompts, different validation, and different audio plans, while two
 * types from different sections that both hand you a document need the same ones.
 */
import type { Store } from "../db/store.ts";
import { has, KeyError, repr, sorted } from "../py.ts";
import type { Generator } from "./base.ts";
import { GazouHaakuGenerator } from "./gazou_haaku.ts";
import { GoiBunpouGenerator } from "./goi_bunpou.ts";
import { HatsugenChoukaiGenerator } from "./hatsugen_choukai.ts";
import { HyougenGenerator } from "./hyougen.ts";
import { BamenHaakuGenerator, SougouChoukaiGenerator } from "./listening.ts";
import {
  JoukyouHaakuGenerator,
  ShiryouChoudokkaiGenerator,
  SougouChoudokkaiGenerator,
  SougouDokkaiGenerator,
} from "./reading.ts";

export {
  BamenHaakuGenerator,
  GazouHaakuGenerator,
  GoiBunpouGenerator,
  HatsugenChoukaiGenerator,
  HyougenGenerator,
  JoukyouHaakuGenerator,
  ShiryouChoudokkaiGenerator,
  SougouChoudokkaiGenerator,
  SougouChoukaiGenerator,
  SougouDokkaiGenerator,
};

/** A generator class: what `GENERATORS` holds and `getGenerator` instantiates. */
export type GeneratorClass = new (opts?: { store?: Store | null }) => Generator;

/** Every generator, keyed by item type. The keys must match `item_types` in the
 *  database (d1/migrations). */
export const GENERATORS: Record<string, GeneratorClass> = Object.fromEntries(
  [
    // 聴解
    BamenHaakuGenerator,
    GazouHaakuGenerator,
    HatsugenChoukaiGenerator,
    SougouChoukaiGenerator,
    // 聴読解
    JoukyouHaakuGenerator,
    ShiryouChoudokkaiGenerator,
    SougouChoudokkaiGenerator,
    // 読解
    GoiBunpouGenerator,
    HyougenGenerator,
    SougouDokkaiGenerator,
  ].map((g): [string, GeneratorClass] => [new g().item_type, g]),
);

export function getGenerator(itemType: string, opts: { store?: Store | null } = {}): Generator {
  if (!has(GENERATORS, itemType)) {
    throw new KeyError(
      `no generator for ${repr(itemType)}; available: ${repr(sorted(Object.keys(GENERATORS)))}`,
    );
  }
  return new GENERATORS[itemType]({ store: opts.store ?? null });
}
