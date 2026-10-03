/**
 * The plain half of signing in: what the way back from Google says. The half
 * that talks to the Worker is lib/authClient.ts; the Worker's side is
 * worker/auth.ts.
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
