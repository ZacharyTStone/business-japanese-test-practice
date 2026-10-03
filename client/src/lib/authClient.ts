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

function origin(): string {
  return apiUrl("") || (typeof window !== "undefined" ? window.location.origin : "");
}

function authClient(): AuthClient {
  if (!client) client = createAuthClient({ baseURL: origin() });
  return client;
}

/** Off to Google, and back to the app's home. A refusal comes back to the
 *  same page with `error=` (lib/signin.ts reads it). */
export async function signInWithGoogle(): Promise<void> {
  const home = `${origin()}/`;
  await authClient().signIn.social({ provider: "google", callbackURL: home, errorCallbackURL: home });
}

/** Out of the Worker's sign-in. A failure leaves nothing to undo: the session
 *  cookie is the Worker's to clear, and it expires by itself. */
export async function signOutOfWorker(): Promise<void> {
  await authClient()
    .signOut()
    .catch(() => undefined);
}
