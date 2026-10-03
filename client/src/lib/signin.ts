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
 * tester list: worker/auth.ts refuses an address it does not name, which
 * Better Auth reports as `unable_to_create_user`. Anything else is a failure
 * to try again.
 */
export function signInRefusal(search: string): SignInRefusal | null {
  const code = new URLSearchParams(search).get("error");
  if (!code) return null;
  return code === "unable_to_create_user" ? "not_listed" : "failed";
}
