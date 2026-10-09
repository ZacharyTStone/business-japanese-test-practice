/**
 * The handful of Python behaviours the pipeline's output depends on, done
 * once so that every module gets them the same way.
 *
 * The pipeline was written in Python, and what it writes — a bundle, its SQL,
 * a clip id, a prompt, a summary — was produced by Python's rules for
 * printing a number, sorting strings, rounding a half, splitting on
 * whitespace. JavaScript's rules differ in small places (`1.0` prints as
 * `1`, `round(0.5)` is 1 not 0, `"" || x` is not `"" or x` for a list, sort
 * compares UTF-16 units). Where the difference would change a byte somebody
 * reads or a decision the pipeline takes, the code calls one of these.
 */

// ---------------------------------------------------------------- errors

/** sys.exit(code): raised by the argument parser and by commands that stop
 *  early; `main()` turns it into the process's exit status. */
export class SystemExit extends Error {
  readonly code: number;
  constructor(code: number = 0, message: string = "") {
    super(message || `exit ${code}`);
    this.name = "SystemExit";
    this.code = code;
  }
}

/** A Python-style error class: `name` is the class's own name. */
export class PyError extends Error {
  constructor(message: string = "", options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Python's RuntimeError: the base of the pipeline's own failures
 *  (`LLMError`, `RequestFailed`), so `except RuntimeError` still catches
 *  them. */
export class RuntimeError extends PyError {}
export class ValueError extends PyError {}
export class KeyError extends PyError {}
export class TypeError_ extends PyError {}
export class FileNotFoundError extends PyError {}
/** Python's IndexError: a list index past either end. */
export class IndexError extends PyError {}
/** Python's AttributeError: a method asked of a value that lacks it. */
export class AttributeError extends PyError {}
/** Python's OverflowError: `int()` of an infinite float. */
export class OverflowError extends PyError {}
/** Python's ZeroDivisionError: a division by nothing. */
export class ZeroDivisionError extends PyError {}
/** Python's UnicodeEncodeError (a ValueError): text with a lone surrogate
 *  has no UTF-8 form. */
export class UnicodeEncodeError extends ValueError {}

/** Python's `except Exception`: every error but the one that ends the
 *  process. */
export function isException(e: unknown): boolean {
  return e instanceof Error && !(e instanceof SystemExit);
}

/** `str(exc)`: the message alone, as Python prints an exception in an
 *  f-string. (`String(err)` in JavaScript prefixes the class name.) */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return str(e);
}

/** Python's name for the type of a parsed JSON value, as its errors say it
 *  (`'NoneType' object is not subscriptable`). */
export function typeName(v: unknown): string {
  if (v === null || v === undefined) return "NoneType";
  if (Array.isArray(v)) return "list";
  if (typeof v === "object") return "dict";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  return Number.isInteger(v) ? "int" : "float";
}

// ------------------------------------------------------------- printing

/** `repr(float)` (and `str(float)`): the shortest digits that round-trip,
 *  always with a decimal point, and Python's switch to exponent form below
 *  1e-4 and from 1e16 (`1e-05`, `1e+16`). */
export function floatRepr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mant, expStr] = x.toExponential().split("e");
  const exp = parseInt(expStr, 10);
  const digits = mant.replace("-", "").replace(".", "");
  const sign = x < 0 ? "-" : "";
  if (exp >= -4 && exp < 16) {
    if (exp >= 0) {
      const intPart = digits.slice(0, exp + 1).padEnd(exp + 1, "0");
      const frac = digits.slice(exp + 1);
      return `${sign}${intPart}.${frac || "0"}`;
    }
    return `${sign}0.${"0".repeat(-exp - 1)}${digits}`;
  }
  const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
}

/** A number as Python prints it, when the code knows whether it is a float.
 *  An integral JavaScript number is an int unless `asFloat`. */
export function numStr(x: number, asFloat: boolean = false): string {
  if (Number.isInteger(x) && !asFloat && Math.abs(x) < 1e16) return String(x);
  return floatRepr(x);
}

/** `str(value)` for the values the pipeline prints. Numbers print as ints
 *  when integral (JavaScript cannot tell 1 from 1.0; say `numStr(x, true)`
 *  where Python held a float). */
export function str(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "string") return v;
  if (typeof v === "number") return numStr(v);
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Error) return v.message;
  return repr(v);
}

/** `repr(value)`: strings quoted the way Python quotes them, containers as
 *  Python's list/dict/tuple displays. */
