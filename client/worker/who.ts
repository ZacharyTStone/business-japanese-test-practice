/**
 * Who is asking, for every route that serves a person: the queries and the
 * media.
 *
 * First a session this Worker signed in itself (auth.ts). Then, while
 * Cloudflare Access still stands in front of the site, the token Access signed
 * (access.ts) — so the switch has no flag day: the sign-in can go live before
 * Access comes off, and Access can come off without a release. Neither is
 * `signed_out`, which the app answers with the sign-in.
 *
 * What this decides is only the address. Whether the tester list has it is
 * core/caller.ts's to say, for every query, as before.
 */
import { accessEmail, accessToken, type KeySource, fetchKeys } from "./access";
import { authFor, type AuthEnv } from "./auth";
import { signedInEmail, type Refusal } from "./identity";

export type WhoEnv = AuthEnv & { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string };

/** Nobody signed in: no session, and no token from Access. */
export const signedOut: Refusal = { status: 401, code: "signed_out", message: "Not signed in" };

const unavailable: Refusal = { status: 503, code: "sign_in_unavailable", message: "The sign-in could not be checked" };

export async function whoIsAsking(
  request: Request,
  env: WhoEnv,
  ctx: { access?: { getIdentity(): Promise<{ email?: string } | undefined> } } | undefined,
  now: number = Date.now(),
  keys: KeySource = fetchKeys
): Promise<string | Refusal> {
  const auth = authFor(env);
  if (auth) {
    let session: { user: { email: string } } | null;
    try {
      session = await auth.api.getSession({ headers: request.headers });
    } catch {
      return unavailable;
    }
    if (session) return signedInEmail(true, session.user.email);
  }
  // ctx.access when the runtime hands it over; on a Worker with static assets
  // it never does, and the token Access signed says the same (access.ts).
  if (ctx?.access) return signedInEmail(true, (await ctx.access.getIdentity())?.email);
  if (accessToken(request)) {
    return accessEmail(request, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }, now, keys);
  }
  return signedOut;
}
