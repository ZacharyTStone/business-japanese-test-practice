/**
 * Who is asking, in the words every route shares: the address a session
 * names, or why there is none.
 *
 * The address is all this file decides. Which account it is, and whether the
 * tester list has it, is the database's to say (core/caller.ts): an address
 * the list does not name is refused before any query runs (index.ts).
 */

/** `email` is set on a refusal of an address that did sign in, so the app
 *  can say which account is not on the list. */
export type Refusal = { status: 401 | 403 | 500 | 503; code: string; message: string; email?: string };

/** Nobody signed in. The app offers Google. */
export const signedOut: Refusal = { status: 401, code: "signed_out", message: "Not signed in" };

/** The signed-in address, lower-cased, or nobody: a session without an
 *  address speaks for no one. */
export function signedInEmail(email: string | null | undefined): string | Refusal {
  const address = (email ?? "").trim().toLowerCase();
  return address || signedOut;
}

export function notATester(email: string): Refusal {
  return { status: 403, code: "not_a_tester", message: "This account is not on the list", email };
}

export function isRefusal(x: unknown): x is Refusal {
  return typeof x === "object" && x !== null && "status" in x;
}
