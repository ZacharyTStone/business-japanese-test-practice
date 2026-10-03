/**
 * Who is asking, for every route that serves a person: the queries and the
 * media.
 *
 * First a session this Worker signed in itself (auth.ts) — its cookie on the
 * web, its signed token as `Authorization: Bearer` from a phone. Then, while
 * Cloudflare Access still stands in front of the site, the token Access signed
 * (access.ts) — so the switch has no flag day: the sign-in can go live before
 * Access comes off, and Access can come off without a release.
 *
 * With a sign-in of its own, a token Access no longer vouches for (expired, or
 * from an Access application since remade) is nobody, `signed_out`, so the app
 * offers Google rather than a reload into an Access that is gone. Without one,
 * Access's answer stands as it always did. A Worker with neither configured
 * says so (500) rather than looking like a learner who is simply signed out.
 *
 * Better Auth renews a session that is being used, and refreshes its signed
 * cookie cache, by setting cookies; `cookies` carries them so the response can
 * hand them on, or a session would end 30 days after sign-in however often it
 * was used.
 *
 * What this decides is only the address. Whether the tester list has it is
 * core/caller.ts's to say, for every query, as before.
 */
import { accessEmail, accessToken, fetchKeys, type KeySource } from "./access";
import { authFor, type AuthEnv } from "./auth";
import { isRefusal, signedInEmail, type Refusal } from "./identity";

export type WhoEnv = AuthEnv & { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string };

/** The address asking, the `Set-Cookie` values to send back with the answer
 *  (empty unless the session was renewed or its cache refreshed), and whether
 *  it came through the Worker's own sign-in rather than Access: an account
 *  for a Google sign-in is made only while its sign-in exists
 *  (core/caller.ts). */
export type Caller = { email: string; cookies: string[]; viaSession: boolean };

/** Nobody signed in: no session, and no token from Access. */
export const signedOut: Refusal = { status: 401, code: "signed_out", message: "Not signed in" };

const unavailable: Refusal = { status: 503, code: "sign_in_unavailable", message: "The sign-in could not be checked" };

const notConfigured: Refusal = {
  status: 500,
  code: "sign_in_not_configured",
  message: "Neither the sign-in's secrets nor ACCESS_TEAM_DOMAIN and ACCESS_AUD are set",
};

/** Hand Better Auth's cookies on with a response the Worker built. */
export function withCookies(res: Response, caller: Caller): Response {
  for (const cookie of caller.cookies) res.headers.append("set-cookie", cookie);
  return res;
}

export async function whoIsAsking(
  request: Request,
  env: WhoEnv,
  ctx: { access?: { getIdentity(): Promise<{ email?: string } | undefined> } } | undefined,
  now: number = Date.now(),
  keys: KeySource = fetchKeys
): Promise<Caller | Refusal> {
  const auth = authFor(env);
  const accessConfigured = Boolean(env.ACCESS_TEAM_DOMAIN?.trim() && env.ACCESS_AUD?.trim());
  if (!auth && !accessConfigured && !ctx?.access) return notConfigured;

  let checked = true;
  if (auth) {
    try {
      const { headers, response } = await auth.api.getSession({ headers: request.headers, returnHeaders: true });
      if (response) {
        const email = signedInEmail(true, response.user.email);
        return isRefusal(email) ? email : { email, cookies: headers.getSetCookie(), viaSession: true };
      }
    } catch {
      // The sign-in could not answer (its database, say): Access may still.
      checked = false;
    }
  }

  // ctx.access when the runtime hands it over; on a Worker with static assets
  // it never does, and the token Access signed says the same (access.ts).
  if (ctx?.access) {
    const email = signedInEmail(true, (await ctx.access.getIdentity())?.email);
    return isRefusal(email) ? email : { email, cookies: [], viaSession: false };
  }
  if (accessToken(request)) {
    const email = await accessEmail(request, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }, now, keys);
    if (!isRefusal(email)) return { email, cookies: [], viaSession: false };
    if (!auth) return email;
  }
  return checked ? signedOut : unavailable;
}