export function repr(v: unknown): string {
  if (typeof v === "string") return strRepr(v);
  if (v === null || v === undefined || typeof v === "boolean" || typeof v === "number" || typeof v === "bigint") {
    return str(v);
  }
  if (Array.isArray(v)) return `[${v.map(repr).join(", ")}]`;
  if (v instanceof Set) return v.size ? `{${[...v].map(repr).join(", ")}}` : "set()";
  if (v instanceof Map) return `{${[...v].map(([k, x]) => `${repr(k)}: ${repr(x)}`).join(", ")}}`;
  if (v instanceof Error) return `${v.name}(${strRepr(v.message)})`;
  if (typeof v === "object") {
    return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${strRepr(k)}: ${repr(x)}`).join(", ")}}`;
  }
  return String(v);
}

function strRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === quote || ch === "\\") out += "\\" + ch;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c === 0x7f) out += "\\x" + c.toString(16).padStart(2, "0");
    else if (c >= 0x80 && c <= 0xa0) out += "\\x" + c.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + quote;
}

/** `f"{x:.{digits}f}"`: fixed notation, rounding the exact binary value half
 *  to even as Python does (`toFixed` rounds an exact half away from zero). */
export function fixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) return floatRepr(x);
  const sign = x < 0 || Object.is(x, -0) ? "-" : "";
  const ax = Math.abs(x);
  if (ax >= 1e21) return sign + ax.toFixed(digits);
  // toFixed(100) is the exact decimal expansion of the double (it has at
  // most 1074 significant fraction digits, but every value here is far
  // smaller than that needs; 100 is the most toFixed allows).
  const exact = ax.toFixed(Math.min(100, Math.max(digits + 25, 30)));
  const point = exact.indexOf(".");
  const keep = exact.slice(0, point + 1 + digits).replace(/\.$/, "");
  const rest = exact.slice(point + 1 + digits);
  const tie = /^50*$/.test(rest);
  const up = rest[0] > "5" || (rest[0] === "5" && !tie);
  const lastDigit = Number(keep.replace(".", "").slice(-1));
  const rounded = up || (tie && lastDigit % 2 === 1) ? incrementDecimal(keep) : keep;
  // A negative value that rounds to zero keeps its sign: Python prints "-0.00".
  return sign + rounded;
}

function incrementDecimal(s: string): string {
  const chars = s.split("");
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] === ".") { i--; continue; }
    if (chars[i] === "9") { chars[i] = "0"; i--; continue; }
    chars[i] = String(Number(chars[i]) + 1);
    return chars.join("");
  }
  return "1" + chars.join("");
}

