/**
 * Numbers in a printed document are written with Arabic digits.
 *
 * A booking grid headed 「十時〜十二時」, a quotation for 「数量二百個」, a schedule
 * titled 「十月 新人研修 予定表」 — each is grammatical Japanese, and none of them is
 * what comes off an office printer. Japanese business documents set their dates,
 * times, quantities and money in Arabic digits; kanji numerals belong to vertical
 * prose and to the *names* of things (第一会議室, 第三回, 一覧). A 資料 that spells
 * its numbers out reads as a textbook exercise rather than as paper somebody was
 * handed, which is the one thing this library is trying not to be. A model left
 * to itself spells them out.
 *
 * So the rule lives here once and is used three times: `documentSchema()` quotes
 * it to the generator, `toArabic` applies it to a document on its way into a
 * bundle, and the offline batch check refuses a bundle whose 資料 still spells a
 * number out. A rule that is stated in a prompt and nowhere else is a suggestion.
 *
 * **What counts as a number:** a run of numeral kanji immediately followed by a
 * counter — 九月九日, 十時三十分, 二百個, 八百万円, 二日間, 八割. Requiring the
 * counter is what keeps the rule off words that merely contain a numeral
 * character, and the exclusions are load-bearing rather than tidy:
 *
 * - 一覧, 一般, 一因 — 覧, 般 and 因 are not counters, so nothing matches.
 * - 第一会議室, 第三回 設備改修 — a run preceded by 第 is an ordinal in a name, and
 *   names keep their kanji. Without that guard 回 and 部 would renumber every
 *   meeting room and every section heading in the library, and the options that
 *   name them (「第一会議室の十三時からを取る。」) would stop matching the table.
 * - 案一, 案二 — nothing follows them, so nothing matches.
 * - `_NOT_NUMBERS` — the handful where a numeral kanji and a counter really do
 *   collide inside a word: 一部 is a copy or a portion, 一時的 is not one o'clock,
 *   十分な is not ten minutes. A bare 「十分」 is genuinely ambiguous to a human
 *   reader too, and is the known hole in this: written as "sufficient" with
 *   nothing after it, it would be rewritten to 「10分」. No document in the bank
 *   does that, and a proofreader would catch it if one did.
 *
 * Only the digits move. 「十時〜十二時」 becomes 「10時〜12時」, not 「10:00〜12:00」:
 * substituting a numeral cannot change what a document says, and rewriting its
 * punctuation can. 万 and 億 stay words, because a Japanese accountant writes
 * 800万円 and not 8,000,000円.
 *
 * **Spoken text is deliberately out of scope.** `bjt/tts/plan.ts` synthesises the
 * stem, the options and the dialogue; nothing synthesises a document (`TYPE_AUDIO`
 * has no entry that could). Rewriting a number the narrator reads would change
 * that clip's text, and a live clip is never re-made. A document is also the only
 * part of an item that is printed *to look like something*, so it is the only
 * place the problem arises.
 */
import { get, has, isDict, sorted, str, TypeError_ } from "../py.ts";

export const _DIGITS: Record<string, number> = {
  "〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4,
  "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
};
export const _SCALES: Record<string, number> = { "十": 10, "百": 100, "千": 1000 };

/** Myriad groupings keep their kanji — 800万円, never 8000000円 — so they split
 *  the run rather than multiplying it out. 億 before 万: the bigger one first. */
export const _MYRIADS = ["億", "万"] as const;

export const _NUMERAL_CHARS = Object.keys(_DIGITS).join("") + Object.keys(_SCALES).join("") + _MYRIADS.join("");

/** What a number may be followed by for this to be a number at all. Every entry
 *  is a counter or a unit, never a word-forming character: adding 度 here would
 *  rewrite 「一度」, and adding つ would rewrite 「二つ」, which are prose rather
 *  than data. Multi-character entries come first so the longer one is tried
 *  first; the match is only ever a lookahead, so nothing is consumed. */
export const COUNTERS: readonly string[] = [
  "か月", "ヶ月", "カ月", "箇月", "週間", "日間", "時間", "分間", "年間",
  "日目", "年度", "名様", "パーセント", "％",
  "月", "日", "年", "時", "分", "秒", "週",
  "個", "台", "脚", "部", "名", "人", "回", "点", "階", "枚", "件", "本",
  "通", "割", "円", "冊", "箱", "袋", "室", "社", "号", "版", "倍", "歳",
  "枠", "席", "%",
];

