/**
 * Sign-in for a native build, through the same Cloudflare Access as the web.
 *
 * Access is a browser sign-in: what it leaves behind is a cookie, in a
 * browser, and an app has no browser of its own. So the app opens this site in
 * a browser tab (expo-web-browser), Access signs the person in there as it
 * would anywhere, and this hands the token the tab ends up holding back to the
 * app. Not in the link back to it: any app on a phone can claim a scheme like
 * bizjadrill://, so the link carries a one-time code, and the code is good
 * only with a secret the app made and nobody else saw (PKCE, RFC 7636: the app
 * sends the secret's hash when it starts, and the secret when it collects).
 *
 *   GET  /auth/native/start  Behind Access, like every page. The token Access
 *                            signed is checked as any query's is (access.ts).
 *                            An address the tester list does not name gets a
 *                            page saying so, and nothing about it is kept. A
 *                            listed one's token waits two minutes under the
 *                            hash of a fresh code, beside the app's challenge,
 *                            and the tab is sent back to the app with the code.
 *   POST /auth/native/token  The one path Access must let through unsigned (a
 *                            Bypass policy on exactly this path): the app has
 *                            no token yet. A code is good once — collecting it
 *                            deletes it, right secret or not — for two
 *                            minutes, and only with the secret its challenge
 *                            was made from. The answer is the token.
 *
 * The app then sends the token as `cf-access-token` on every request, which
 * Access accepts in place of the cookie, and access.ts checks it as it checks
 * the cookie. Nothing here makes a token or lengthens one: the app holds what
 * the browser would have held, for as long as Access says, and then signs in
 * again.
 *
 * What PKCE does not do: stop another app on the same phone from starting a
 * sign-in of its own and claiming the link back, since any app may claim a
 * custom scheme. It protects a sign-in this app started. An Android App Link
 * (an https link the phone has verified belongs to this app) would close that,
 * and is the step to take before the app is open to the public.
 */
import { accessEmail, accessToken, fetchKeys, type AccessConfig, type KeySource } from "./access";
import { isRefusal } from "./identity";

/** Where the tab goes back to: the app's own scheme (app.json) and nowhere
 *  else, so this can never be made to hand a code to a web page. */
export const NATIVE_REDIRECT = "bizjadrill://auth";

/** How long a code waits to be collected: the hop from the tab to the app. */
export const CODE_TTL_MS = 2 * 60 * 1000;

const B64URL = /^[A-Za-z0-9_-]+$/;

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** The challenge a verifier makes, as the app computes it (S256). */
export async function challengeOf(verifier: string): Promise<string> {
  return base64url(await sha256(verifier));
}

/** An S256 challenge: a SHA-256 in base64url, 43 characters. */
export function validChallenge(s: unknown): s is string {
  return typeof s === "string" && s.length === 43 && B64URL.test(s);
}

/** RFC 7636's verifier: 43 to 128 of its unreserved characters. */
export function validVerifier(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(s);
}

/** The app's own round-trip value, handed back untouched. */
export function validState(s: unknown): s is string {
  return typeof s === "string" && s.length >= 16 && s.length <= 128 && B64URL.test(s);
}

/** A code as `newCode` makes them. */
function validCode(s: unknown): s is string {
  return typeof s === "string" && s.length === 43 && B64URL.test(s);
}

