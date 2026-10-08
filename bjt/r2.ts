/**
 * The media bucket: Cloudflare R2, over its S3 API, signed by hand.
 *
 * The app serves every clip and picture from one private R2 bucket through its
 * Worker (client/worker/media.ts), at the key `<folder>/<path>` — `audio/…` for
 * the clips, `scenes/…` for the pictures — where `<path>` is exactly what the
 * database holds (`audio_clips.audio_path`, `scenes.image_path`). This module is
 * how the pipeline puts them there.
 *
 * Three operations, which is all the pipeline needs: put an object (optionally
 * only if nothing is there yet — R2 honours `If-None-Match: *` and answers 412
 * when the key is taken), and list the keys under a prefix. Each is one request
 * through `bjt/http.ts`, signed with AWS Signature Version 4, which R2 speaks
 * with the region `auto`. No SDK: the signing is forty lines of `node:crypto`,
 * and the S3 SDK would be the largest dependency in the project for three
 * calls.
 *
 * The credentials are an R2 API token's S3 pair, read from the environment when
 * the bucket is used, never stored in config:
 *
 *     R2_ACCOUNT_ID         the Cloudflare account id (the endpoint's host)
 *     R2_ACCESS_KEY_ID      the token's access key id
 *     R2_SECRET_ACCESS_KEY  the token's secret
 *     R2_BUCKET             the bucket, `business-japanese-drill-media` by default
 *
 * A token scoped to that one bucket, with object read and write, is all it
 * needs; it must never reach the client or a commit.
 */
import { createHash, createHmac } from "node:crypto";
import * as http from "./http.ts";
import { PyError, RuntimeError, sorted, splitWs, str, strip, truthy, utf8 } from "./py.ts";

export const DEFAULT_BUCKET = "business-japanese-drill-media";
export const REGION = "auto";
export const SERVICE = "s3";
export const _S3_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}";
export const _EMPTY_SHA256 = createHash("sha256").update(new Uint8Array(0)).digest("hex");

/** The signing clock; the tests' seam. */
export function _now(): Date {
  return new Date();
}

/** The clock `_request` signs with, replaceable (a test or a parity check
 *  fixes it). */
export const seams = {
  now: _now,
};

export class Credentials {
  readonly account_id: string;
  readonly access_key_id: string;
  readonly secret_access_key: string;
  readonly bucket: string;

  constructor(init: { account_id: string; access_key_id: string; secret_access_key: string; bucket?: string }) {
    this.account_id = init.account_id;
    this.access_key_id = init.access_key_id;
    this.secret_access_key = init.secret_access_key;
    this.bucket = init.bucket ?? DEFAULT_BUCKET;
  }

  get host(): string {
    return `${this.account_id}.r2.cloudflarestorage.com`;
  }

  /** The environment's pair, or null when any part of it is missing. */
  static fromEnv(): Credentials | null {
    const account = strip(process.env.R2_ACCOUNT_ID ?? "");
    const keyId = strip(process.env.R2_ACCESS_KEY_ID ?? "");
    const secret = strip(process.env.R2_SECRET_ACCESS_KEY ?? "");
    const bucket = strip(process.env.R2_BUCKET ?? "") || DEFAULT_BUCKET;
    if (!(account && keyId && secret)) {
      return null;
    }
    return new Credentials({ account_id: account, access_key_id: keyId, secret_access_key: secret, bucket });
  }
}

export const NOT_CONFIGURED = "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are not set";

// ----- Signature Version 4 ----------------------------------------------------

/** `urllib.parse.quote(text, safe)`: every byte of the UTF-8 form that is not a
 *  letter, a digit, `_.-~` or in `safe` written as `%XX`. */