/** Words in which a numeral kanji is followed by something in COUNTERS without
 *  being a number. Any one of them matching at the start of a candidate blocks
 *  it, so the order here does not matter. */
export const _NOT_NUMBERS: readonly string[] = [
  "一時的", "一時停止", "一時金", "一時払い", "一部分", "十分な", "十分に",
  "一部", "一般", "一方", "一面", "一度", "一連", "一律", "一環", "一体",
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
}

/** A run of numeral kanji that a counter follows. Three lookbehinds guard it:
 *
 *  - 第 keeps the rule off ordinals in names (第一会議室, 第三回).
 *  - A digit keeps it off text that has already been through here. Without it
 *    the 万 in a converted 「20万円」 is itself a candidate and a second pass
 *    gives 「201万円」. Running this over its own output is not a nicety: the
 *    offline check works by re-running it, and `importbatch` re-runs it over a
 *    source file that is already clean.
 *  - A numeral and a comma keep it off 「二、三日」 — "two or three days", where
 *    only the 三 is followed by a counter. Converting half of an idiom to give
 *    「二、3日」 is worse than leaving it, which is what happens instead. The
 *    cost is that a numbered clause written 「一、三名以上は…」 keeps its 三名 as
 *    well; our documents number their own lists (the `numbered` block), so that
 *    form should not arise, and a whole idiom beats half a clause either way. */
export const _CANDIDATE = new RegExp(
  `(?<!第)(?<![0-9０-９])(?<![${_NUMERAL_CHARS}][、，])` +
  `[${_NUMERAL_CHARS}]+(?=${COUNTERS.map(escapeRe).join("|")})`,
  "gu",
);

/** One match of the scanner: where it starts and ends (in UTF-16 units, as
 *  every index into the string here is) and what it matched. */
export type NumeralMatch = { start: number; end: number; text: string };

/** Python's `str.partition`: the text before the first `sep`, the separator,
 *  and the rest. */
function partition(s: string, sep: string): [string, string, string] {
  const i = s.indexOf(sep);
  if (i < 0) return [s, "", ""];
  return [s.slice(0, i), sep, s.slice(i + sep.length)];
}

/** A run of numeral kanji as Arabic digits, or null if it will not read.
 *
 *  Positional runs (二〇二六) concatenate; runs with a scale character (二十二)
 *  are summed; a myriad splits the run and keeps its own kanji (八百万 → 800万). */
export function _value(run: string): string | null {
  for (const myriad of _MYRIADS) {
    if (run.includes(myriad)) {
      const [head, , tail] = partition(run, myriad);
      if (!head) {
        // 「万円」 with nothing in front of it is not a quantity. It is
        // also what an already-converted 「20万円」 looks like to the
        // scanner if the digit lookbehind ever stops holding, and
        // reading it as 1万 there would multiply the number on every
        // pass — see the idempotence test.
        return null;
      }
      const above = _value(head);
      const below = tail ? _value(tail) : "";
      if (above === null || below === null) {
        return null;
      }
      return `${above}${myriad}${below}`;
    }
  }
  const chars = [...run];
  if (chars.some((c) => has(_SCALES, c))) {
    let total = 0;
    let digit = 0;
    for (const ch of chars) {
      if (has(_DIGITS, ch)) {
        digit = _DIGITS[ch];
      } else if (has(_SCALES, ch)) {
        total += (digit || 1) * _SCALES[ch];
        digit = 0;
      } else {
        return null;
      }
    }
    return String(total + digit);
  }
  if (chars.every((c) => has(_DIGITS, c))) {
    // One digit, or a positional run like 二〇二六. A bare 「二三日」 is
    // "two or three days" and not the 23rd, so a multi-digit run with no
    // 〇 in it is not a number this will guess at — it is left alone, and
    // the check leaves it alone for the same reason.
    if (chars.length === 1 || chars.some((c) => "〇零".includes(c))) {
      return chars.map((c) => String(_DIGITS[c])).join("");
    }
  }
  return null;
}

/** Every match in the string that really is a spelled-out number.
 *
 *  The single scanner behind both the rewrite and the check, so the two can
 *  never disagree about what counts — a check that flagged what the converter
 *  would not fix would fail a bundle nothing could clean. */
export function _numbers(text: string): NumeralMatch[] {
  const out: NumeralMatch[] = [];
  for (const m of text.matchAll(_CANDIDATE)) {
    const start = m.index;
    if (_NOT_NUMBERS.some((word) => text.startsWith(word, start))) {
      continue;
    }
    if (_value(m[0]) === null) {
      continue;
    }
    out.push({ start, end: start + m[0].length, text: m[0] });
  }
  return out;
}

