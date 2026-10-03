/**
 * The plain half of a native build's sign-in: addresses and strings, nothing
 * that needs a device. lib/nativeAuth.ts is the half that opens the browser
 * tab and keeps the token; worker/native.ts is the Worker's side, and says why
 * the round trip has this shape.
 */

/** Where the browser tab comes back to: the app's scheme (app.json). The
 *  Worker sends the tab nowhere else (worker/native.ts, NATIVE_REDIRECT). */
export const NATIVE_REDIRECT = "bizjadrill://auth";

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Standard base64, as a digest arrives, written as base64url. */
export function base64ToUrl(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The page the tab opens: behind Access, so the tab signs in first. */
export function signInUrl(base: string, challenge: string, state: string): string {
  const q = new URLSearchParams({ challenge, state });
  return `${base}/auth/native/start?${q.toString()}`;
}

/** The code the tab came back with — if it came back to this app, from this
 *  sign-in. Anything else (another state, another address) is not ours. */
export function codeFromCallback(url: string, state: string): string | null {
  if (!url.startsWith(`${NATIVE_REDIRECT}?`)) return null;
  const q = new URLSearchParams(url.slice(NATIVE_REDIRECT.length + 1));
  const code = q.get("code");
  if (q.get("state") !== state || !code || !/^[A-Za-z0-9_-]{43}$/.test(code)) return null;
  return code;
}

/**
 * Whether a response a native build got reads as "not signed in". A browser
 * is stopped at Access's redirect (lib/api.ts asks for that); a native fetch
 * follows it to Access's own sign-in page and reports what it found there —
 * a page, not the Worker's JSON. So: a page where JSON was due, or a bare
 * 401 or 403, is Access turning the token away.
 */
export function nativeSignedOut(status: number, contentType: string | null): boolean {
  const json = (contentType ?? "").toLowerCase().includes("application/json");
  if (json) return false;
  return (status >= 200 && status < 300) || status === 401 || status === 403;
}
