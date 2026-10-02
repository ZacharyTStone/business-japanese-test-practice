/**
 * The seed table — where item diversity actually comes from.
 *
 * The temptation with a generator is to make the prompt say "be varied" and hope.
 * That produces the same three scenarios forever. Instead, variety is a property of
 * the *input*: a committed table of axes (場面 × 関係 × 機能 × レベル) is enumerated
 * into concrete cells, each cell is consumed at most once, and the generator is
 * handed one cell per item. A run of ten items is ten different cells by
 * construction, not by luck.
 *
 * The table is our own design, not licensed material, so unlike `seeds/` it is
 * committed. Each cell also carries the reusable scene ids for its setting: the
 * listening types share a small bank of pictures, so the setting decides which
 * bank entries are legal. 画像把握 is the exception — its picture is the
 * question, so each of its items has one of its own (bjt/scenes.ts).
 *
 * A cell is valid when all three constraints hold:
 *   * the relation is one the setting can plausibly contain (`setting_relations`)
 *   * the relation is one the function can be performed on (`function.relations`)
 *   * the setting's channel is one the function can occur over (`function.channels`)
 *
 * That last one is what stops "来客を迎えて案内する" from being generated over the
 * phone. A function may also list the `settings` it belongs in; the picture
 * type needs that, because a picture of a whiteboard at the reception counter is
 * a picture nobody can describe with a straight face.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as config from "./config.ts";
import { FileNotFoundError, get, min, repr, sorted, truthy } from "./py.ts";
import { Random } from "./pyrandom.ts";

// Keyed by (directory, item_type) so pointing config.SEEDTABLE_DIR somewhere
// else — as the tests do — does not serve a stale table.
export const _CACHE: Map<string, SeedTable> = new Map();

/** One generation assignment: a specific situation to write an item about. */
export class Cell {
  readonly item_type: string;
  readonly setting: string;
  readonly relation: string;
  readonly function: string;
  readonly level: string;
  readonly channel: string;
  readonly scenes: readonly string[];
  // Japanese labels, carried along so the prompt and the CLI can show them.
  readonly setting_ja: string;
  readonly relation_ja: string;
  readonly function_ja: string;
  /** Document templates this setting may be rendered in — the reading types'
   *  equivalent of `scenes`. Empty for types whose stimulus is not a document. */
  readonly templates: readonly string[];

  constructor(init: {
    item_type: string;
    setting: string;
    relation: string;
    function: string;
    level: string;
    channel: string;
    scenes: readonly string[];
    setting_ja: string;
    relation_ja: string;
    function_ja: string;
    templates?: readonly string[];
  }) {
    this.item_type = init.item_type;
    this.setting = init.setting;
    this.relation = init.relation;
    this.function = init.function;
    this.level = init.level;
    this.channel = init.channel;
    this.scenes = init.scenes;
    this.setting_ja = init.setting_ja;
    this.relation_ja = init.relation_ja;
    this.function_ja = init.function_ja;
    this.templates = init.templates ?? [];
  }

  get id(): string {
    return `${this.setting}+${this.relation}+${this.function}@${this.level}`;
  }

  toDict(): { id: string; setting: string; relation: string; function: string; level: string; channel: string } {
    return {
      id: this.id,
      setting: this.setting,
      relation: this.relation,
      function: this.function,
      level: this.level,
      channel: this.channel,
    };
  }

  describeJa(): string {
    return `${this.setting_ja} / ${this.relation_ja} / ${this.function_ja}（${this.level}）`;
  }
}

/** What `SeedTable.coverage` reports. */
export type Coverage = {
  total_cells: number;
  used_cells: number;
  by_function: Record<string, number>;
  by_setting: Record<string, number>;
  scene_bank: number;
};

export class SeedTable {
  item_type: string;
  data: Record<string, any>;
  levels: string[];
  _settings: Map<string, Record<string, any>>;
  _relations: Map<string, Record<string, any>>;
  _functions: Map<string, Record<string, any>>;
  _settingRelations: Record<string, string[]>;
  _cells: readonly Cell[];

  constructor(itemType: string, data: Record<string, any>) {
    this.item_type = itemType;
    this.data = data;
    this.levels = get(data, "levels", []);
    this._settings = new Map((get(data, "settings", []) as Record<string, any>[]).map((s) => [s["id"], s]));
    this._relations = new Map((get(data, "relations", []) as Record<string, any>[]).map((r) => [r["id"], r]));
    this._functions = new Map((get(data, "functions", []) as Record<string, any>[]).map((f) => [f["id"], f]));
    this._settingRelations = get(data, "setting_relations", {});
    this._cells = [...this._enumerate()];
  }

  // -- enumeration -------------------------------------------------------

