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
 * reachable without signing in; behind it, the tester list in D1 is the door
 * every query passes (core/caller.ts).
 *
 * Same origin, so there is no CORS to configure and the Access cookie rides
 * along with every request the app makes.
 */
import { accessEmail } from "./access";
import { resolveLearner } from "./core/caller";
import { toApiError } from "./core/errors";
import { isRefusal, notATester, signedInEmail, type Refusal } from "./identity";
import { serveMedia } from "./media";
import { queries } from "./queries";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  /** `<team>.cloudflareaccess.com` and the Access application's AUD tag
   *  (wrangler.jsonc `vars`): whose signature, for which app, a token needs. */
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

  // ctx.access when the runtime hands it over; on a Worker with static assets
  // it never does, and the token Access signed says the same (access.ts).
  const email = ctx.access
    ? signedInEmail(true, (await ctx.access.getIdentity())?.email)
    : await accessEmail(request, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }, Date.now());
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

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/q/")) return handleApi(request, env, ctx);
    if (pathname.startsWith("/media/")) return serveMedia(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
