/**
 * The chart block: figures drawn as a bar or a line graph, from numbers.
 *
 * 資料聴読解 on the real paper often puts a graph in front of the candidate and
 * asks about it together with what is heard — which month fell, which branch
 * overtook which, whether a figure cleared its target once the speaker has said
 * what to leave out. Reading a trend off bars is a different skill from finding a
 * cell in a table, and a document with only tables cannot ask for it.
 *
 * A chart is data like every other block, never a picture. An image model cannot
 * put 4月 under the right bar any more reliably than it can spell 御中, and a
 * picture could be neither read aloud nor checked. The model emits categories and
 * numbers; we draw them — `html.ts` for a page, `client/src/ui/chart.tsx` (with
 * the geometry in `plot.ts`) for the app — and we write them out as text
 * (`text`) for every reader that is a model: the answerability gate's two
 * views, the proofreader, the difficulty probe and the discriminator all see each
 * figure beside its label, because `document.textOf` is what they read.
 *
 * Two kinds, bar and line. A bar compares a few groups; a line follows one
 * quantity through time. A pie is left out on purpose: it is read by angle, which
 * nobody can do to the precision a question needs.
 *
 * **The bounds are legibility on a phone,** where a document gets about three
 * hundred points of width. Eight groups of up to three bars still fit, standing
 * where the columns have room and laid on their side where they do not; a line
 * has room for twelve points, a year of months. A label longer than eight
 * characters does not fit under its group, a figure of seven digits does not fit
 * on its bar or its axis — which is why a printed chart says 1,250万円 rather than
 * 12,500,000円 — and a fourth series is more than a legend can keep apart without
 * colour, which a document does not use: inside the sheet everything is ink.
 * The validator holds all of this, so a draft outside it is sent back with the
 * reason rather than drawn badly.
 */
import { fixed, get, isDict, iterOf, len, or, repr, round, rstrip, str, strip, truthy, zip } from "../py.ts";

/** What a chart may draw. See the module docstring for why not a pie. */
export const CHART_KINDS = ["bar", "line"];

/** How each kind is named when a chart is written out as text. */
export const KIND_JA: Record<string, string> = { bar: "棒グラフ", line: "折れ線グラフ" };

export const MAX_SERIES = 3;
export const MIN_CATEGORIES = 2;
export const MAX_CATEGORIES: Record<string, number> = { bar: 8, line: 12 };
/** A category sits under its own group of bars; eight characters is two lines
 *  of four there (「第1四半期」「東日本エリア」「2026年度」). */
export const CATEGORY_MAX_CHARS = 8;
/** A series name sits in the legend, which wraps. */
export const SERIES_NAME_MAX_CHARS = 12;
export const CAPTION_MAX_CHARS = 40;
export const UNIT_MAX_CHARS = 8;
/** Every figure is smaller than this in absolute value: at most six digits
 *  before the point. Choose the unit so that it fits, as print does. */
export const VALUE_LIMIT = 1_000_000;
/** …and at most two after it. */
export const MAX_DECIMALS = 2;
/** One chart per document. Two graphs on a phone screen is a scrolling test. */
export const MAX_PER_DOCUMENT = 1;

/** A chart as `normalised` returns it. */
export type Chart = {
  kind: string;
  caption: string;
  unit: string;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
};

/** A real, finite number. `true` is an int to Python and not a figure to
 *  anybody, and NaN would reach a bundle as `NaN`, which is not JSON. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Commas between the thousands of a number already written out
 *  (`f"{n:,}"`, `f"{x:,.2f}"`). */
function grouped(written: string): string {
  const sign = written.startsWith("-") ? "-" : "";
  const [whole, frac] = written.replace(/^-/, "").split(".");
  const g = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + g + (frac === undefined ? "" : "." + frac);
}

/** A figure as print sets it: thousands separated, no trailing zeros.
 *  The app writes the same string (`formatValue` in client/src/ui/plot.ts). */