/** One string with its spelled-out numbers rewritten as digits. */
export function toArabicText(text: string): string {
  let out = text;
  for (const m of _numbers(text).reverse()) {
    out = out.slice(0, m.start) + str(_value(m.text)) + out.slice(m.end);
  }
  return out;
}

/** The spelled-out numbers in the string — empty when it reads like print. */
export function kanjiNumbersIn(text: string): string[] {
  return _numbers(text).map((m) => m.text);
}

/** `for x in (value or [])`, as Python iterates it: a list's elements, a
 *  string's characters, a dict's keys. */
function iterOr(v: unknown): unknown[] {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [...v];
  if (isDict(v)) return Object.keys(v);
  throw new TypeError_(`'${typeof v}' object is not iterable`);
}

/** Rewrite every number in a document as digits. Returns how many strings moved.
 *
 *  Walks the same fields `document.textOf` flattens, because a number the
 *  learner can read is a number this has to reach: a table's header cell and a
 *  key/value block's value are as printed as a paragraph is. */
export function toArabic(doc: unknown): number {
  if (!isDict(doc)) {
    return 0;
  }
  let moved = 0;

  const fix = (value: unknown): unknown => {
    if (typeof value !== "string") {
      return value;
    }
    const out = toArabicText(value);
    if (out !== value) {
      moved += 1;
    }
    return out;
  };

  doc["title"] = fix(get(doc, "title", ""));
  for (const meta of iterOr(get(doc, "meta"))) {
    if (isDict(meta)) {
      for (const key of ["label", "value"]) {
        if (has(meta, key)) {
          meta[key] = fix(meta[key]);
        }
      }
    }
  }
  for (const block of iterOr(get(doc, "blocks"))) {
    if (!isDict(block)) {
      continue;
    }
    // A caption is printed above its table or chart: 「十月の実績」 over a
    // graph is the same fault as in a title. A chart's `unit` is not
    // reached, on purpose — 千円, 百万円 and 千件 are scale words, not
    // quantities, and this converter would print 「単位：1000円」.
    for (const key of ["text", "sender", "sent_at", "caption"]) {
      if (has(block, key)) {
        block[key] = fix(block[key]);
      }
    }
    // A chart's categories are the labels under its bars (「四月」 is a
    // column heading by another name) and a series name is its legend.
    // Its figures are numbers, so there is nothing in them to rewrite.
    for (const key of ["items", "columns", "categories"]) {
      if (Array.isArray(get(block, key))) {
        block[key] = block[key].map(fix);
      }
    }
    for (const series of iterOr(get(block, "series"))) {
      if (isDict(series) && has(series, "name")) {
        series["name"] = fix(series["name"]);
      }
    }
    if (Array.isArray(get(block, "rows"))) {
      block["rows"] = block["rows"].map((row: unknown) =>
        Array.isArray(row) ? row.map(fix) : row,
      );
    }
    for (const pair of iterOr(get(block, "pairs"))) {
      if (isDict(pair)) {
        for (const key of ["label", "value"]) {
          if (has(pair, key)) {
            pair[key] = fix(pair[key]);
          }
        }
      }
    }
  }
  return moved;
}

/** Every string a reader sees in a document, for checking rather than rendering. */
export function printedStrings(doc: unknown): string[] {
  if (!isDict(doc)) {
    return [];
  }
  let out: string[] = [str(get(doc, "title", ""))];
  for (const meta of iterOr(get(doc, "meta"))) {
    if (isDict(meta)) {
      out.push(str(get(meta, "label", "")), str(get(meta, "value", "")));
    }
  }
  for (const block of iterOr(get(doc, "blocks"))) {
    if (!isDict(block)) {
      continue;
    }
    // Not a chart's `unit`: see `toArabic`, which leaves it alone, and a
    // check must not flag what the converter will not move.
    out = out.concat(["text", "sender", "sent_at", "caption"].map((k) => str(get(block, k, ""))));
    out = out.concat(iterOr(get(block, "items")).map((x) => str(x)));
    out = out.concat(iterOr(get(block, "columns")).map((c) => str(c)));
    out = out.concat(iterOr(get(block, "categories")).map((c) => str(c)));
    out = out.concat(iterOr(get(block, "series")).filter(isDict).map((s) => str(get(s, "name", ""))));
    for (const row of iterOr(get(block, "rows"))) {
      if (Array.isArray(row)) {
        out = out.concat(row.map((c) => str(c)));
      }
    }
    for (const pair of iterOr(get(block, "pairs"))) {
      if (isDict(pair)) {
        out.push(str(get(pair, "label", "")), str(get(pair, "value", "")));
      }
    }
  }
  return out.filter((s) => s);
}