/** 32 random bytes: not guessable in two minutes, or in two centuries. */
export function newCode(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Keep `token` for two minutes under a fresh code, and return the code.
 *  Only its hash is stored. Rows past their time go first (and again on every
 *  collection), so none outlasts its two minutes by more than the gap until
 *  the next sign-in. */
export async function issueCode(
  db: D1Database,
  token: string,
  challenge: string,
  now: number,
  code: string = newCode()
): Promise<string> {
  const hash = base64url(await sha256(code));
  await db.batch([
    db.prepare("delete from native_sign_ins where expires_at <= ?").bind(iso(now)),
    db
      .prepare("insert into native_sign_ins (code_hash, challenge, token, expires_at) values (?, ?, ?, ?)")
      .bind(hash, challenge, token, iso(now + CODE_TTL_MS)),
  ]);
  return code;
}

/** The token a code was issued for, once. The row goes whatever the answer,
 *  so a code that reached the wrong hands is spent by their first try. */
export async function redeemCode(db: D1Database, code: unknown, verifier: unknown, now: number): Promise<string | null> {
  if (!validCode(code)) return null;
  const row = await db
    .prepare("delete from native_sign_ins where code_hash = ? returning challenge, token, expires_at")
    .bind(base64url(await sha256(code)))
    .first<{ challenge: string; token: string; expires_at: string }>();
  await db.prepare("delete from native_sign_ins where expires_at <= ?").bind(iso(now)).run();
  if (!row || row.expires_at <= iso(now) || !validVerifier(verifier)) return null;
  return row.challenge === (await challengeOf(verifier)) ? row.token : null;
}

export type NativeEnv = { db: D1Database; access: Partial<AccessConfig> };

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A page in the tab, for the ways a sign-in does not go back to the app. In
 *  both languages, since the tab cannot know which one the app is in. */
function page(status: number, title: string, lines: string[]): Response {
  const html =
    `<!doctype html><html lang="ja"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.7">` +
    `<h1 style="font-size:1.2rem">${title}</h1>${lines.map((l) => `<p>${l}</p>`).join("")}</body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE } });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE },
  });
}

async function start(request: Request, url: URL, env: NativeEnv, now: number, keys: KeySource): Promise<Response> {
  const challenge = url.searchParams.get("challenge");
  const state = url.searchParams.get("state");
  if (!validChallenge(challenge) || !validState(state)) {
    return page(400, "ログインを始められませんでした / Sign-in could not start", [
      "アプリに戻って、もう一度ログインしてください。",
      "Go back to the app and sign in again.",
    ]);
  }
  const email = await accessEmail(request, env.access, now, keys);
  if (isRefusal(email)) {
    return page(email.status, "ログインできませんでした / Sign-in failed", [
      "アプリに戻って、もう一度ログインしてください。",
      "Go back to the app and sign in again.",
    ]);
  }
  // The door, as every query meets it (core/caller.ts): an address the list
  // does not name is told so here, and nothing about it is stored.
  const listed = await env.db.prepare("select 1 as listed from testers where email = ?").bind(email).first();
  if (!listed) {
    const who = escapeHtml(email);
    return page(403, "まだ公開していません / Not open yet", [
      `${who} はテスト参加者に登録されていません。別のアカウントで入る場合は、<a href="/cdn-cgi/access/logout">ログアウト</a>してください。`,
      `${who} is not on the tester list. To use another account, <a href="/cdn-cgi/access/logout">sign out</a> first.`,
    ]);
  }
  // Exactly the token accessEmail has just checked.
  const token = accessToken(request) as string;
  const code = await issueCode(env.db, token, challenge, now);
  return new Response(null, {
    status: 302,
    headers: { location: `${NATIVE_REDIRECT}?code=${code}&state=${state}`, ...NO_STORE },
  });
}

async function collect(request: Request, env: NativeEnv, now: number): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const fields = body && typeof body === "object" ? (body as { code?: unknown; verifier?: unknown }) : {};
  const token = await redeemCode(env.db, fields.code, fields.verifier, now);
  if (!token) {
    return json(400, { error: { code: "sign_in_failed", message: "That sign-in code is not valid", details: null, hint: null } });
  }
  return json(200, { data: { token } });
}

/** `/auth/native/*`. */
export async function handleNative(
  request: Request,
  env: NativeEnv,
  now: number = Date.now(),
  keys: KeySource = fetchKeys
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/auth/native/start") {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { allow: "GET" } });
    return start(request, url, env, now, keys);
  }
  if (url.pathname === "/auth/native/token") {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    return collect(request, env, now);
  }
  return new Response(null, { status: 404 });
}
