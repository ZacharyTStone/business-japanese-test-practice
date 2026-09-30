/**
 * The link in a password-reset email, taken apart.
 *
 * Supabase sends the learner to `/reset-password` (the web) or
 * `bizjadrill://reset-password` (the app) with the outcome after a `#` — a
 * session to set the new password with (`access_token`, `refresh_token`,
 * `type=recovery`), or why there is none (`error_code=otp_expired`, a link
 * already used or too old). A project switched to the PKCE flow sends a
 * `?code=` instead. On the web supabase-js reads the session out of the
 * address itself; on a phone nothing does, so this is what the app reads it
 * with, and on both it is what says "this launch is a password reset".
 *
 * Parsed by hand: React Native's URL and URLSearchParams are incomplete, and
 * this is two separators and a decode. Plain, so `npm test` holds it.
 */
export type AuthLink = {
  /** Whether this is a link for setting a new password at all. */
  recovery: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  code: string | null;
  /** Why the link carries no session, when it carries none. */
  error: { code: string; message: string } | null;
};

function params(part: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of part.split("&")) {
    if (!pair) continue;
    const at = pair.indexOf("=");
    const key = at < 0 ? pair : pair.slice(0, at);
    const raw = at < 0 ? "" : pair.slice(at + 1);
    try {
      out[decodeURIComponent(key)] = decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

export function parseAuthLink(url: string): AuthLink {
  const hashAt = url.indexOf("#");
  const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  const base = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const found = {
    ...params(queryAt < 0 ? "" : beforeHash.slice(queryAt + 1)),
    ...params(hashAt < 0 ? "" : url.slice(hashAt + 1)),
  };
  const toReset = /reset-password\/?$/.test(base);
  const error =
    found.error || found.error_code
      ? { code: found.error_code || found.error, message: found.error_description || found.error || "" }
      : null;
  return {
    recovery: found.type === "recovery" || (toReset && Boolean(found.code || found.access_token || error)),
    accessToken: found.access_token || null,
    refreshToken: found.refresh_token || null,
    code: found.code || null,
    error,
  };
}
