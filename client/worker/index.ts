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
 * signed in, or, while Cloudflare Access still stands in front of the site,
 * the token Access signed — and behind that the tester list in D1 is the door
 * every query passes (core/caller.ts).
 *
 * Same origin, so there is no CORS to configure and the session cookie rides
 * along with every request the app makes.
 */
import type { AuthEnv } from "./auth";
import { authFor } from "./auth";
import { resolveLearner } from "./core/caller";
import { toApiError } from "./core/errors";
import { isRefusal, notATester, type Refusal } from "./identity";
import { serveMedia } from "./media";
import { queries } from "./queries";
import { whoIsAsking } from "./who";

export interface Env extends AuthEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  /** `<team>.cloudflareaccess.com` and the Access application's AUD tag
   *  (wrangler.jsonc `vars`): whose signature, for which app, a token needs,
   *  while Access is still in front of the site. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function refuse(r: Refusal): Response {
  return json({ error: { code: r.code, message: r.message, details: r.email ?? null, hint: null } }, r.status);
}

/** One named query, as `email`. Exported for the tests, which run it against
 *  a local D1 without an Access in front. */
export async function runQuery(
  db: D1Database,
  email: string,
  name: string,
  args: Record<string, unknown>,
  now = Date.now(),
  random: (id: string) => number = Math.random
): Promise<Response> {
  if (!Object.prototype.hasOwnProperty.call(queries, name)) {
    return json({ error: { code: "unknown_query", message: `no query named ${name}` } }, 404);
  }
  try {
    const learner = await resolveLearner(db, email);
    if (!learner.isTester) return refuse(notATester(email));
    const data = await queries[name]({ db, learner, now, random }, args);
    return json({ data: data ?? null });
  } catch (e) {
    const { status, error } = toApiError(e);
    return json({ error }, status);
  }
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const name = new URL(request.url).pathname.replace(/^\/api\/q\//, "");
  if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "POST only" } }, 405);

  const email = await whoIsAsking(request, env, ctx);
  if (isRefusal(email)) return refuse(email);

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
  return runQuery(env.DB, email, name, args);
}

/** The sign-in's own routes. Before its secrets are set there is no sign-in,
 *  and the app goes on as Access lets it (auth.ts). */
async function handleAuth(request: Request, env: Env): Promise<Response> {
  const auth = authFor(env);
  if (!auth) return json({ error: { code: "sign_in_not_configured", message: "The sign-in is not set up" } }, 404);
  return auth.handler(request);
}

/** A clip or a picture, for somebody signed in: the clips are the bank read
 *  aloud, and the bank is not public. */
async function handleMedia(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const email = await whoIsAsking(request, env, ctx);
  if (isRefusal(email)) return new Response(email.message, { status: email.status, headers: { "cache-control": "no-store" } });
  return serveMedia(request, env);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/q/")) return handleApi(request, env, ctx);
    if (pathname.startsWith("/api/auth/")) return handleAuth(request, env);
    if (pathname.startsWith("/media/")) return handleMedia(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