export function formatValue(value: unknown): string {
  if (!isNumber(value)) {
    return "—";
  }
  if (Number.isInteger(value)) {
    return grouped(BigInt(value).toString());
  }
  return rstrip(rstrip(grouped(fixed(value, MAX_DECIMALS)), "0"), ".");
}

function _labels(value: unknown): string[] {
  return Array.isArray(value) ? value.map((x) => str(x)) : [];
}

/** The chart as something every renderer can draw without asking questions.
 *
 *  Validation happens upstream and a published chart has passed it; this is
 *  the belt to that brace, because a renderer is the one place a malformed
 *  block must not raise — a learner is in the middle of reading. Unknown kinds
 *  draw as bars, missing labels as blanks, a value that is not a number as a
 *  gap, and a series is cut or padded to the categories it has. */
export function normalised(block: Record<string, any>): Chart {
  const categories = _labels(get(block, "categories"));
  const series: Chart["series"] = [];
  for (const s of iterOf(or(get(block, "series"), []))) {
    if (!isDict(s) || series.length >= MAX_SERIES) {
      continue;
    }
    let raw = get(s, "values");
    if (!Array.isArray(raw)) {
      raw = [];
    }
    const values: (number | null)[] = (raw as unknown[])
      .slice(0, categories.length)
      .map((v) => (isNumber(v) ? v : null));
    while (values.length < categories.length) values.push(null);
    series.push({ name: strip(str(or(get(s, "name"), ""))), values });
  }
  const kind = get(block, "kind");
  return {
    kind: CHART_KINDS.includes(kind) ? kind : "bar",
    caption: str(or(get(block, "caption"), "")),
    unit: str(or(get(block, "unit"), "")),
    categories,
    series,
  };
}

/** What is wrong with a chart block, each as a phrase that follows
 *  "block 3 (chart) …". Empty when it can be drawn and read. */
export function errors(block: Record<string, any>): string[] {
  const out: string[] = [];
  const kind = get(block, "kind");
  if (!CHART_KINDS.includes(kind)) {
    out.push(`has kind ${repr(kind)}; a chart is one of ${repr(CHART_KINDS)}`);
  }
  if (len(str(or(get(block, "caption"), ""))) > CAPTION_MAX_CHARS) {
    out.push(`has a caption longer than ${CAPTION_MAX_CHARS} characters`);
  }
  if (len(str(or(get(block, "unit"), ""))) > UNIT_MAX_CHARS) {
    out.push(`has a unit longer than ${UNIT_MAX_CHARS} characters`);
  }

  let categories = get(block, "categories");
  if (!Array.isArray(categories)) {
    out.push("needs `categories`, a list of labels");
    categories = [];
  }
  const kindKey = str(kind);
  const most = Object.prototype.hasOwnProperty.call(MAX_CATEGORIES, kindKey)
    ? MAX_CATEGORIES[kindKey]
    : Math.max(...Object.values(MAX_CATEGORIES));
  if (categories.length > 0 && !(MIN_CATEGORIES <= categories.length && categories.length <= most)) {
    out.push(`has ${categories.length} categories; a ${str(or(kind, "chart"))} takes ` +
             `${MIN_CATEGORIES}–${most}`);
  }
  for (const c of categories as unknown[]) {
    if (typeof c !== "string" || !strip(c)) {
      out.push("has a blank category label");
    } else if (len(c) > CATEGORY_MAX_CHARS) {
      out.push(`category ${repr(c)} is longer than ${CATEGORY_MAX_CHARS} characters`);
    }
  }
  const labels = (categories as unknown[]).filter((c) => typeof c === "string");
  if (new Set(labels).size !== labels.length) {
    out.push("repeats a category label");
  }

  const series = get(block, "series");
  if (!Array.isArray(series) || series.length === 0) {
    out.push("needs `series`, one to three lists of figures");
    return out;
  }
  if (series.length > MAX_SERIES) {
    out.push(`has ${series.length} series; at most ${MAX_SERIES} can be told apart`);
  }
  const names: string[] = [];
  series.forEach((s: unknown, n: number) => {
    if (!isDict(s)) {
      out.push(`series ${n} is not an object`);
      return;
    }
    const name = strip(str(or(get(s, "name"), "")));
    names.push(name);
    if (len(name) > SERIES_NAME_MAX_CHARS) {
      out.push(`series name ${repr(name)} is longer than ${SERIES_NAME_MAX_CHARS} characters`);
    }
    const values = get(s, "values");
    if (!Array.isArray(values)) {
      out.push(`series ${n} has no list of values`);
      return;
    }
    if (values.length !== categories.length) {
      out.push(`series ${n} has ${values.length} value(s) for ${categories.length} ` +
               "categories");
    }
    for (const v of values as unknown[]) {
      if (!isNumber(v)) {
        out.push(`series ${n} has ${repr(v)}, which is not a finite number`);
      } else if (Math.abs(v) >= VALUE_LIMIT) {
        out.push(`series ${n} has ${str(v)}, which needs more than six digits; state ` +
                 "it in a larger unit (万円 rather than 円)");
      } else if (Math.abs(v * 10 ** MAX_DECIMALS - round(v * 10 ** MAX_DECIMALS)) > 1e-6) {
        out.push(`series ${n} has ${str(v)}, more than ${MAX_DECIMALS} decimal places`);
      }
    }
  });
  if (series.length > 1) {
    if (!names.every((x) => truthy(x))) {
      out.push("names every series when there is more than one, or the legend " +
               "cannot say which is which");
    } else if (new Set(names).size !== names.length) {
      out.push("gives two series the same name");
    }
  }
  const figures: number[] = [];
  for (const s of series as unknown[]) {
    if (isDict(s) && Array.isArray(get(s, "values"))) {
      for (const v of s.values as unknown[]) if (isNumber(v)) figures.push(v);
    }
  }
  if (figures.length > 0 && !figures.some((v) => v !== 0)) {
    out.push("has nothing but zeros");
  }
  return out;
}