/** `round(x)` (no digits): the nearest integer, an exact half to even. */
export function round(x: number): number;
/** `round(x, ndigits)`: Python's correctly rounded result, as a float. */
export function round(x: number, ndigits: number): number;
export function round(x: number, ndigits?: number): number {
  if (ndigits === undefined) {
    const f = Math.floor(x);
    const diff = x - f;
    if (diff > 0.5) return f + 1;
    if (diff < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  if (!Number.isFinite(x)) return x;
  if (ndigits >= 0) return parseFloat(fixed(x, ndigits));
  const scale = 10 ** -ndigits;
  return round(x / scale) * scale;
}

/** `"{:,}".format(n)`, `f"{n:,}"`: thousands separated by commas. */
export function thousands(n: number): string {
  const s = Number.isInteger(n) ? String(Math.abs(n)) : String(Math.abs(n));
  const [i, f] = s.split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-" : "") + grouped + (f ? "." + f : "");
}

/** `f"{x:g}"`: six significant digits, trailing zeros dropped, the exponent
 *  form below 1e-4 and from 1e6. */
export function g(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const [mant, e] = x.toExponential(5).split("e");
  const exp = Number(e);
  const dropZeros = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
  if (exp >= -4 && exp < 6) return dropZeros(fixed(x, 5 - exp));
  return `${dropZeros(mant)}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
}

/** `f"{x:.0%}"` / `f"{x:.1%}"`: a percentage, rounded half to even. */
export function percent(x: number, digits: number = 0): string {
  return fixed(x * 100, digits) + "%";
}

// --------------------------------------------------------------- truth

/** Python truthiness: None, False, 0, "", and an empty list, dict, set or
 *  map are false; everything else is true. (`[]` and `{}` are true in
 *  JavaScript, which is the difference that matters.) */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (typeof v === "number" && Number.isNaN(v)) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map || v instanceof Set) return v.size > 0;
  if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return Object.keys(v as object).length > 0;
  return true;
}

/** `a or b`, with Python's truthiness. */
export function or<T, U>(a: T, b: U): T | U {
  return truthy(a) ? a : b;
}

// ------------------------------------------------------------- sorting

/** Python's ordering for the values the pipeline sorts on: numbers,
 *  strings by code point (not UTF-16 unit), booleans as 0/1, null first
 *  (Python would refuse to compare it; nothing here relies on that), and
 *  arrays as tuples, element by element. */
export function cmp(a: unknown, b: unknown): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const c = cmp(a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length;
  }
  if (typeof a === "string" && typeof b === "string") return cmpStr(a, b);
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  const x = typeof a === "boolean" ? Number(a) : (a as number);
  const y = typeof b === "boolean" ? Number(b) : (b as number);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Strings compared by code point, as Python compares them. */
export function cmpStr(a: string, b: string): number {
  if (a === b) return 0;
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/** `sorted(items, key=..., reverse=...)`: a new array, stable, Python's
 *  ordering. Equal keys keep their order under `reverse` too, as in Python. */
export function sorted<T>(items: Iterable<T>, opts: { key?: (x: T) => unknown; reverse?: boolean } = {}): T[] {
  const key = opts.key ?? ((x: T) => x);
  const decorated = [...items].map((x, i) => ({ x, k: key(x), i }));
  const sign = opts.reverse ? -1 : 1;
  decorated.sort((p, q) => sign * cmp(p.k, q.k) || p.i - q.i);
  return decorated.map((d) => d.x);
}

/** `min(items, key=...)`: the first of the smallest. Throws on an empty
 *  sequence, as Python does. */
export function min<T>(items: Iterable<T>, key: (x: T) => unknown = (x) => x): T {
  let best: T | undefined;
  let bestKey: unknown;
  let seen = false;
  for (const x of items) {
    const k = key(x);
    if (!seen || cmp(k, bestKey) < 0) { best = x; bestKey = k; seen = true; }
  }
  if (!seen) throw new ValueError("min() arg is an empty sequence");
  return best as T;
}

/** `max(items, key=...)`: the first of the largest. */
export function max<T>(items: Iterable<T>, key: (x: T) => unknown = (x) => x): T {
  let best: T | undefined;
  let bestKey: unknown;
  let seen = false;
  for (const x of items) {
    const k = key(x);
    if (!seen || cmp(k, bestKey) > 0) { best = x; bestKey = k; seen = true; }
  }
  if (!seen) throw new ValueError("max() arg is an empty sequence");
  return best as T;
}

// ------------------------------------------------------------ numbers

/** `a // b`: floor division. */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function sum(xs: Iterable<number>): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

/** `range(stop)` / `range(start, stop[, step])` as an array. */
export function range(a: number, b?: number, step: number = 1): number[] {
  const [start, stop] = b === undefined ? [0, a] : [a, b];
  const out: number[] = [];
  if (step > 0) for (let i = start; i < stop; i += step) out.push(i);
  else for (let i = start; i > stop; i += step) out.push(i);
  return out;
}

/** `zip(a, b)`: pairs up to the shorter; `strict` refuses unequal lengths
 *  (`zip(..., strict=True)`). */
export function zip<A, B>(a: readonly A[], b: readonly B[], opts: { strict?: boolean } = {}): [A, B][] {
  if (opts.strict && a.length !== b.length) {
    throw new ValueError(`zip() argument 2 is ${b.length > a.length ? "longer" : "shorter"} than argument 1`);
  }
  const n = Math.min(a.length, b.length);
  const out: [A, B][] = [];
  for (let i = 0; i < n; i++) out.push([a[i], b[i]]);
  return out;
}

// ------------------------------------------------------------- strings

/** `len(s)`: code points, not UTF-16 units. */
export function len(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** `s[start:end]` by code point. */
export function slice(s: string, start: number, end?: number): string {
  const cps = [...s];
  return cps.slice(start, end).join("");
}

/** Python's `str.isspace()` set: what `split()` and `strip()` remove. A
 *  character-class body, for `[${WS}]` in a pattern with the `u` flag. */
export const WS ="\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const WS_RUN = new RegExp(`[${WS}]+`, "u");
const WS_LEAD = new RegExp(`^[${WS}]+`, "u");
const WS_TRAIL = new RegExp(`[${WS}]+$`, "u");

/** `s.split()` with no separator: runs of whitespace, no empty strings. */
export function splitWs(s: string): string[] {
  return s.split(WS_RUN).filter((p) => p !== "");
}

/** `s.split(None, maxsplit)`: at most `maxsplit` splits on runs of
 *  whitespace, the rest of the line kept whole (its trailing whitespace
 *  included, as Python keeps it). */
export function splitWsMax(s: string, maxsplit: number): string[] {
  const parts: string[] = [];
  let rest = s.replace(WS_LEAD, "");
  while (rest !== "" && parts.length < maxsplit) {
    const m = WS_RUN.exec(rest);
    if (m === null) break;
    parts.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest !== "") parts.push(rest);
  return parts;
}

const LONE_SURROGATE = new RegExp("[\\uD800-\\uDFFF]", "u");

/** `s.encode("utf-8")`, strict: a lone surrogate is refused rather than
 *  replaced with U+FFFD (which would hash or sign something else). */
export function utf8(s: string): Buffer {
  const m = LONE_SURROGATE.exec(s);
  if (m) {
    const ch = m[0].charCodeAt(0).toString(16);
    throw new UnicodeEncodeError(
      `'utf-8' codec can't encode character '\\u${ch}' in position ${len(s.slice(0, m.index))}: surrogates not allowed`,
    );
  }
  return Buffer.from(s, "utf8");
}

/** `str(Path(p))`: a path as pathlib spells it — repeated and trailing
 *  slashes and `.` components dropped, `..` kept, an empty path `.`. Also
 *  the CLI's argument type where argparse had `type=pathlib.Path`. */
export function pathStr(p: string): string {
  const lead = p.startsWith("//") && !p.startsWith("///") ? "//" : p.startsWith("/") ? "/" : "";
  const parts = p.split("/").filter((s) => s !== "" && s !== ".");
  const out = lead + parts.join("/");
  return out === "" ? "." : out;
}

function charsClass(chars: string): RegExp {
  const escaped = [...chars].map((c) => c.replace(/[\\\]\-^]/g, "\\$&")).join("");
  return new RegExp(`[${escaped}]`, "u");
}

/** `s.strip([chars])`. */
export function strip(s: string, chars?: string | null): string {
  return lstrip(rstrip(s, chars), chars);
}

/** `s.lstrip([chars])`. */
export function lstrip(s: string, chars?: string | null): string {
  if (chars === undefined || chars === null) return s.replace(WS_LEAD, "");
  const re = charsClass(chars);
  const cps = [...s];
  let i = 0;
  while (i < cps.length && re.test(cps[i])) i++;
  return cps.slice(i).join("");
}

/** `s.rstrip([chars])`. */
export function rstrip(s: string, chars?: string | null): string {
  if (chars === undefined || chars === null) return s.replace(WS_TRAIL, "");
  const re = charsClass(chars);
  const cps = [...s];
  let j = cps.length;
  while (j > 0 && re.test(cps[j - 1])) j--;
  return cps.slice(0, j).join("");
}

/** `s.splitlines()`. */
export function splitlines(s: string): string[] {
  const lines = s.split(new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85\\u2028\\u2029]", "u"));
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** `html.escape(s, quote=True)`. */
export function htmlEscape(s: string, quote: boolean = true): string {
  let out = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (quote) out = out.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  return out;
}

/** `textwrap.wrap(text, width)` with Python's defaults, step for step
 *  (`TextWrapper._split` and `_wrap_chunks`): tabs expanded and the other
 *  ASCII whitespace turned into spaces, the text cut into chunks on ASCII
 *  whitespace and after the hyphen of a hyphenated word, a chunk longer than
 *  the line broken at the width — after its last hyphen that fits, when it has
 *  one — and widths counted in code points. Only ASCII whitespace separates
 *  words, as in Python: a full-width space is part of the word. */
export function wrap(text: string, width: number): string[] {
  // _munge_whitespace: expandtabs(8), then each of \t\n\v\f\r becomes a space.
  let col = 0;
  let expanded = "";
  for (const ch of text) {
    if (ch === "\t") {
      const n = 8 - (col % 8);
      expanded += " ".repeat(n);
      col += n;
    } else {
      expanded += ch;
      col = ch === "\n" || ch === "\r" ? 0 : col + 1;
    }
  }
  const munged = expanded.replace(/[\t\n\v\f\r]/g, " ");

  // _split: wordsep_re, Python's pattern with its Unicode classes spelled out.
  const ws = "[\\t\\n\\v\\f\\r ]";
  const nws = "[^\\t\\n\\v\\f\\r ]";
  const wp = "[\\p{L}\\p{N}_!\"'&.,?]";
  const lt = "[\\p{L}\\p{Nl}\\p{No}_]";
  const wordsep = new RegExp(
    `(${ws}+` +
      `|(?<=${wp})-{2,}(?=[\\p{L}\\p{N}_])` +
      `|${nws}+?(?:-(?:(?<=${lt}{2}-)|(?<=${lt}-${lt}-))(?=${lt}-?${lt})|(?=${ws}|$)|(?<=${wp})(?=-{2,}[\\p{L}\\p{N}_])))`,
    "gu",
  );
  const chunks: string[][] = [];
  let at = 0;
  for (const m of munged.matchAll(wordsep)) {
    if (m.index > at) chunks.push([...munged.slice(at, m.index)]);
    if (m[0]) chunks.push([...m[0]]);
    at = m.index + m[0].length;
  }
  if (at < munged.length) chunks.push([...munged.slice(at)]);

  // _wrap_chunks, with drop_whitespace and break_long_words on.
  const isBlank = (c: string[]) => strip(c.join("")) === "";
  const lines: string[] = [];
  chunks.reverse();
  while (chunks.length) {
    let cur: string[][] = [];
    let curLen = 0;
    if (isBlank(chunks[chunks.length - 1]) && lines.length) chunks.pop();
    while (chunks.length) {
      const l = chunks[chunks.length - 1].length;
      if (curLen + l <= width) {
        cur.push(chunks.pop()!);
        curLen += l;
      } else break;
    }
    if (chunks.length && chunks[chunks.length - 1].length > width) {
      // _handle_long_word
      const spaceLeft = width < 1 ? 1 : width - curLen;
      const chunk = chunks[chunks.length - 1];
      let end = spaceLeft;
      if (chunk.length > spaceLeft) {
        const hyphen = chunk.slice(0, spaceLeft).lastIndexOf("-");
        if (hyphen > 0 && chunk.slice(0, hyphen).some((c) => c !== "-")) end = hyphen + 1;
      }
      cur.push(chunk.slice(0, end));
      chunks[chunks.length - 1] = chunk.slice(end);
      curLen = cur.reduce((n, c) => n + c.length, 0);
    }
    if (cur.length && isBlank(cur[cur.length - 1])) {
      curLen -= cur[cur.length - 1].length;
      cur = cur.slice(0, -1);
    }
    if (cur.length) lines.push(cur.map((c) => c.join("")).join(""));
  }
  return lines;
}

/** `textwrap.indent(text, prefix)`: prefix every line that is not blank. */
export function indent(text: string, prefix: string): string {
  return text.replace(/^(?=.*\S)/gmu, prefix);
}

// ---------------------------------------------------------- containers

/** A deep copy (`copy.deepcopy`) of plain data. */
export function deepcopy<T>(v: T): T {
  return structuredClone(v);
}

/** Deep equality on plain data, as Python's `==` on dicts and lists. */
export function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return typeof a === "number" && typeof b === "number" ? a === b : false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => eq(x, bb[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && eq((a as any)[k], (b as any)[k]));
}

/** `d.get(key, default)`: the default only when the key is absent (a key
 *  holding null returns null, unlike `d[key] ?? default`). */
export function get<T = any>(d: Record<string, any> | null | undefined, key: string, dflt: T | null = null): any {
  if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
  return dflt;
}

/** `d[key]` on a plain object: a missing key is a KeyError, as in Python,
 *  rather than an `undefined` that would travel on. */
export function getitem<T = any>(d: Record<string, T>, key: string): T {
  if (!has(d, key)) throw new KeyError(repr(key));
  return d[key];
}

/** `isinstance(v, dict)` for parsed JSON: a plain object, not null or a
 *  list. */
export function isDict(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** `key in d` for a plain object. */
export function has(d: object | null | undefined, key: string): boolean {
  return !!d && Object.prototype.hasOwnProperty.call(d, key);
}

/** `collections.Counter(xs)` as a Map, in first-seen order. */
export function counter<T>(xs: Iterable<T>): Map<T, number> {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/** `Counter.most_common()`: by count, ties in first-seen order. */
export function mostCommon<T>(c: Map<T, number>, n?: number): [T, number][] {
  const out = sorted([...c.entries()], { key: (e) => e[1], reverse: true });
  return n === undefined ? out : out.slice(0, n);
}

// ------------------------------------------------------------ printing
//
// Every line the pipeline prints goes through these rather than through
// `console.log`, so that a test can read it (tests/helpers.ts `capture`),
// and so a value prints as Python printed it: `print(a, b)` is the two
// joined by a space, None and True spelled as Python spells them.

function printed(args: unknown[]): string {
  return args.map((a) => str(a)).join(" ");
}

/** `print(*args)`. */
export function print(...args: unknown[]): void {
  process.stdout.write(printed(args) + "\n");
}

/** `print(*args, file=sys.stderr)`. */
export function eprint(...args: unknown[]): void {
  process.stderr.write(printed(args) + "\n");
}

/** `sys.stdout.write(s)`, or `print(s, end="")`. */
export function write(s: string): void {
  process.stdout.write(s);
}

/** `sys.stderr.write(s)`. */
export function ewrite(s: string): void {
  process.stderr.write(s);
}

// ------------------------------------------------------------- parsing

/** `int(s)`: a whole number written in base 10, surrounding whitespace
 *  allowed, anything else a ValueError (JavaScript's parseInt would read
 *  "3x" as 3). */
export function toInt(s: string): number {
  const t = s.trim().replace(/_/g, "");
  if (!/^[-+]?\d+$/.test(t)) throw new ValueError(`invalid literal for int() with base 10: ${repr(s)}`);
  return parseInt(t, 10);
}

/** `float(s)`: a decimal or exponent number, "inf" and "nan" included. */
export function toFloat(s: string): number {
  const t = s.trim().toLowerCase().replace(/_/g, "");
  if (/^[-+]?(inf|infinity)$/.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  if (/^[-+]?nan$/.test(t)) return NaN;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(t)) throw new ValueError(`could not convert string to float: ${repr(s)}`);
  return Number(t);
}

/** `int(x)` of a parsed JSON value: an int as it is, a bool as 0 or 1, a
 *  float cut toward zero, a string read as base 10; anything else the
 *  TypeError `int()` raises. An infinity is an OverflowError, not a
 *  ValueError, so a caller that reads a ValueError as "no answer" does not
 *  read it as one, exactly as in Python. */
export function pyInt(x: unknown): number {
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "number") {
    if (Number.isNaN(x)) throw new ValueError("cannot convert float NaN to integer");
    if (!Number.isFinite(x)) throw new OverflowError("cannot convert float infinity to integer");
    return Math.trunc(x);
  }
  if (typeof x === "string") return toInt(x);
  throw new TypeError_(`int() argument must be a string, a bytes-like object or a real number, not '${typeName(x)}'`);
}

/** `float(x)` of a parsed JSON value: a number as it is, a bool as 0 or 1, a
 *  string read as `float(s)` reads it; anything else a TypeError. */
export function pyFloat(x: unknown): number {
  if (typeof x === "number") return x;
  if (typeof x === "boolean") return Number(x);
  if (typeof x === "string") return toFloat(x);
  throw new TypeError_(`float() argument must be a string or a real number, not '${typeName(x)}'`);
}

// --------------------------------------------------------- dataclasses

/** `dataclasses.replace(obj, **changes)`: a copy of the instance, same
 *  class, with some fields changed. */
export function replace<T extends object>(obj: T, changes: Partial<T>): T {
  return Object.assign(Object.create(Object.getPrototypeOf(obj)), obj, changes);
}

// --------------------------------------------------------------- time

const pad = (n: number, w: number = 2) => String(n).padStart(w, "0");

/** `datetime.isoformat()` of an aware UTC datetime:
 *  `2026-10-02T07:06:59+00:00`, with `.ffffff` microseconds when they are not
 *  zero (JavaScript keeps milliseconds), or cut at `timespec="seconds"`. */
export function isoformatUtc(d: Date, timespec: "auto" | "seconds" = "auto"): string {
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const ms = d.getUTCMilliseconds();
  const frac = timespec === "auto" && ms !== 0 ? `.${pad(ms, 3)}000` : "";
  return `${base}${frac}+00:00`;
}

/** `date.isoformat()` of the UTC day: `2026-10-02`. */
export function isodateUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `time.time()`: seconds since the epoch, as a float. */
export function time(): number {
  return Date.now() / 1000;
}
