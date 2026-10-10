/**
 * What to write next, decided by counting rather than by taste.
 *
 * The app's queue can only do its job if the bank underneath it is the right
 * shape. It serves three levels, spreads a set across problem types so nobody gets
 * five 語彙・文法 in a row, and slips in one item from the level above — and every
 * one of those promises is empty when the library is 40 items of one type at one
 * level and six of everything else. A queue cannot interleave what is not there.
 *
 * So the bank has 30 shelves — ten problem types × three levels — and the job of
 * the nightly run is to **fill the shelf that is furthest behind its share of the
 * exam**. That is the whole algorithm:
 *
 *     give the first few items to the emptiest READING shelves (the floor);
 *     while there is budget left:
 *         give the next item to the shelf furthest behind its share,
 *         skipping any shelf that has no unspent seed cells
 *         or has already taken its share of this run
 *         or belongs to a type that has had its night's allowance
 *
 * "Furthest behind its share" rather than "fewest items" because the exam does not
 * ask the same number of every type: 場面把握 and 状況把握 are five-question types
 * where the other seven are ten (`schemas.EXAM_QUESTIONS`). Levelling all thirty
 * shelves flat therefore builds a bank in the wrong shape — deepest, in
 * proportional terms, in exactly the two types a learner meets least often. With
 * equal shares the two rules are the same.
 *
 * It has three properties worth the plainness. It is *deterministic*: the same
 * library produces the same work order, so a run is reviewable before it is made.
 * It *converges*: repeated runs level the shelves rather than deepening whichever
 * type happens to be easiest to generate. And it *stops*: a shelf whose seed table
 * is exhausted drops out, which turns "will we run out of questions?" into a
 * number this module prints.
 *
 * Two caps keep a night's work reviewable by a person:
 *
 *   * `budget` — how many items the whole run may write. Content that nobody
 *     reads is worse than no content, and a human has to read this.
 *   * `per_slot` — how many may go into one shelf. Without it a single run can
 *     write thirty items of one type, which is one big risk instead of four small
 *     ones, and a diff nobody finishes.
 *
 * What this module deliberately does NOT do is look at learners. Targeting an
 * individual with a generation run is the wrong shape —
 * it costs money per person, it leaks a profile into a prompt, and it cannot be
 * reviewed before it is served. Weakness targeting happens in the *queue*, over a
 * bank that is already published, which is where it is free and reversible. This
 * module only makes sure the queue has something to choose from.
 */
import * as batchmod from "./batch.ts";
import { unreadable } from "./files.ts";
import {
  FileNotFoundError, get, isodateUtc, isoformatUtc, len, ljust, max, min, or, rjust, round, sorted, sum, truthy,
} from "./py.ts";
import * as schemas from "./schemas.ts";
import * as seedtable from "./seedtable.ts";
import { shelfKey, shelfOf } from "./shelf_rest.ts";
import * as withdrawn from "./withdrawn.ts";

/** Below this many items, a shelf of a ten-question type is thin enough that the
 *  queue notices: a set of five cannot avoid repeating a type that only has a
 *  handful published. A five-question type is held to half of it, for the same
 *  reason the fill is share-relative — see `Shelf.target`. Reporting only; the
 *  greedy fill needs no threshold. */
export const DEFAULT_FLOOR = 12;

/** Most items one run may write into one (type, level) shelf. One of two,
 *  so a night always reaches two shelves. */
export const DEFAULT_PER_SLOT = 1;

/** Most items one run may write at all. Two a night, from 2026-10-08: the
 *  owner would rather have one or two questions that are right than three, and
 *  a night of three spent ~$0.39 for ~1.3 kept items. The gates are unchanged;
 *  only how many shelves a night tries is smaller, so each night's fifty cents
 *  goes to two shelves' drafts and retries instead of three. A question nobody
 *  reaches is money spent on nothing, and the bank still grows by about ten a
 *  week. */
export const DEFAULT_BUDGET = 2;