  *_enumerate(): Generator<Cell> {
    for (const [sId, s] of this._settings) {
      const allowedRelations = new Set<string>(get(this._settingRelations, sId, []));
      for (const [fId, f] of this._functions) {
        if (!(get(f, "channels", []) as string[]).includes(s["channel"])) {
          continue;
        }
        // A function may name the settings it makes sense in (a
        // whiteboard is not at the reception counter). Absent, any
        // setting whose channel fits.
        if (truthy(get(f, "settings")) && !(f["settings"] as string[]).includes(sId)) {
          continue;
        }
        for (const rId of get(f, "relations", []) as string[]) {
          if (!allowedRelations.has(rId) || !this._relations.has(rId)) {
            continue;
          }
          for (const level of this.levels) {
            yield new Cell({
              item_type: this.item_type,
              setting: sId,
              relation: rId,
              function: fId,
              level: level,
              channel: s["channel"],
              scenes: [...get(s, "scenes", [])],
              templates: [...get(s, "templates", [])],
              setting_ja: get(s, "ja", sId),
              relation_ja: get(this._relations.get(rId), "ja", rId),
              function_ja: get(f, "ja", fId),
            });
          }
        }
      }
    }
  }

  cells(opts: { level?: string | null } = {}): Cell[] {
    const level = opts.level ?? null;
    return this._cells.filter((c) => level === null || c.level === level);
  }

  get(cellId: string): Cell | null {
    return this._cells.find((c) => c.id === cellId) ?? null;
  }

  /** Every scene id the table can ask for — the image bank to commission. */
  get scene_bank(): string[] {
    const seen: string[] = [];
    for (const s of this._settings.values()) {
      for (const sc of get(s, "scenes", []) as string[]) {
        if (!seen.includes(sc)) {
          seen.push(sc);
        }
      }
    }
    return seen;
  }

  /** scene id → what the picture shows. Lives in the table rather than
   *  being inferred from the settings that use it: a scene like
   *  `scene_phone_desk` is shared by several settings, and guessing its label
   *  from whichever one happens to come first gets it wrong. */
  get scene_labels(): Record<string, string> {
    return { ...get(this.data, "scenes", {}) };
  }

  // -- sampling ----------------------------------------------------------

  /**
   * Pick n unused cells, spread as widely as the axes allow.
   *
   * Uniform random sampling clumps: with 22 functions and 10 settings you can
   * easily draw three 電話 items in a row. So we sample greedily instead —
   * each pick prefers a setting and a function not yet used in this batch,
   * and only starts reusing an axis value once every value has been used
   * once. That is what makes "ten items" mean "ten genuinely different
   * situations".
   */
  sample(
    n: number,
    opts: { level?: string | null; excludeIds?: Iterable<string>; seed?: number | null } = {},
  ): Cell[] {
    const excluded = new Set<string>(opts.excludeIds ?? []);
    const pool = this.cells({ level: opts.level ?? null }).filter((c) => !excluded.has(c.id));
    const rng = new Random(opts.seed ?? null);
    rng.shuffle(pool);

    const picked: Cell[] = [];
    const usedSettings = new Map<string, number>();
    const usedFunctions = new Map<string, number>();
    const count = Math.min(n, pool.length);
    for (let k = 0; k < count; k++) {
      const best = min(pool, (c) => [
        (usedSettings.get(c.setting) ?? 0) + (usedFunctions.get(c.function) ?? 0),
        usedFunctions.get(c.function) ?? 0,
      ]);
      pool.splice(pool.indexOf(best), 1);
      picked.push(best);
      usedSettings.set(best.setting, (usedSettings.get(best.setting) ?? 0) + 1);
      usedFunctions.set(best.function, (usedFunctions.get(best.function) ?? 0) + 1);
    }
    return picked;
  }

  // -- reporting ---------------------------------------------------------

  coverage(usedIds: Iterable<string>): Coverage {
    const used = new Set<string>(usedIds);
    const total = this._cells.length;
    const byFunction: Record<string, number> = {};
    for (const f of this._functions.keys()) byFunction[f] = 0;
    const bySetting: Record<string, number> = {};
    for (const s of this._settings.keys()) bySetting[s] = 0;
    for (const c of this._cells) {
      if (used.has(c.id)) {
        byFunction[c.function] += 1;
        bySetting[c.setting] += 1;
      }
    }
    const ids = new Set(this._cells.map((c) => c.id));
    return {
      total_cells: total,
      used_cells: [...used].filter((u) => ids.has(u)).length,
      by_function: byFunction,
      by_setting: bySetting,
      scene_bank: this.scene_bank.length,
    };
  }
}

/**
 * Load (and cache) the seed table for an item type.
 *
 * Raises FileNotFoundError when a type has no table yet — that is deliberate:
 * a generator without a seed table would fall back to prompt-driven variety,
 * which is the failure mode this whole module exists to prevent.
 */
export function load(itemType: string): SeedTable {
  const key = JSON.stringify([String(config.SEEDTABLE_DIR), itemType]);
  const cached = _CACHE.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const p = path.join(config.SEEDTABLE_DIR, `${itemType}.json`);
  if (!existsSync(p)) {
    throw new FileNotFoundError(`no seed table for ${repr(itemType)} at ${p}`);
  }
  const data = JSON.parse(readFileSync(p, "utf8"));
  const table = new SeedTable(itemType, data);
  _CACHE.set(key, table);
  return table;
}

/** Item types that have a seed table committed. */
export function available(): string[] {
  if (!existsSync(config.SEEDTABLE_DIR)) {
    return [];
  }
  return sorted(
    readdirSync(config.SEEDTABLE_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.basename(name, ".json")),
  );
}
