/**
 * The address Cloudflare Access signed in, read from the token it signed.
 *
 * Access stands in front of the whole site and, on every request it lets
 * through, adds `Cf-Access-Jwt-Assertion`: a JWT naming the person, signed
 * with the team's key. `ctx.access.getIdentity()` would hand the same answer
 * over ready-made, but a Worker with static assets runs behind Cloudflare's
 * asset router, and the router does not pass `ctx.access` on (Cloudflare's
 * docs, "ctx.access limitations"). So this checks the token itself:
 *
 *   - signed RS256 by one of the team's keys (`/cdn-cgi/access/certs` on the
 *     team domain — a domain pinned in wrangler.jsonc, never read from the
 *     token, or anybody's own Access team could vouch for any address);
 *   - issued by that team, for this application (its AUD tag, pinned too);
 *   - not expired.
 *
 * A header that is not a token the team signed is worth nothing, so a missing,
 * malformed or forged one is a refusal, never "let it through" — the same
 * answer as when Access did not run at all.
 */
import { isRefusal, signedInEmail, type Refusal } from "./identity";

export type AccessConfig = { teamDomain: string; aud: string };

type Jwk = JsonWebKey & { kid?: string };

/** The team's public keys, by URL. The Worker fetches them; the tests hand
 *  them over. */
export type KeySource = (url: string) => Promise<Jwk[]>;

export type Claims = { email?: unknown; iss?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown };

/** How far a clock may run ahead of Access's before a fresh token reads as
 *  not yet valid. */
const SKEW_SECONDS = 60;

const KEYS_TTL_MS = 60 * 60 * 1000;
let cached: { url: string; keys: Jwk[]; at: number } | null = null;

export const fetchKeys: KeySource = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Access keys: HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  return Array.isArray(body.keys) ? body.keys : [];
};

/** The team's keys, an hour at a time — or now, when a token names a key the
 *  cached set lacks (Access rotates them). */
async function teamKeys(url: string, source: KeySource, now: number, fresh: boolean): Promise<Jwk[]> {
  if (!fresh && cached && cached.url === url && now - cached.at < KEYS_TTL_MS) return cached.keys;
  const keys = await source(url);
  cached = { url, keys, at: now };
  return keys;
}

/** For the tests: forget the keys between cases. */
export function forgetKeys(): void {
  cached = null;
}

/** `team.cloudflareaccess.com`, however it was written down. */
export function teamHost(teamDomain: string): string {
  return teamDomain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/** The token Access put on the request: its header, else the one a native
 *  build sends itself, else its cookie (the same token each time; the browser
 *  sends the cookie on every same-origin request, and a native build, which
 *  has no cookie, sends `cf-access-token`, which Access accepts in its place —
 *  see native.ts). Whichever it is, it is checked the same way. */
export function accessToken(request: Request): string | null {
  const header = request.headers.get("cf-access-jwt-assertion")?.trim();
  if (header) return header;
  const native = request.headers.get("cf-access-token")?.trim();
  if (native) return native;
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "CF_Authorization" && rest.length) return rest.join("=").trim() || null;
  }
  return null;
}

function bytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function json(b64url: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes(b64url)));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const invalid: Refusal = { status: 401, code: "access_invalid", message: "The Cloudflare Access token is not one this app's team signed" };
const expired: Refusal = { status: 401, code: "session_expired", message: "Cloudflare Access session expired" };

/** The token's claims if the team signed it for this application and it is
 *  in date; otherwise why not. */
export async function verifyAccessToken(
  token: string,
  config: AccessConfig,
  now: number,
  source: KeySource = fetchKeys
): Promise<Claims | Refusal> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return invalid;
  const [h, p, s] = parts as [string, string, string];
  const header = json(h);
  const claims = json(p) as Claims | null;
  // RS256 only: never "none", never a shared-secret algorithm a public key
  // could be passed off as.
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") return invalid;

  const host = teamHost(config.teamDomain);
  const url = `https://${host}/cdn-cgi/access/certs`;
  const find = (keys: Jwk[]) => keys.find((k) => k.kid === header.kid && k.kty === "RSA" && k.n && k.e);
  let jwk = find(await teamKeys(url, source, now, false));
  if (!jwk) jwk = find(await teamKeys(url, source, now, true));
  if (!jwk) return invalid;

  let signed: boolean;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    signed = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes(s), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    return invalid;
  }
  if (!signed) return invalid;

  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== `https://${host}` || !auds.includes(config.aud)) return invalid;
  const seconds = now / 1000;
  if (typeof claims.exp !== "number" || claims.exp <= seconds) return expired;
  if (typeof claims.nbf === "number" && claims.nbf > seconds + SKEW_SECONDS) return invalid;
  return claims;
}

/** Who is asking: the signed-in address, lower-cased, or why there is none.
 *  Missing settings refuse everybody rather than nobody. */
export async function accessEmail(
  request: Request,
  config: Partial<AccessConfig>,
  now: number,
  source: KeySource = fetchKeys
): Promise<string | Refusal> {
  if (!config.teamDomain?.trim() || !config.aud?.trim()) {
    return { status: 500, code: "access_not_configured", message: "ACCESS_TEAM_DOMAIN and ACCESS_AUD are not set" };
  }
  const token = accessToken(request);
  if (!token) return signedInEmail(false, undefined);
  let claims: Claims | Refusal;
  try {
    claims = await verifyAccessToken(token, { teamDomain: config.teamDomain, aud: config.aud.trim() }, now, source);
  } catch {
    return { status: 503, code: "access_keys_unavailable", message: "Cloudflare Access's keys could not be fetched" };
  }
  if (isRefusal(claims)) return claims;
  return signedInEmail(true, typeof claims.email === "string" ? claims.email : undefined);
}
