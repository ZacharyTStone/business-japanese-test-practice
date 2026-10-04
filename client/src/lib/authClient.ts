/**
 * Signing in and out of the Worker's own sign-in (worker/auth.ts), from the
 * web. Google is the way in: the page goes to Google and comes back to the
 * Worker, which sets a session cookie on this origin, and every query and clip
 * after that carries it by itself (lib/api.ts asks with `credentials`).
 *
 * The client is made on first use, not when the module loads: a native build
 * imports this file too, and has no page to read an origin from.
 */
import { createAuthClient } from "better-auth/client";

import { apiUrl } from "./api";

type AuthClient = ReturnType<typeof createAuthClient>;
let client: AuthClient | null = null;

function authClient(): AuthClient {
  const origin = apiUrl("") || (typeof window !== "undefined" ? window.location.origin : "");
  if (!client) client = createAuthClient({ baseURL: origin });
  return client;
}

/** Why the sign-in could not even start: the Worker has no sign-in yet, or
 *  anything else (offline, refused). Null when the page is on its way to Google. */
export type SignInStart = null | "not_configured" | "failed";

/**
 * Off to Google, and back to the app's home. The way back is a path, not an
 * address, so it is this origin whichever of the Worker's addresses the page
 * was opened on. A refusal after Google comes back to the same page with
 * `error=` (lib/signin.ts reads it); a refusal before it is returned here,
 * because Better Auth's client answers with `{ error }` rather than throwing.
 */
export async function signInWithGoogle(): Promise<SignInStart> {
  try {
    const { error } = await authClient().signIn.social({ provider: "google", callbackURL: "/", errorCallbackURL: "/" });
    if (!error) return null;
    return error.status === 404 ? "not_configured" : "failed";
  } catch {
    return "failed";
  }
}

/** Out of the Worker's sign-in: the session ends and its cookies go. The
 *  page then starts again from the top, at the sign-in screen. */
export async function signOutOnWeb(): Promise<void> {
  await authClient()
    .signOut()
    .catch(() => undefined);
}
