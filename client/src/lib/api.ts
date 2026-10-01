/**
 * The app's one way to the database: a named query, sent to the Worker.
 *
 * The Worker (client/worker/) runs it as the signed-in learner, with
 * row-level security deciding what they see exactly as it did when the app
 * spoke to PostgREST. The app names a query from worker/queries.ts and passes
 * its arguments; it never sends SQL, a table or a column list.
 *
 * On the web the Worker is the origin the app was loaded from, so a request
 * carries the Cloudflare Access cookie and there is nothing to configure. A
 * native build would need `EXPO_PUBLIC_API_BASE` — and a sign-in Access does
 * not give it — so for now the app is a web app.
 *
 * A failure throws the shape supabase-js threw — `code`, `message`,
 * `details`, `hint` — so `errorText` and `errorKind` read it unchanged.
 */
import { Platform } from "react-native";

const BASE = (process.env.EXPO_PUBLIC_API_BASE ?? "").replace(/\/+$/, "");

/** True when there is a Worker to talk to. Screens check this and show setup
 *  instructions rather than a stack trace, so a fresh native checkout runs. */
export const isConfigured = Platform.OS === "web" || BASE !== "";

export const MISSING_CONFIG_MESSAGE =
  "EXPO_PUBLIC_API_BASE が設定されていません。web 版（npm run build:web と wrangler dev）で開くか、Worker の URL を設定してください。";

/** An address on the Worker: the API, or a clip or picture under /media. */
export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

export type ApiError = { code: string; message: string; details: string | null; hint: string | null };

const EXPIRED: ApiError = {
  code: "session_expired",
  message: "Cloudflare Access session expired",
  details: null,
  hint: null,
};

export async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(apiUrl(`/api/q/${name}`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args }),
    credentials: "include",
    // An expired Access session answers with a redirect to Cloudflare's
    // sign-in page, on another origin, which fetch cannot follow. Stopped
    // here, it reads as what it is rather than as "offline".
    redirect: "manual",
  });
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) throw EXPIRED;

  let body: { data?: unknown; error?: ApiError } | null = null;
  try {
    body = (await res.json()) as { data?: unknown; error?: ApiError };
  } catch {
    body = null;
  }
  // Access itself may answer an expired session with a bare 401 page rather
  // than a redirect; the Worker's own 401s carry a JSON error.
  if (res.status === 401 && !body?.error) throw EXPIRED;
  if (!res.ok || !body || body.error) {
    throw body?.error ?? { code: String(res.status), message: `HTTP ${res.status}`, details: null, hint: null };
  }
  return body.data as T;
}

/** Where to go to sign out of Cloudflare Access (and so out of the app). */
export const SIGN_OUT_URL = "/cdn-cgi/access/logout";