export function _quote(text: string, opts: { safe?: string } = {}): string {
  const safe = opts.safe ?? "-_.~";
  let out = "";
  for (const byte of utf8(text)) {
    const ch = String.fromCharCode(byte);
    if (byte < 0x80 && (/[A-Za-z0-9_.\-~]/.test(ch) || safe.includes(ch))) out += ch;
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** Each segment percent-encoded once, the slashes kept (S3 does not
 *  double-encode). */
export function canonicalUri(path: string): string {
  return path.split("/").map((seg) => _quote(seg)).join("/");
}

export function canonicalQuery(query: Record<string, string>): string {
  return sorted(Object.entries(query)).map(([k, v]) => `${_quote(k)}=${_quote(v)}`).join("&");
}

function _hmac(key: Uint8Array, msg: string): Buffer {
  return createHmac("sha256", key).update(utf8(msg)).digest();
}

/** `when.strftime(fmt)` for the two stamps a signature carries, in UTC. */
function _stamp(when: Date, withTime: boolean): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${when.getUTCFullYear()}${p(when.getUTCMonth() + 1)}${p(when.getUTCDate())}`;
  return withTime ? `${day}T${p(when.getUTCHours())}${p(when.getUTCMinutes())}${p(when.getUTCSeconds())}Z` : day;
}

/** The headers to send: `headers` plus host, the date, the payload hash and
 *  the Authorization that signs every one of them. */
export function sign(
  method: string,
  host: string,
  path: string,
  query: Record<string, string>,
  headers: Record<string, string>,
  payloadSha256: string,
  accessKeyId: string,
  secret: string,
  opts: { when: Date; region?: string; service?: string },
): Record<string, string> {
  const when = opts.when;
  const region = opts.region ?? REGION;
  const service = opts.service ?? SERVICE;
  const amzDate = _stamp(when, true);
  const day = _stamp(when, false);
  const out: Record<string, string> = { ...headers, host: host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadSha256 };
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(out)) lower[k.toLowerCase()] = splitWs(str(v)).join(" ");
  const names = sorted(Object.keys(lower));
  const signed = names.join(";");
  const canonical = [
    method,
    canonicalUri(path),
    canonicalQuery(query),
    names.map((k) => `${k}:${lower[k]}\n`).join(""),
    signed,
    payloadSha256,
  ].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(utf8(canonical)).digest("hex"),
  ].join("\n");
  const key = _hmac(_hmac(_hmac(_hmac(utf8(`AWS4${secret}`), day), region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(utf8(toSign)).digest("hex");
  out["Authorization"] = (`AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, `
                          + `SignedHeaders=${signed}, Signature=${signature}`);
  return out;
}

// ----- the three calls -----------------------------------------------------------

/** The bucket already holds an object at that key, and it was not replaced. */
export class AlreadyExists extends RuntimeError {}

export async function _request(
  creds: Credentials,
  method: string,
  key: string,
  opts: { query?: Record<string, string> | null; body?: Uint8Array; headers?: Record<string, string> | null; retries?: number } = {},
): Promise<Uint8Array> {
  const body = opts.body ?? new Uint8Array(0);
  const retries = opts.retries ?? 0;
  const path = `/${creds.bucket}` + (key ? `/${key}` : "");
  const query = opts.query && Object.keys(opts.query).length ? opts.query : {};
  const signed = sign(method, creds.host, path, query, opts.headers ?? {},
                      body.length ? createHash("sha256").update(body).digest("hex") : _EMPTY_SHA256,
                      creds.access_key_id, creds.secret_access_key, { when: seams.now() });
  let url = `https://${creds.host}${canonicalUri(path)}`;
  if (truthy(query)) {
    url += "?" + canonicalQuery(query);
  }
  delete signed["host"]; // fetch sets it, from the same URL
  return await http.request(method, url, { body: method === "PUT" ? body : null, headers: signed, retries });
}

/** Put one object. Without `overwrite`, an object already at `key` is left
 *  alone and `AlreadyExists` says so. */
export async function put(creds: Credentials, key: string, data: Uint8Array, contentType: string,
                          opts: { overwrite?: boolean } = {}): Promise<void> {
  const overwrite = opts.overwrite ?? true;
  const headers: Record<string, string> = { "content-type": contentType };
  if (!overwrite) {
    headers["if-none-match"] = "*";
  }
  try {
    await _request(creds, "PUT", key, { body: data, headers });
  } catch (exc) {
    if (exc instanceof http.RequestFailed && !overwrite && exc.status === 412) {
      throw new AlreadyExists(`${key} is already in the bucket`, { cause: exc });
    }
    throw exc;
  }
}

/** Every key under `prefix`, a page at a time. With a delimiter, only the
 *  keys directly under it (no "folders"). */
export async function listKeys(creds: Credentials, prefix: string,
                               opts: { delimiter?: string | null } = {}): Promise<string[]> {
  const delimiter = opts.delimiter ?? null;
  let keys: string[] = [];
  let token: string | null = null;
  for (;;) {
    const query: Record<string, string> = { "list-type": "2", prefix: prefix, "max-keys": "1000" };
    if (delimiter) {
      query["delimiter"] = delimiter;
    }
    if (token) {
      query["continuation-token"] = token;
    }
    // A listing is safe to ask for twice.
    const root = _fromstring(await _request(creds, "GET", "", { query, retries: 2 }));
    keys = keys.concat(_iter(root, `${_S3_NS}Key`).map((el) => el.text || ""));
    const truncated = (_findtext(root, `${_S3_NS}IsTruncated`) || "false").toLowerCase() === "true";
    token = _findtext(root, `${_S3_NS}NextContinuationToken`);
    if (!truncated || !token) {
      return keys;
    }
  }
}

// ----- the listing's XML, as xml.etree.ElementTree reads it ---------------------
//
// A listing is a small, flat document, and only three things are read from it:
// every `Key` element anywhere, and the text of two of the root's children. So
// rather than a dependency, a reader of exactly what ElementTree gives those
// three lookups: elements named `{namespace}local` (the namespace resolved from
// the `xmlns` declarations in scope), an element's `text` being the character
// data before its first child (entities and CDATA decoded, comments dropped,
// None when there is none), and a document that is not well-formed refused
// with expat's words and position — which is what a warning about an
// unreadable ledger quotes. The document is read as UTF-8, which is what R2
// sends; a declared encoding is not consulted.

/** `xml.etree.ElementTree.ParseError`: expat's reason, then where. */
export class ParseError extends PyError {
  readonly position: [number, number];
  constructor(reason: string, position: [number, number]) {
    super(`${reason}: line ${position[0]}, column ${position[1]}`);
    this.position = position;
  }
}

/** An element as ElementTree holds it: `tag` in `{namespace}local` form. */
export type XmlElement = { tag: string; text: string | null; children: XmlElement[] };

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", apos: "'", quot: '"' };
const INVALID = "not well-formed (invalid token)";

const _isWs = (ch: string | undefined) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
const _isNameStart = (ch: string | undefined) => ch !== undefined && (/[A-Za-z_:]/.test(ch) || ch.charCodeAt(0) >= 0xc0);
const _isNameChar = (ch: string | undefined) => ch !== undefined && (_isNameStart(ch) || /[-.0-9\u00B7]/.test(ch));
/** A character XML does not allow anywhere (after end-of-line handling). */
const _isInvalidChar = (ch: string) => {
  const code = ch.charCodeAt(0);
  return (code < 0x20 && ch !== "\t" && ch !== "\n") || code === 0xfffe || code === 0xffff;
};

/** The offset of the first byte that is not UTF-8, or -1. */
function _badUtf8(data: Uint8Array): number {
  let i = 0;
  while (i < data.length) {
    const b = data[i];
    let need: number;
    let lo = 0x80;
    let hi = 0xbf;
    if (b < 0x80) need = 0;
    else if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      if (b === 0xe0) lo = 0xa0;
      if (b === 0xed) hi = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      if (b === 0xf0) lo = 0x90;
      if (b === 0xf4) hi = 0x8f;
    } else return i;
    for (let k = 1; k <= need; k++) {
      const c = data[i + k];
      if (c === undefined || c < (k === 1 ? lo : 0x80) || c > (k === 1 ? hi : 0xbf)) return i;
    }
    i += need + 1;
  }
  return -1;
}

