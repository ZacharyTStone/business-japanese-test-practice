/**
 * The app's one Worker: the web build, the API and the media, on one origin.
 *
 *   /api/q/<name>   a query from worker/queries.ts, as the signed-in learner
 *   /media/...      a clip or a picture from R2 (worker/media.ts)
 *   anything else   the static web build, served by the assets binding
 *
 * `run_worker_first` in wrangler.jsonc sends only /api/* and /media/* here;
 * every other request is served from the assets without running this code.
 * Cloudflare Access sits in front of all of it, so nothing on this origin is
 * reachable without signing in — the testers-only door, at the edge, with the
 * database's own `is_tester()` still behind it.
 *
 * Same origin, so there is no CORS to configure and the Access cookie rides
 * along with every request the app makes.
 */
import postgres from "postgres";

import { asCaller, toApiError } from "./db";
import { claimsFor, isRefusal, parseUserMap, resolveCaller } from "./identity";
import { serveMedia } from "./media";
import { queries } from "./queries";

export interface Env {
  ASSETS: Fetcher;
  HYPERDRIVE: Hyperdrive;
  MEDIA: R2Bucket;
  /** `{"you@example.com": "<auth.users id>"}` — a secret. See identity.ts. */
  ACCESS_USERS?: string;
  /** The Supabase project URL, for media R2 does not have yet. Optional. */
  SUPABASE_URL?: string;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const name = new URL(request.url).pathname.replace(/^\/api\/q\//, "");
  if (request.method !== "POST") return json({ error: { code: "method_not_allowed", message: "POST only" } }, 405);
  if (!Object.prototype.hasOwnProperty.call(queries, name)) {
    return json({ error: { code: "unknown_query", message: `no query named ${name}` } }, 404);
  }

  const identity = ctx.access ? await ctx.access.getIdentity() : undefined;
  const caller = resolveCaller(Boolean(ctx.access), identity?.email, parseUserMap(env.ACCESS_USERS));
  if (isRefusal(caller)) {
    const error = { code: caller.code, message: caller.message, details: caller.email ?? null, hint: null };
    return json({ error }, caller.status);
  }

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

  // A client per request, as Hyperdrive asks: it pools the real connections,
  // and a client held across requests would outlive the request it came from.
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  try {
    const data = await asCaller(sql, claimsFor(caller), (tx) => queries[name](tx, args));
    return json({ data: data ?? null });
  } catch (e) {
    const { status, error } = toApiError(e);
    return json({ error }, status);
  } finally {
    ctx.waitUntil(sql.end());
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/q/")) return handleApi(request, env, ctx);
    if (pathname.startsWith("/media/")) return serveMedia(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
