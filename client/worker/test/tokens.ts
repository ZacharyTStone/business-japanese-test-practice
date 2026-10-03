/**
 * Credentials for the database tests, made the way the real ones are: an
 * Access token signed with a key the test hands to the check as the team's
 * (as access.test.ts does), a Google ID token signed with a key the test
 * serves as Google's, and a Better Auth session cookie signed with the auth
 * secret (HMAC-SHA256 of the token, as Better Auth signs it).
 */
import type { KeySource } from "../access";

export const TEAM = "drill.cloudflareaccess.com";
export const AUD = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2";

export type Pair = { privateKey: CryptoKey; jwk: JsonWebKey & { kid: string } };

function b64url(data: Uint8Array | string): string {
  const raw = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function keyPair(kid: string): Promise<Pair> {
  const k = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", k.publicKey)) as JsonWebKey;
  return { privateKey: k.privateKey, jwk: { ...jwk, kid, alg: "RS256", use: "sig" } };
}

export const keysOf = (...pairs: Pair[]): KeySource => async () => pairs.map((p) => p.jwk);

async function signed(key: Pair, claims: Record<string, unknown>): Promise<string> {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: key.jwk.kid, typ: "JWT" }));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

/** A token Access would sign for `email`, valid an hour either side of `now`. */
export async function accessTokenFor(key: Pair, email: string, now: number): Promise<string> {
  const sec = Math.floor(now / 1000);
  return signed(key, { aud: [AUD], email, exp: sec + 3600, iat: sec - 60, nbf: sec - 60, iss: `https://${TEAM}`, type: "app" });
}

/** The ID token Google's account sheet hands a phone (Credential Manager):
 *  issued for `aud`, the Web client id, with the nonce the phone asked for. */
export async function googleIdTokenFor(
  key: Pair,
  claims: { aud: string; email: string; email_verified?: boolean; nonce?: string },
  now: number
): Promise<string> {
  const sec = Math.floor(now / 1000);
  return signed(key, {
    iss: "https://accounts.google.com",
    sub: `google-${claims.email}`,
    name: "Tester",
    picture: "https://photo.example/me.jpg",
    email_verified: true,
    iat: sec - 10,
    exp: sec + 3600,
    ...claims,
  });
}

/** The session cookie Better Auth sets on an https site for `token`. */
export async function sessionCookie(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)));
  const signed = `${token}.${btoa(String.fromCharCode(...sig))}`;
  return `__Secure-better-auth.session_token=${encodeURIComponent(signed)}`;
}
