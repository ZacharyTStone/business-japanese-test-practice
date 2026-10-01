/**
 * Who is asking: the address Cloudflare Access signed in.
 *
 * Access stands in front of the whole Worker, so by the time a request
 * reaches this code a person has already signed in, and the token Access
 * signed says who (access.ts checks it). No token means Access did not run at
 * all — switched off, or a route it does not cover — and the answer is no,
 * never "let it through".
 *
 * The address is all this file decides. Which account it is, and whether the
 * tester list has it, is the database's to say (core/caller.ts): an address
 * the list does not name is refused before any query runs (index.ts).
 */

/** `email` is set on a refusal of an address Access did sign in, so the app
 *  can say which account is not on the list. */
export type Refusal = { status: 401 | 403 | 500 | 503; code: string; message: string; email?: string };

/** The signed-in address, lower-cased, or why there is none. */
export function signedInEmail(accessRan: boolean, email: string | null | undefined): string | Refusal {
  if (!accessRan) {
    return { status: 401, code: "access_missing", message: "Cloudflare Access did not run for this request" };
  }
  const address = (email ?? "").trim().toLowerCase();
  if (!address) {
    return { status: 401, code: "session_expired", message: "Cloudflare Access session expired" };
  }
  return address;
}

export function notATester(email: string): Refusal {
  return { status: 403, code: "not_a_tester", message: "This account is not on the list", email };
}

export function isRefusal(x: unknown): x is Refusal {
  return typeof x === "object" && x !== null && "status" in x;
}