/** `ET.fromstring(data)` for a UTF-8 document. */
export function _fromstring(data: Uint8Array): XmlElement {
  const decode = (bytes: Uint8Array) =>
    // The XML spec's end-of-line handling, which expat applies before anything
    // else sees the text. A byte order mark is kept: expat counts it as a column.
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).replace(/\r\n?/g, "\n");
  const where = (text: string, i: number): [number, number] => {
    const before = text.slice(0, i);
    const nl = before.lastIndexOf("\n");
    return [before.split("\n").length, [...before.slice(nl + 1)].length];
  };
  const bad = _badUtf8(data);
  if (bad >= 0) {
    const prefix = decode(data.subarray(0, bad));
    throw new ParseError(INVALID, where(prefix, prefix.length));
  }
  const doc = decode(data);
  const n = doc.length;
  const fail = (reason: string, i: number): never => {
    throw new ParseError(reason, where(doc, i));
  };

  /** A character or entity reference at `k` (an `&`): its text, and where
   *  the reference ends. `at` is where a reference expat refuses is reported. */
  const reference = (k: number, at: number | null): [string, number] => {
    let j = k + 1;
    if (doc[j] === "#") {
      j++;
      const hex = doc[j] === "x";
      if (hex) j++;
      const digits = j;
      while (j < n && (hex ? /[0-9A-Fa-f]/ : /[0-9]/).test(doc[j])) j++;
      if (j === digits || doc[j] !== ";") fail(INVALID, at ?? j);
      const cp = parseInt(doc.slice(digits, j), hex ? 16 : 10);
      const ok = cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff)
        || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
      if (!ok) fail("reference to invalid character number", at ?? k);
      return [String.fromCodePoint(cp), j + 1];
    }
    if (!_isNameStart(doc[j])) fail(INVALID, at ?? j);
    while (j < n && _isNameChar(doc[j])) j++;
    if (doc[j] !== ";") fail(INVALID, at ?? j);
    const name = doc.slice(k + 1, j);
    if (!Object.prototype.hasOwnProperty.call(ENTITIES, name)) fail("undefined entity", at ?? k);
    return [ENTITIES[name], j + 1];
  };

  /** Character data from `i` to `end`, its references replaced. */
  const chars = (i: number, end: number): string => {
    let out = "";
    let k = i;
    while (k < end) {
      const c = doc[k];
      if (c === "&") {
        const [text, next] = reference(k, null);
        out += text;
        k = next;
        continue;
      }
      if (c === "]" && doc.startsWith("]]>", k)) fail(INVALID, k + 2);
      if (_isInvalidChar(c)) fail(INVALID, k);
      out += c;
      k++;
    }
    return out;
  };

  let root: XmlElement | null = null;
  const stack: { el: XmlElement; ns: Map<string, string>; qname: string; sawChild: boolean }[] = [];
  const nsAt = () => (stack.length ? stack[stack.length - 1].ns : new Map<string, string>([["xml", "http://www.w3.org/XML/1998/namespace"]]));

  const addText = (t: string) => {
    if (t === "") return;
    const top = stack[stack.length - 1];
    // Text after a child is that child's tail, which nothing here reads.
    if (!top.sawChild) top.el.text = (top.el.text ?? "") + t;
  };

  const resolve = (qname: string, ns: Map<string, string>, at: number): string => {
    const colon = qname.indexOf(":");
    if (colon < 0) {
      const uri = ns.get("");
      return uri ? `{${uri}}${qname}` : qname;
    }
    const uri = ns.get(qname.slice(0, colon));
    if (uri === undefined) fail("unbound prefix", at);
    return `{${uri}}${qname.slice(colon + 1)}`;
  };

  const openTag = (i: number): number => {
    if (!stack.length && root) fail("junk after document element", i);
    let j = i + 1;
    if (j >= n) fail("unclosed token", i);
    if (!_isNameStart(doc[j])) fail(INVALID, j);
    while (j < n && _isNameChar(doc[j])) j++;
    const qname = doc.slice(i + 1, j);
    const attrs: [string, number, number][] = [];
    let selfClosing = false;
    for (;;) {
      const gap = j;
      while (j < n && _isWs(doc[j])) j++;
      if (j >= n) fail("unclosed token", i);
      if (doc[j] === ">") {
        j++;
        break;
      }
      if (doc[j] === "/") {
        if (j + 1 >= n) fail("unclosed token", i);
        if (doc[j + 1] !== ">") fail(INVALID, j + 1);
        j += 2;
        selfClosing = true;
        break;
      }
      if (j === gap || !_isNameStart(doc[j])) fail(INVALID, j);
      const nameAt = j;
      while (j < n && _isNameChar(doc[j])) j++;
      const name = doc.slice(nameAt, j);
      while (j < n && _isWs(doc[j])) j++;
      if (j >= n) fail("unclosed token", i);
      if (doc[j] !== "=") fail(INVALID, j);
      j++;
      while (j < n && _isWs(doc[j])) j++;
      if (j >= n) fail("unclosed token", i);
      const quote = doc[j];
      if (quote !== '"' && quote !== "'") fail(INVALID, j);
      let k = j + 1;
      while (k < n && doc[k] !== quote) {
        if (doc[k] === "<") fail(INVALID, k);
        k++;
      }
      if (k >= n) fail("unclosed token", i);
      if (attrs.some(([a]) => a === name)) fail("duplicate attribute", nameAt);
      attrs.push([name, j + 1, k]);
      j = k + 1;
    }
    const ns = new Map(nsAt());
    for (const [name, from, to] of attrs) {
      // An attribute value's whitespace is normalised to spaces; a reference
      // is not. A reference expat refuses is reported at the tag.
      let value = "";
      for (let k = from; k < to;) {
        if (doc[k] === "&") {
          const [text, next] = reference(k, i);
          value += text;
          k = next;
        } else {
          if (_isInvalidChar(doc[k])) fail(INVALID, k);
          value += _isWs(doc[k]) ? " " : doc[k];
          k++;
        }
      }
      if (name === "xmlns" || name.startsWith("xmlns:")) ns.set(name === "xmlns" ? "" : name.slice(6), value);
    }
    const el: XmlElement = { tag: resolve(qname, ns, i), text: null, children: [] };
    if (stack.length) {
      const parent = stack[stack.length - 1];
      parent.el.children.push(el);
      parent.sawChild = true;
    } else {
      root = el;
    }
    if (!selfClosing) stack.push({ el, ns, qname, sawChild: false });
    return j;
  };

  const closeTag = (i: number): number => {
    if (!stack.length) fail(INVALID, i + 1);
    let j = i + 2;
    if (j >= n) fail("unclosed token", i);
    if (!_isNameStart(doc[j])) fail(INVALID, j);
    while (j < n && _isNameChar(doc[j])) j++;
    const qname = doc.slice(i + 2, j);
    while (j < n && _isWs(doc[j])) j++;
    if (j >= n) fail("unclosed token", i);
    if (doc[j] !== ">") fail(INVALID, j);
    if (stack.pop()!.qname !== qname) fail("mismatched tag", i + 2);
    return j + 1;
  };

  let i = doc.startsWith("\uFEFF") ? 1 : 0;
  while (i < n) {
    if (doc[i] !== "<") {
      let end = doc.indexOf("<", i);
      if (end < 0) end = n;
      if (stack.length) {
        addText(chars(i, end));
      } else {
        // Outside the document element only whitespace may stand.
        let p = i;
        while (p < end && _isWs(doc[p])) p++;
        if (p < end) {
          if (_isInvalidChar(doc[p])) fail(INVALID, p);
          if (root) fail("junk after document element", p);
          // Before it, expat's prolog reads a name and finds no declaration.
          if (!_isNameChar(doc[p])) fail(INVALID, p);
          let q = p;
          while (q < n && _isNameChar(doc[q])) q++;
          fail(q >= n || _isWs(doc[q]) ? "syntax error" : INVALID, q >= n || _isWs(doc[q]) ? p : q);
        }
      }
      i = end;
    } else if (doc.startsWith("<?", i)) {
      const end = doc.indexOf("?>", i + 2);
      if (end < 0) fail("unclosed token", i);
      i = end + 2;
    } else if (doc.startsWith("<!--", i)) {
      const end = doc.indexOf("-->", i + 4);
      if (end < 0) fail("unclosed token", i);
      i = end + 3;
    } else if (doc.startsWith("<![CDATA[", i)) {
      if (!stack.length) fail("syntax error", i);
      const end = doc.indexOf("]]>", i + 9);
      if (end < 0) fail("unclosed CDATA section", n);
      addText(doc.slice(i + 9, end));
      i = end + 3;
    } else if (doc.startsWith("<!DOCTYPE", i)) {
      const end = doc.indexOf(">", i);
      if (end < 0) fail("unclosed token", i);
      i = end + 1;
    } else if (doc.startsWith("<!", i)) {
      fail(INVALID, i + 2);
    } else if (doc.startsWith("</", i)) {
      i = closeTag(i);
    } else {
      i = openTag(i);
    }
  }
  if (stack.length || !root) fail("no element found", n);
  return root!;
}

/** `elem.iter(tag)`: the element and every descendant with that tag, in
 *  document order. */
export function _iter(el: XmlElement, tag: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (e: XmlElement) => {
    if (e.tag === tag) out.push(e);
    for (const c of e.children) walk(c);
  };
  walk(el);
  return out;
}

/** `elem.findtext(tag)`: the text of the first direct child with that tag
 *  ("" when it has none), or null when there is no such child. */
export function _findtext(el: XmlElement, tag: string): string | null {
  const child = el.children.find((c) => c.tag === tag);
  return child === undefined ? null : child.text ?? "";
}
