/**
 * The app's one Worker: the web build, the API and the media, on one origin.
 *
 *   /api/q/<name>   a query from worker/queries.ts, as the signed-in learner
 *   /api/auth/...   the sign-in itself: Better Auth, with Google (worker/auth.ts)
 *   /media/...      a clip or a picture from R2 (worker/media.ts)
 *   anything else   the static web build, served by the assets binding
 *
 * `run_worker_first` in wrangler.jsonc sends only /api/* and /media/* here;
 * every other request is served from the assets without running this code.
 * The web build holds no data, so the assets need no door. The queries and
 * the media check who is asking themselves (who.ts) — a session this Worker
 * signed in — and behind that the tester list in D1 is the door every query
 * passes (core/caller.ts).
 *
 * Same origin, so there is no CORS to configure and the session cookie rides
 * along with every request the app makes.
 */
import { authFor, type AuthEnv } from "./auth";
import { resolveLearner } from "./core/caller";
import { apiError, toApiError } from "./core/errors";
import { isRefusal, notATester, type Refusal } from "./identity";
import { serveMedia } from "./media";
import { isQueryName, queries } from "./queries";
import { whoIsAsking, withCookies } from "./who";

export interface Env extends AuthEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Every error this file writes itself, in the one shape the app reads
 *  (core/errors.ts): a refusal names the address it refused in `details`,
 *  and nothing else here has details or a hint. */
function errorResponse(code: string, message: string, status: number, details: string | null = null): Response {
  const { error } = apiError(code, message, status);
  return json({ error: { ...error, details } }, status);
}

function refuse(r: Refusal): Response {
  return errorResponse(r.code, r.message, r.status, r.email ?? null);
}

/** One named query, as `email`. Exported for the tests, which run it against
 *  a local D1 without a sign-in in front: they pass `checkSignIn: false`, as
 *  nothing else may (core/caller.ts). */
export async function runQuery(
  db: D1Database,
  email: string,
  name: string,
  args: Record<string, unknown>,
  { now = Date.now(), random = Math.random, checkSignIn = true }: { now?: number; random?: (id: string) => number; checkSignIn?: boolean } = {}
): Promise<Response> {
  if (!isQueryName(name)) {
    return errorResponse("unknown_query", `no query named ${name}`, 404);
  }
  try {
    const learner = await resolveLearner(db, email, { checkSignIn });
    if (!learner.isTester) return refuse(notATester(email));
    const data = await queries[name]({ db, learner, now, random }, args);
    return json({ data: data ?? null });
  } catch (e) {
    const { status, error } = toApiError(e);
    return json({ error }, status);
  }
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const name = new URL(request.url).pathname.replace(/^\/api\/q\//, "");
  if (request.method !== "POST") return errorResponse("method_not_allowed", "POST only", 405);

  const caller = await whoIsAsking(request, env);
  if (isRefusal(caller)) return refuse(caller);

  let args: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as { args?: unknown };
    if (body && typeof body.args === "object" && body.args !== null && !Array.isArray(body.args)) {
      args = body.args as Record<string, unknown>;
    }
  } catch {
    // No body, or not JSON: the query is asked with no arguments, and one that
    // needs them says which.
  }
  return withCookies(await runQuery(env.DB, caller.email, name, args), caller);
}

/** The sign-in's own routes. Before its secrets are set there is no sign-in,
 *  and every query answers `sign_in_not_configured` (who.ts). */
async function handleAuth(request: Request, env: Env): Promise<Response> {
  const auth = authFor(env);
  if (!auth) return errorResponse("sign_in_not_configured", "The sign-in is not set up", 404);
  return auth.handler(request);
}

/** A clip or a picture, for somebody signed in: the clips are the bank read
 *  aloud, and the bank is not public. */
async function handleMedia(request: Request, env: Env): Promise<Response> {
  const caller = await whoIsAsking(request, env);
  if (isRefusal(caller)) return new Response(caller.message, { status: caller.status, headers: { "cache-control": "no-store" } });
  return withCookies(await serveMedia(request, env), caller);
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/q/")) return handleApi(request, env);
    if (pathname.startsWith("/api/auth/")) return handleAuth(request, env);
    if (pathname.startsWith("/media/")) return handleMedia(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