/** The spelled-out numbers left in a document — empty when it is clean. */
export function documentFaults(doc: unknown): string[] {
  const runs = new Set<string>();
  for (const text of printedStrings(doc)) {
    for (const run of kanjiNumbersIn(text)) runs.add(run);
  }
  return sorted(runs);
}

/** Words in which a numeral kanji is a letter rather than a number. Wider than
 *  `_NOT_NUMBERS`, because `mixedNotation` asks a looser question than the
 *  converter does — it flags a kanji numeral with no counter after it, which is
 *  the shape the converter is blind to by construction.
 *  `一覧` is the one that shows why this list is wider: the converter never
 *  needed it, because 覧 is not a counter and so nothing ever matched. This
 *  asks the looser question, so it does. */
export const _KANJI_AS_A_LETTER: readonly string[] = [
  ..._NOT_NUMBERS,
  "一覧表", "一覧", "一括", "一項", "一緒", "唯一", "一人", "二人", "三人",
  "四人", "一本化",
  "三人称", "二人称", "一つ", "二つ", "三つ", "四つ", "五つ", "六つ", "七つ",
  "八つ", "九つ", "一日", "二日", "三日", "案一", "案二", "案三",
  "第一", "第二", "第三", "第四", "第五",
];

export const _ANY_RUN = new RegExp(`[${_NUMERAL_CHARS}]{1,6}`, "gu");

/** Spelled-out numbers in a string that also uses digits — empty if none.
 *
 *  `toArabicText` only moves a number a counter follows, which is what keeps
 *  it off 一覧 and 第一会議室. The price is that it cannot see a number nothing
 *  follows: 「1万8000円×十二の21万6000円」 and 「三百から二百を引いて100部」 both
 *  pass through untouched, and both are worse than either notation alone —
 *  the learner is converting between two systems inside one sentence, beside a
 *  table that uses only one of them.
 *
 *  Catching those by widening the converter would mean rewriting every numeral
 *  kanji whatever follows it, and 「二、三日」 and 「一覧」 are why that is not
 *  done. So the converter stays narrow and this reports what it leaves, for a
 *  person to read. A count, not a rewrite: only a reader can tell 「二案」 (a
 *  count, digits) from 「案二」 (a label, kanji). */
export function mixedNotation(text: string): string[] {
  if (!/[0-9]/.test(text)) {
    return [];
  }
  const spans: [number, number][] = [];
  for (const word of _KANJI_AS_A_LETTER) {
    // re.finditer(re.escape(word), text): every occurrence, without overlap.
    let i = text.indexOf(word);
    while (i >= 0) {
      spans.push([i, i + word.length]);
      i = text.indexOf(word, i + word.length);
    }
  }
  const out: string[] = [];
  for (const m of text.matchAll(_ANY_RUN)) {
    const a = m.index;
    const b = a + m[0].length;
    if (spans.some(([s, e]) => a < e && s < b)) {
      continue;
    }
    if (text.slice(0, a).endsWith("第")) {
      continue;
    }
    if (["万", "千", "億"].includes(m[0]) && a && isdigit([...text.slice(0, a)].pop()!)) {
      continue;
    }
    out.push(m[0]);
  }
  return out;
}

/** Python's `str.isdigit()` beyond the decimal digits: the superscript,
 *  subscript, circled and other digits it also counts (Numeric_Type=Digit). */
const _PY_DIGIT = new RegExp(
  "^[\\p{Nd}\\u00B2\\u00B3\\u00B9\\u1369-\\u1371\\u19DA\\u2070\\u2074-\\u2079\\u2080-\\u2089" +
  "\\u2460-\\u2468\\u2474-\\u247C\\u2488-\\u2490\\u24EA\\u24F5-\\u24FD\\u24FF\\u2776-\\u277E" +
  "\\u2780-\\u2788\\u278A-\\u2792\\u{10A40}-\\u{10A43}\\u{10E60}-\\u{10E68}\\u{11052}-\\u{1105A}" +
  "\\u{1F100}-\\u{1F10A}]$",
  "u",
);

/** `ch.isdigit()` for one character. */
function isdigit(ch: string): boolean {
  return _PY_DIGIT.test(ch);
}
