/**
 * The plain half of signing in: what the way back from Google says, on the
 * web and on a phone, and how a phone says who it is. The halves that talk to
 * the Worker are lib/authClient.ts (web) and lib/phoneSignIn.ts (Android);
 * the Worker's side is worker/auth.ts.
 */

/** How a sign-in that came back without a session went wrong. */
export type SignInRefusal = "not_listed" | "failed";

/**
 * Better Auth sends the browser back with `error=<code>` when a sign-in did
 * not end signed in. The one the learner can do something about is the
 * tester list: worker/auth.ts refuses an address it does not name with its own
 * code, `not_on_tester_list`. Anything else — Google not having verified the
 * address, or the account simply failing to be made (`unable_to_create_user`
 * is what a database hiccup looks like) — is a failure to try again, never a
 * "you are not on the list" told to somebody who is.
 */
export function signInRefusal(search: string): SignInRefusal | null {
  const code = new URLSearchParams(search).get("error");
  if (!code) return null;
  return code === "not_on_tester_list" ? "not_listed" : "failed";
}

/** The headers that carry a phone's session, or none without one. */
export function bearerHeaders(token: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** How a sign-in on a phone ended without a session. `cancelled` is the
 *  learner closing Google's sheet, which needs no message at all. */
export type PhoneSignInRefusal = "cancelled" | "no_account" | "not_listed" | "not_configured" | "failed";

/** What Google's account sheet failing means (modules/google-sign-in): the
 *  two cases the learner can do something about, and everything else. */
export function googleRefusal(code: unknown): PhoneSignInRefusal {
  if (code === "ERR_SIGN_IN_CANCELLED") return "cancelled";
  if (code === "ERR_NO_GOOGLE_ACCOUNT") return "no_account";
  return "failed";
}

/**
 * What the Worker answered a phone's Google ID token with: the signed session
 * token (Better Auth's bearer plugin sends it as `set-auth-token`), or why
 * not. The tester list's refusal is its own code, as on the web; a Worker
 * whose sign-in is not set up answers 404; anything else is "try again".
 */
export function phoneSignInAnswer(
  status: number,
  signedToken: string | null,
  body: unknown
): { token: string } | { refused: PhoneSignInRefusal } {
  if (status >= 200 && status < 300 && signedToken) return { token: signedToken };
  const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  if (code === "not_on_tester_list") return { refused: "not_listed" };
  if (status === 404) return { refused: "not_configured" };
  return { refused: "failed" };
}
