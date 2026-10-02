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
import { len, PyError, sorted, splitWs, str, strip, truthy, ValueError } from "./py.ts";

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
  for (const byte of _utf8(text)) {
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
  return createHmac("sha256", key).update(_utf8(msg)).digest();
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
    createHash("sha256").update(_utf8(canonical)).digest("hex"),
  ].join("\n");
  const key = _hmac(_hmac(_hmac(_hmac(_utf8(`AWS4${secret}`), day), region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(_utf8(toSign)).digest("hex");
  out["Authorization"] = (`AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, `
                          + `SignedHeaders=${signed}, Signature=${signature}`);
  return out;
}

// ----- the three calls -----------------------------------------------------------

/** The bucket already holds an object at that key, and it was not replaced. */
export class AlreadyExists extends PyError {}

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

// ----- Python's behaviour where JavaScript's differs --------------------------

/** Python's UnicodeEncodeError (a ValueError): text with a lone surrogate has
 *  no UTF-8 form. */
class UnicodeEncodeError extends ValueError {}

const LONE_SURROGATE = new RegExp("[\\uD800-\\uDFFF]", "u");

/** `s.encode("utf-8")`, strict: a lone surrogate is refused rather than
 *  replaced with U+FFFD (which would sign something else). */
function _utf8(s: string): Buffer {
  const m = LONE_SURROGATE.exec(s);
  if (m) {
    const ch = m[0].charCodeAt(0).toString(16);
    throw new UnicodeEncodeError(
      `'utf-8' codec can't encode character '\\u${ch}' in position ${len(s.slice(0, m.index))}: surrogates not allowed`,
    );
  }
  return Buffer.from(s, "utf8");
}

// ----- the listing's XML, as xml.etree.ElementTree reads it ---------------------
//
// A listing is a small, flat document, and only three things are read from it:
// every `Key` element anywhere, and the text of two of the root's children. So
// rather than a dependency, a reader of exactly what ElementTree gives those
// three lookups: elements named `{namespace}local` (the namespace resolved from
// the `xmlns` declarations in scope), an element's `text` being the character
// data before its first child (entities and CDATA decoded, comments dropped,
// None when there is none), and a document that is not well-formed refused.

/** `xml.etree.ElementTree.ParseError`. */
export class ParseError extends PyError {}

/** An element as ElementTree holds it: `tag` in `{namespace}local` form. */
export type XmlElement = { tag: string; text: string | null; children: XmlElement[] };

const NAME = "[A-Za-z_\\u00C0-\\uFFFF][-A-Za-z0-9_.\\u00B7\\u00C0-\\uFFFF]*(?::[A-Za-z_\\u00C0-\\uFFFF][-A-Za-z0-9_.\\u00B7\\u00C0-\\uFFFF]*)?";
const OPEN_TAG = new RegExp(`^<(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>`, "u");
const ATTR = new RegExp(`(${NAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, "gu");
const CLOSE_TAG = new RegExp(`^</(${NAME})\\s*>`, "u");

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", apos: "'", quot: '"' };

/** Character data with its references replaced; an unknown entity is not
 *  well-formed. */
function _unescape(text: string): string {
  return text.replace(/&([^;&]*);?/g, (whole, name: string) => {
    if (!whole.endsWith(";")) throw new ParseError("not well-formed (invalid token)");
    if (Object.prototype.hasOwnProperty.call(ENTITIES, name)) return ENTITIES[name];
    const num = /^#(?:x([0-9A-Fa-f]+)|([0-9]+))$/.exec(name);
    if (num) {
      const cp = num[1] !== undefined ? parseInt(num[1], 16) : parseInt(num[2], 10);
      if (cp > 0x10ffff || cp === 0 || (cp >= 0xd800 && cp <= 0xdfff)) {
        throw new ParseError("reference to invalid character number");
      }
      return String.fromCodePoint(cp);
    }
    throw new ParseError(`undefined entity &${name};`);
  });
}

/** `ET.fromstring(data)` for a UTF-8 document. */
export function _fromstring(data: Uint8Array): XmlElement {
  // The XML spec's end-of-line handling, which expat applies before anything
  // else sees the text.
  let doc: string;
  try {
    doc = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(data).replace(/\r\n?/g, "\n");
  } catch {
    throw new ParseError("not well-formed (invalid token)");
  }
  let pos = 0;
  let root: XmlElement | null = null;
  const stack: { el: XmlElement; ns: Map<string, string>; qname: string; sawChild: boolean }[] = [];
  const nsAt = () => (stack.length ? stack[stack.length - 1].ns : new Map<string, string>([["xml", "http://www.w3.org/XML/1998/namespace"]]));

  const addText = (t: string) => {
    if (t === "") return;
    if (!stack.length) {
      if (/\S/.test(t)) throw new ParseError(root ? "junk after document element" : "syntax error");
      return;
    }
    const top = stack[stack.length - 1];
    // Text after a child is that child's tail, which nothing here reads.
    if (!top.sawChild) top.el.text = (top.el.text ?? "") + t;
  };

  const resolve = (qname: string, ns: Map<string, string>): string => {
    const colon = qname.indexOf(":");
    if (colon < 0) {
      const uri = ns.get("");
      return uri ? `{${uri}}${qname}` : qname;
    }
    const prefix = qname.slice(0, colon);
    const uri = ns.get(prefix);
    if (uri === undefined) throw new ParseError("unbound prefix");
    return `{${uri}}${qname.slice(colon + 1)}`;
  };

  while (pos < doc.length) {
    const rest = doc.slice(pos);
    if (rest.startsWith("<?")) {
      const end = doc.indexOf("?>", pos + 2);
      if (end < 0) throw new ParseError("unclosed token");
      pos = end + 2;
    } else if (rest.startsWith("<!--")) {
      const end = doc.indexOf("-->", pos + 4);
      if (end < 0) throw new ParseError("unclosed token");
      pos = end + 3;
    } else if (rest.startsWith("<![CDATA[")) {
      const end = doc.indexOf("]]>", pos + 9);
      if (end < 0) throw new ParseError("unclosed CDATA section");
      if (!stack.length) throw new ParseError("syntax error");
      addText(doc.slice(pos + 9, end));
      pos = end + 3;
    } else if (rest.startsWith("<!DOCTYPE")) {
      const end = doc.indexOf(">", pos);
      if (end < 0) throw new ParseError("unclosed token");
      pos = end + 1;
    } else if (rest.startsWith("</")) {
      const m = CLOSE_TAG.exec(rest);
      if (!m) throw new ParseError("not well-formed (invalid token)");
      const top = stack.pop();
      if (!top || top.qname !== m[1]) throw new ParseError("mismatched tag");
      pos += m[0].length;
    } else if (rest.startsWith("<")) {
      const m = OPEN_TAG.exec(rest);
      if (!m) throw new ParseError("not well-formed (invalid token)");
      if (!stack.length && root) throw new ParseError("junk after document element");
      const ns = new Map(nsAt());
      for (const a of m[2].matchAll(ATTR)) {
        const value = _unescape(a[2] ?? a[3]);
        if (a[1] === "xmlns") ns.set("", value);
        else if (a[1].startsWith("xmlns:")) ns.set(a[1].slice(6), value);
      }
      const el: XmlElement = { tag: resolve(m[1], ns), text: null, children: [] };
      if (stack.length) {
        const parent = stack[stack.length - 1];
        parent.el.children.push(el);
        parent.sawChild = true;
      } else {
        root = el;
      }
      if (!m[3]) stack.push({ el, ns, qname: m[1], sawChild: false });
      pos += m[0].length;
    } else {
      const end = doc.indexOf("<", pos);
      const text = doc.slice(pos, end < 0 ? doc.length : end);
      addText(_unescape(text));
      pos += text.length;
    }
  }
  if (stack.length) throw new ParseError("no element found");
  if (!root) throw new ParseError("no element found");
  return root;
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
