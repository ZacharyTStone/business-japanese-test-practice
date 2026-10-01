/**
 * Who is asking, as the database will be told.
 *
 * Cloudflare Access stands in front of the whole Worker, so by the time a
 * request reaches this code a person has already signed in, and
 * `ctx.access.getIdentity()` says who (no token to verify by hand: Access has
 * done that). No `ctx.access` means Access did not run at all — switched off,
 * or a route it does not cover — and the answer is no, never "let it through".
 *
 * Access knows an email; the database knows a user id. `ACCESS_USERS` is the
 * map between them, a secret (`wrangler secret put ACCESS_USERS`) holding
 * `{"you@example.com": "<the auth.users id>"}`. A secret rather than a
 * variable because the address must not be in the repository or the public
 * deploy log. The id is the one the account already has, so every answer,
 * review rung and level keeps belonging to it.
 *
 * An address Access let in that the map does not name is refused here as
 * well. The database would refuse it anyway — `is_tester()` reads the same
 * email from the claims — but there is no user id to give it.
 */

export type Caller = { userId: string; email: string };

/** `email` is set on a refusal of an address Access did sign in, so the app
 *  can say which account is not on the list. */
export type Refusal = { status: 401 | 403; code: string; message: string; email?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The email → user id map, from the secret's JSON. Malformed entries are
 *  dropped rather than trusted; a malformed secret maps nobody. */
export function parseUserMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return map;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return map;
  for (const [email, id] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof id === "string" && UUID.test(id) && email.includes("@")) {
      map.set(email.trim().toLowerCase(), id.toLowerCase());
    }
  }
  return map;
}

/** The caller, or why not. `email` is what Access says; null when it said nothing. */
export function resolveCaller(
  accessRan: boolean,
  email: string | null | undefined,
  users: Map<string, string>
): Caller | Refusal {
  if (!accessRan) {
    return { status: 401, code: "access_missing", message: "Cloudflare Access did not run for this request" };
  }
  const address = (email ?? "").trim().toLowerCase();
  if (!address) {
    return { status: 401, code: "session_expired", message: "Cloudflare Access session expired" };
  }
  const userId = users.get(address);
  if (!userId) {
    return { status: 403, code: "not_a_tester", message: "This account is not on the list", email: address };
  }
  return { userId, email: address };
}

export function isRefusal(x: Caller | Refusal): x is Refusal {
  return "status" in x;
}

/** The JWT claims the schema's `auth.uid()` / `auth.jwt()` read — the same
 *  three a Supabase access token carries for the fields the schema uses. */
export function claimsFor(caller: Caller): string {
  return JSON.stringify({
    sub: caller.userId,
    email: caller.email,
    role: "authenticated",
    aud: "authenticated",
    is_anonymous: false,
  });
}
