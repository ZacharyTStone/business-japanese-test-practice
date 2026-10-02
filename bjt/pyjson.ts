/**
 * `json.dumps`, byte for byte.
 *
 * A bundle (batches/*.json), the SQL that quotes its JSON columns, a seeds
 * file and the app's generated constants were all written by Python's json
 * module, and the tests hold the committed files to what the pipeline
 * writes. `JSON.stringify` differs from it in four places that would change
 * those bytes: a float that happens to be whole (`1.0` is `1`), the
 * separators without an indent (`", "` and `": "`), `ensure_ascii` (Python
 * escapes every non-ASCII character by default), and NaN (Python writes it,
 * or refuses with `allow_nan=False`). This writes what Python writes.
 *
 * JavaScript has one number type, so whether a whole number was a float in
 * Python is said by the caller: `floatKeys` names the object keys whose
 * values are always floats (`model_p_correct`).
 */
import { floatRepr, ValueError } from "./py.ts";

export type DumpsOptions = {
  /** Escape every character outside printable ASCII (Python's default). */
  ensureAscii?: boolean;
  /** Pretty-print with this many spaces; null or absent for one line. */
  indent?: number | null;
  sortKeys?: boolean;
  /** (item separator, key separator). Python's default is (", ", ": ")
   *  without an indent and (",", ": ") with one. */
  separators?: [string, string];
  /** NaN and the infinities written as Python writes them; false refuses. */
  allowNan?: boolean;
  /** Keys whose numbers are floats: a whole number is written `1.0`. */
  floatKeys?: ReadonlySet<string>;
};

/** The one float key the bundles carry. */
export const BUNDLE_FLOAT_KEYS: ReadonlySet<string> = new Set(["model_p_correct"]);

export function dumps(value: unknown, opts: DumpsOptions = {}): string {
  const ensureAscii = opts.ensureAscii ?? true;
  const indent = opts.indent ?? null;
  const [itemSep, keySep] = opts.separators ?? (indent === null ? [", ", ": "] : [",", ": "]);
  const allowNan = opts.allowNan ?? true;
  const floatKeys = opts.floatKeys ?? new Set<string>();

  const num = (x: number, asFloat: boolean): string => {
    if (!Number.isFinite(x)) {
      if (!allowNan) throw new ValueError("Out of range float values are not JSON compliant");
      return Number.isNaN(x) ? "NaN" : x > 0 ? "Infinity" : "-Infinity";
    }
    if (Number.isInteger(x) && !asFloat && Math.abs(x) < 2 ** 63) return BigInt(x).toString();
    return floatRepr(x);
  };

  const enc = (v: unknown, level: number, asFloat: boolean): string => {
    if (v === null || v === undefined) return "null";
    if (v === true) return "true";
    if (v === false) return "false";
    if (typeof v === "number") return num(v, asFloat);
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "string") return encodeString(v, ensureAscii);
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      if (indent === null) return `[${v.map((x) => enc(x, level + 1, asFloat)).join(itemSep)}]`;
      const pad = "\n" + " ".repeat(indent * (level + 1));
      return `[${pad}${v.map((x) => enc(x, level + 1, asFloat)).join(itemSep + pad)}\n${" ".repeat(indent * level)}]`;
    }
    if (typeof v === "object") {
      let entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
      if (opts.sortKeys) entries = entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (entries.length === 0) return "{}";
      const parts = entries.map(([k, x]) => `${encodeString(k, ensureAscii)}${keySep}${enc(x, level + 1, floatKeys.has(k))}`);
      if (indent === null) return `{${parts.join(itemSep)}}`;
      const pad = "\n" + " ".repeat(indent * (level + 1));
      return `{${pad}${parts.join(itemSep + pad)}\n${" ".repeat(indent * level)}}`;
    }
    throw new TypeError(`Object of type ${typeof v} is not JSON serializable`);
  };

  return enc(value, 0, false);
}

const SHORT: Record<string, string> = {
  '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f",
};

function hex4(c: number): string {
  return "\\u" + c.toString(16).padStart(4, "0");
}

/** A JSON string literal as Python's encoder writes it. */
export function encodeString(s: string, ensureAscii: boolean = true): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const c = s.charCodeAt(i);
    if (SHORT[ch] !== undefined) out += SHORT[ch];
    else if (c < 0x20) out += hex4(c);
    // ensure_ascii escapes everything outside " " .. "~" (DEL too); a
    // character outside the BMP is already two UTF-16 units here, which is
    // exactly the surrogate pair Python writes.
    else if (ensureAscii && (c < 0x20 || c > 0x7e)) out += hex4(c);
    else out += ch;
  }
  return out + '"';
}

/** `json.loads`. Python also reads NaN and Infinity; nothing the pipeline
 *  reads contains them. */
export function loads(text: string): any {
  return JSON.parse(text);
}