/** How many of the night's items go to the reading shelves (語彙・文法, 表現読解,
 *  総合読解) before the emptiest-first rule sees the rest. Reading items need no
 *  audio and no picture, so they are the cheapest item to ship and the one kind
 *  a night should never come back without. The floor, not the ceiling: the
 *  main rule can still hand the rest of the night to reading shelves when
 *  they are the furthest behind. The floor takes the emptiest reading shelves
 *  first, exactly as the main rule does, and yields whatever it cannot place
 *  back to the main rule. */
export const DEFAULT_READING_MIN = 1;

/** Most items a night may write of a type that should stay uncommon. 画像把握
 *  is one: each item needs a picture of its own, drawn and reviewed at a cost
 *  no shared-bank item has, and it is meant to be a rare question rather than a
 *  common one. Without this, three empty shelves of a new type are the emptiest
 *  in the bank and would take every night for a week. */
export const NIGHT_TYPE_CAPS: Record<string, number> = { "gazou_haaku": 1 };

/** One (item type, level) pair, and what is on it. */
export class Shelf {
  readonly item_type: string;
  readonly level: string;
  /** Items already committed to `batches/` for this pair. */
  readonly have: number;
  /** Seed cells at this level that no committed item has spent yet. */
  readonly cells_left: number;

  constructor(init: { item_type: string; level: string; have: number; cells_left: number }) {
    this.item_type = init.item_type;
    this.level = init.level;
    this.have = init.have;
    this.cells_left = init.cells_left;
  }

  /**
   * How deep this shelf should be before it stops being thin.
   *
   * Scaled by the type's share of the exam, so a five-question type is not
   * held to the depth of a ten-question one. A learner meets 場面把握 half as
   * often as 発言聴解, so half the shelf goes half as far in exactly the same
   * sense.
   */
  get target(): number {
    return Math.max(1, round(DEFAULT_FLOOR * get(schemas.EXAM_QUESTIONS, this.item_type, 10) / 10));
  }

  get thin(): boolean {
    return this.have < this.target;
  }
}

/** One line of the work order: write `n` items for this pair. */
export class WorkItem {
  readonly item_type: string;
  readonly level: string;
  readonly n: number;
  readonly have: number;
  readonly cells_left: number;

  constructor(init: { item_type: string; level: string; n: number; have: number; cells_left: number }) {
    this.item_type = init.item_type;
    this.level = init.level;
    this.n = init.n;
    this.have = init.have;
    this.cells_left = init.cells_left;
  }
}

export class Survey {
  shelves: Shelf[];

  constructor(init: { shelves?: Shelf[] } = {}) {
    this.shelves = init.shelves ?? [];
  }

  get items(): number {
    return sum(this.shelves.map((s) => s.have));
  }

  get cells_left(): number {
    return sum(this.shelves.map((s) => s.cells_left));
  }

  get empty(): Shelf[] {
    return this.shelves.filter((s) => s.have === 0);
  }

  get thin(): Shelf[] {
    return this.shelves.filter((s) => s.thin);
  }
}

/** Every live item of every committed bundle that can be read, with its
 *  bundle. A bundle that cannot be read (`files.unreadable`, or our own
 *  FileNotFoundError) is skipped. */
function* _liveItems(): Generator<[Record<string, any>, Record<string, any>]> {
  const gone = withdrawn.ids();
  for (const p of batchmod.bundles()) {
    let bundle: Record<string, any>;
    try {
      bundle = batchmod.load(p);
    } catch (e) {
      if (unreadable(e) || e instanceof FileNotFoundError) continue;
      throw e;
    }
    for (const item of withdrawn.liveItems(bundle, { withdrawn: gone })) {
      yield [bundle, item];
    }
  }
}

/**
 * How many items each (type, level) pair has in the committed bundles, keyed
 * by `shelfKey(item_type, level)`.
 *
 * The bundles are the ledger rather than the local SQLite database, for the
 * same reason `batch.spentCellIds` uses them: the database is gitignored, so
 * on a fresh clone — which is what CI is, every time — it reports an empty
 * library while the whole bank sits in the tree.
 *
 * A withdrawn item (`batches/withdrawn.txt`) is not on the shelf: it is no
 * longer served, so the shelf it came from is that much emptier and the
 * planner refills it. Its seed cell stays spent (`spentCellIds` counts it),
 * because a new item written for that cell would inherit the withdrawn id.
 */