/** A chart written out for a reader who cannot see it: what it is and in
 *  what unit, then each series with every figure beside its category.
 *
 *      【棒グラフ】月別 問い合わせ件数（単位：件）
 *      電話：4月 330 / 5月 410 / 6月 340
 *      メール：4月 150 / 5月 190 / 6月 250
 *
 *  Pairing each figure with its label, rather than printing a row of numbers
 *  under a row of months, is what keeps a model from reading 5月's figure as
 *  6月's: the gate and the probe answer from this text, and a misaligned
 *  column would make an answerable item look ambiguous. */
export function text(block: Record<string, any>): string {
  const c = normalised(block);
  let head = `【${KIND_JA[c.kind]}】${c.caption}`;
  if (c.unit) {
    head += `（単位：${c.unit}）`;
  }
  const lines = [head];
  for (const s of c.series) {
    const pairs = zip(c.categories, s.values, { strict: true })
      .map(([label, v]) => `${label} ${formatValue(v)}`)
      .join(" / ");
    lines.push(s.name ? `${s.name}：${pairs}` : pairs);
  }
  return lines.join("\n");
}

/** `10 ** e` for a whole `e`: exact for a positive power, and for a negative
 *  one the correctly rounded float Python's `10 ** -n` gives. */
function powerOfTen(e: number): number {
  return Number(`1e${e}`);
}

/** Gridline values for a chart of these figures: round numbers, zero among
 *  them, spanning every figure. `niceTicks` in client/src/ui/plot.ts is the same
 *  arithmetic, so a page and a phone draw the same lines. */
export function axis(values: Iterable<unknown>, opts: { target?: number } = {}): number[] {
  const target = opts.target ?? 5;
  const finite = [...values].filter(isNumber);
  const lo = Math.min(0.0, ...finite);
  let hi = Math.max(0.0, ...finite);
  if (lo === hi) {
    hi = lo + 1;
  }
  const raw = (hi - lo) / target;
  const magnitude = powerOfTen(Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((x) => x >= raw * (1 - 1e-9))!;
  const first = Math.floor(lo / step + 1e-9) * step;
  const last = Math.ceil(hi / step - 1e-9) * step;
  const n = round((last - first) / step) + 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(round(first + i * step, 10));
  return out;
}
