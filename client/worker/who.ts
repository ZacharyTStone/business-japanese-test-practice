/**
 * Who is asking, for every route that serves a person: the queries and the
 * media.
 *
 * A session this Worker signed in itself (auth.ts): its cookie on the web,
 * its signed token as `Authorization: Bearer` from a phone. Nothing else
 * speaks for anybody. Cloudflare Access stood in front of the site until
 * 2026-10-04 and its token was accepted after a session; that fallback is
 * gone, so a header or cookie Access would have set is nobody.
 *
 * Nobody signed in is `signed_out`, and the app offers Google. A Worker
 * without the sign-in's secrets says so (500) rather than looking like a
 * learner who is simply signed out, and a sign-in that cannot answer (its
 * database, say) is a 503, not "signed out".
 *
 * Better Auth renews a session that is being used, and refreshes its signed
 * cookie cache, by setting cookies; `cookies` carries them so the response can
 * hand them on, or a session would end 30 days after sign-in however often it
 * was used.
 *
 * What this decides is only the address. Whether the tester list has it is
 * core/caller.ts's to say, for every query, as before.
 */
import { authFor, type AuthEnv } from "./auth";
import { isRefusal, signedInEmail, signedOut, type Refusal } from "./identity";

export { signedOut };

/** The address asking, and the `Set-Cookie` values to send back with the
 *  answer (empty unless the session was renewed or its cache refreshed). */
export type Caller = { email: string; cookies: string[] };

const unavailable: Refusal = { status: 503, code: "sign_in_unavailable", message: "The sign-in could not be checked" };

const notConfigured: Refusal = {
  status: 500,
  code: "sign_in_not_configured",
  message: "The sign-in's secrets are not set",
};

/** Hand Better Auth's cookies on with a response the Worker built. */
export function withCookies(res: Response, caller: Caller): Response {
  for (const cookie of caller.cookies) res.headers.append("set-cookie", cookie);
  return res;
}

export async function whoIsAsking(request: Request, env: AuthEnv): Promise<Caller | Refusal> {
  const auth = authFor(env);
  if (!auth) return notConfigured;
  try {
    const { headers, response } = await auth.api.getSession({ headers: request.headers, returnHeaders: true });
    if (!response) return signedOut;
    const email = signedInEmail(response.user.email);
    return isRefusal(email) ? email : { email, cookies: headers.getSetCookie() };
  } catch {
    return unavailable;
  }
}