export function _publishedCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [bundle, item] of _liveItems()) {
    const itemType = get(bundle, "item_type");
    const level = or(get(item, "level"), get(bundle, "level"));
    if (truthy(itemType) && truthy(level)) {
      const k = shelfKey(itemType, level);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return counts;
}

/** Every shelf, with what is on it and how much room is left. */
export function survey(opts: { itemTypes?: Iterable<string> | null } = {}): Survey {
  const counts = _publishedCounts();
  const out = new Survey();
  const itemTypes = opts.itemTypes == null ? null : [...opts.itemTypes];
  for (const itemType of sorted(truthy(itemTypes) ? itemTypes! : seedtable.available())) {
    let table: seedtable.SeedTable;
    try {
      table = seedtable.load(itemType);
    } catch (e) {
      if (e instanceof FileNotFoundError) continue;
      throw e;
    }
    const spent = batchmod.spentCellIds(itemType);
    for (const level of table.levels) {
      const cells = table.cells({ level });
      out.shelves.push(
        new Shelf({
          item_type: itemType,
          level: level,
          have: counts.get(shelfKey(itemType, level)) ?? 0,
          cells_left: cells.filter((c) => !spent.has(c.id)).length,
        }),
      );
    }
  }
  return out;
}

/**
 * Fill the shelf furthest behind its share, until the budget runs out.
 *
 * A shelf in `resting` — one that has written nothing night after night
 * (bjt/shelf_rest.ts) — is passed over, and its share of the night goes to
 * the next shelf behind, so a shelf the generator cannot write does not take
 * every night's budget. `resting` holds shelf keys (`shelfKey(item_type,
 * level)`): the `Map` `shelf_rest.load` returns (its keys are the shelves, as
 * a Python dict iterates its keys), or any iterable of keys.
 *
 * Two passes of the same greedy rule. The first hands `reading_min` items to
 * the reading shelves alone (furthest behind first among them); the second
 * hands the rest of the budget to every shelf on the same rule, counting what
 * the first pass placed. A reading floor that cannot be filled — every reading
 * shelf out of cells, or capped — gives its remainder back to the second pass.
 *
 * Ties are broken by item type and then by level, so the order is a function of
 * the library and nothing else — run it twice on the same tree and you get the
 * same plan, which is what makes it reviewable before it is executed.
 */
export function workOrder(
  surveyResult: Survey,
  opts: {
    budget?: number;
    perSlot?: number;
    readingMin?: number;
    resting?: ReadonlyMap<string, unknown> | Iterable<string>;
  } = {},
): WorkItem[] {
  const perSlot = opts.perSlot ?? DEFAULT_PER_SLOT;
  const readingMin = opts.readingMin ?? DEFAULT_READING_MIN;
  const assigned = new Map<string, number>();
  const restingIn = opts.resting ?? [];
  const resting = new Set<string>(restingIn instanceof Map ? restingIn.keys() : (restingIn as Iterable<string>));
  const shelves = surveyResult.shelves.filter((s) => !resting.has(shelfKey(s.item_type, s.level)));
  const budget = Math.max(opts.budget ?? DEFAULT_BUDGET, 0);

  const byType = (itemType: string): number => {
    let n = 0;
    for (const [k, count] of assigned) {
      if (shelfOf(k)[0] === itemType) n += count;
    }
    return n;
  };

  /**
   * How full this shelf is, measured against the exam rather than against
   * the other shelves.
   *
   * Taking the smallest `have` would level all thirty shelves to the same
   * depth — and the exam does not ask the same number of every type.
   * 場面把握 and 状況把握 are five-question types where the rest are ten, so
   * a bank levelled flat over-supplies exactly the two types a learner meets
   * least. Dividing by the share turns "emptiest" into "furthest behind its
   * share", which levels the bank into the shape of the exam and is the same
   * greedy rule otherwise.
   */
  const fullness = (s: Shelf): number => {
    const have = s.have + (assigned.get(shelfKey(s.item_type, s.level)) ?? 0);
    return have / get(schemas.EXAM_QUESTIONS, s.item_type, 10);
  };

  const place = (n: number, candidates: Shelf[]): string[] => {
    const placed: string[] = [];
    for (let i = 0; i < n; i++) {
      const eligible = candidates.filter(
        (s) =>
          (assigned.get(shelfKey(s.item_type, s.level)) ?? 0) < Math.min(perSlot, s.cells_left)
          && byType(s.item_type) < get(NIGHT_TYPE_CAPS, s.item_type, budget),
      );
      if (eligible.length === 0) {
        break;
      }
      const target = min(eligible, (s) => [
        fullness(s),
        s.item_type,
        s.level,
      ]);
      const key = shelfKey(target.item_type, target.level);
      assigned.set(key, (assigned.get(key) ?? 0) + 1);
      placed.push(key);
    }
    return placed;
  };

  const reading = shelves.filter((s) => schemas.READING_TYPES.includes(s.item_type));
  const floor = place(Math.min(Math.max(readingMin, 0), budget), reading);
  place(budget - floor.length, shelves);

  const byKey = new Map<string, Shelf>(shelves.map((s) => [shelfKey(s.item_type, s.level), s]));
  return (
    // The reading floor first, then furthest behind first. The night runs
    // the order top to bottom and its ceilings can end it anywhere, so the
    // order is a promise about what a truncated night still wrote: the
    // reading item a night must never come back without, and after it the
    // most useful of the rest. A shelf the floor and the main rule both
    // reached is one line, at the floor's place.
    sorted([...assigned], {
      key: ([k]) => [
        !floor.includes(k),
        byKey.get(k)!.have / get(schemas.EXAM_QUESTIONS, shelfOf(k)[0], 10),
        shelfOf(k),
      ],
    }).map(([k, n]) => {
      const [itemType, level] = shelfOf(k);
      return new WorkItem({
        item_type: itemType,
        level: level,
        n: n,
        have: byKey.get(k)!.have,
        cells_left: byKey.get(k)!.cells_left,
      });
    })
  );
}

/** A resting shelf's line in `toJson`. */
export type RestingJson = { item_type: string; level: string; until: string };

export type PlanJson = {
  shelves: { item_type: string; level: string; have: number; cells_left: number }[];
  totals: { items: number; cells_left: number; empty_shelves: number; thin_shelves: number };
  work_order: { item_type: string; level: string; n: number; have: number; cells_left: number }[];
  planned_items: number;
  reading_items: number;
  resting: RestingJson[];
};

/** `sorted(resting.items())`: by shelf. */
function _restingSorted(resting: ReadonlyMap<string, Date>): [string, Date][] {
  return sorted([...resting], { key: ([k]) => shelfOf(k) });
}

export function toJson(surveyResult: Survey, order: readonly WorkItem[],
                       opts: { resting?: ReadonlyMap<string, Date> | null } = {}): PlanJson {
  const resting = opts.resting ?? new Map<string, Date>();
  return {
    "shelves": surveyResult.shelves.map((s) => ({
      "item_type": s.item_type,
      "level": s.level,
      "have": s.have,
      "cells_left": s.cells_left,
    })),
    "totals": {
      "items": surveyResult.items,
      "cells_left": surveyResult.cells_left,
      "empty_shelves": surveyResult.empty.length,
      "thin_shelves": surveyResult.thin.length,
    },
    "work_order": order.map((w) => ({
      "item_type": w.item_type,
      "level": w.level,
      "n": w.n,
      "have": w.have,
      "cells_left": w.cells_left,
    })),
    "planned_items": sum(order.map((w) => w.n)),
    "reading_items": sum(order.filter((w) => schemas.READING_TYPES.includes(w.item_type)).map((w) => w.n)),
    "resting": _restingSorted(resting).map(([k, until]) => {
      const [t, lvl] = shelfOf(k);
      return { "item_type": t, "level": lvl, "until": isoformatUtc(until) };
    }),
  };
}

/**
 * (items carrying a difficulty signal, items published).
 *
 * `model_p_correct` is the only term in the queue's ranking
 * (client/worker/core/queue.ts `nextItems`) that separates two
 * items of the same type and level, and it is written at generation time or
 * not at all — so a bundle that arrived through `bjt importbatch` has none.
 * Left uncounted that is invisible: the ranking term falls back to a constant,
 * which is not wrong for any one item and does nothing across all of them.
 * Counting it here puts it on the same screen as the shelves, because "the
 * queue cannot tell these apart" is a fact about the bank's shape.
 */
function _difficultyCoverage(): [number, number] {
  let have = 0;
  let total = 0;
  for (const [, item] of _liveItems()) {
    total += 1;
    have += Number(get(item, "model_p_correct") != null);
  }
  return [have, total];
}

/** What the tests fake: `render` reads the coverage through
 *  `seams.difficultyCoverage`, so a test that replaces it there
 *  (`patch(plan.seams, "difficultyCoverage", ...)`) is obeyed by `render` and
 *  by every caller of `difficultyCoverage()`. */
export const seams = { difficultyCoverage: _difficultyCoverage };

/** See `_difficultyCoverage`. */
export function difficultyCoverage(): [number, number] {
  return seams.difficultyCoverage();
}

/** The work order as something a person reads before approving it.
 *  `resting` (shelf → when it is tried again) says which shelves the order
 *  passed over, and why. */
export function render(surveyResult: Survey, order: readonly WorkItem[],
                       opts: { resting?: ReadonlyMap<string, Date> | null } = {}): string {
  const resting = opts.resting ?? null;
  const lines: string[] = [];
  lines.push("The bank, shelf by shelf (items published / seed cells left)");
  lines.push("");
  const byType = new Map<string, Shelf[]>();
  for (const s of surveyResult.shelves) {
    if (!byType.has(s.item_type)) byType.set(s.item_type, []);
    byType.get(s.item_type)!.push(s);
  }
  const width = byType.size ? max([...byType.keys()].map((t) => len(t))) : 0;
  for (const [itemType, shelves] of byType) {
    const cells = shelves.map(
      (s) => `${s.level} ${rjust(String(s.have), 3)} / ${ljust(String(s.cells_left), 5)}`,
    ).join("   ");
    const mark = shelves.some((s) => s.thin) ? "  ←thin" : "";
    lines.push(`  ${ljust(itemType, width)}  ${cells}${mark}`);
  }
  lines.push("");
  lines.push(
    `  ${surveyResult.items} item(s) published; ` +
    `${surveyResult.empty.length} empty shelf/shelves, ` +
    `${surveyResult.thin.length} below the type's share of ${DEFAULT_FLOOR}; ` +
    `${surveyResult.cells_left} seed cell(s) left.`,
  );
  const pulled = withdrawn.ids().size;
  if (pulled) {
    lines.push(`  ${pulled} withdrawn after review and not counted ` +
               `(batches/${withdrawn.LEDGER_NAME}).`);
  }
  const [have, total] = seams.difficultyCoverage();
  if (total) {
    lines.push(
      `  ${have}/${total} carry a difficulty signal`
      + (have === total ? "." :
         " — for the rest the queue's difficulty term is a constant, so it " +
         "sorts nothing. `bjt probe --all` measures them."),
    );
  }
  lines.push("");

  if (truthy(resting)) {
    lines.push("Resting tonight — nothing written on their last nights, so the " +
               "budget goes elsewhere (bjt/shelf_rest.ts):");
    for (const [k, until] of _restingSorted(resting!)) {
      const [itemType, level] = shelfOf(k);
      lines.push(`   ${itemType} ${level}   tried again from ${isodateUtc(until)}`);
    }
    lines.push("");
  }

  if (order.length === 0) {
    lines.push("Nothing to write: every shelf is out of seed cells"
               + (truthy(resting) ? " or resting." : "."));
    return lines.join("\n");
  }

  const reading = sum(order.filter((w) => schemas.READING_TYPES.includes(w.item_type)).map((w) => w.n));
  lines.push(`Work order — ${sum(order.map((w) => w.n))} item(s), furthest behind its ` +
             `share of the exam first; ` +
             `${reading} of them 読解 (reading first, then the rest)`);
  lines.push("");
  for (const w of order) {
    lines.push(
      `  ${rjust(String(w.n), 2)} × ${w.item_type} ${w.level}` +
      `   (has ${w.have}, ${w.cells_left} cell(s) left)`,
    );
  }
  return lines.join("\n");
}
