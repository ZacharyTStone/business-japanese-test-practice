/**
 * Sign-in, on the Worker itself: Better Auth, on the same D1, with Google.
 *
 * Cloudflare Access was the sign-in until 2026-10-03 (blockers.md #4): a gate
 * for known people in a browser, with no native path and nothing that keeps a
 * session alive. This replaces it with an ordinary account sign-in that the
 * web and the phone share — on the web a session cookie on this origin, on a
 * phone the same session kept in secure storage — and that refreshes itself.
 *
 * What does not change is the door. A sign-in is not an account: an address
 * the tester list does not name is refused here, before Better Auth writes a
 * row about it (`databaseHooks.user.create.before` returning false makes the
 * callback send the browser back with `error=unable_to_create_user` and
 * stores nothing), and every query still meets the list again in
 * core/caller.ts. The learner's account is the existing `users` row, found by
 * the verified address, so nobody's history moves when they first sign in this
 * way. Better Auth's own tables are named `auth_*` and hold sign-in state only.
 *
 * Google is the only way in for now (2026-10-03): one tap on Android, one
 * button on the web, no password and no emailed code. Only an address Google
 * has verified is let through.
 *
 * Unconfigured — any of the four settings below missing — this is null, and
 * the Worker goes on accepting only what Access signs, exactly as before. So
 * the code can ship before the secrets exist, and Access can come off after.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth";

export type AuthEnv = {
  DB: D1Database;
  /** The Worker's own address, e.g. https://<host>. A plain var. */
  BETTER_AUTH_URL?: string;
  /** Signs the session cookie. A secret: `wrangler secret put`. */
  BETTER_AUTH_SECRET?: string;
  /** The Google Cloud "Web application" OAuth client. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

/** Better Auth's tables, kept apart from the learner's by name. */
export const AUTH_TABLES = {
  user: "auth_users",
  session: "auth_sessions",
  account: "auth_accounts",
  verification: "auth_verifications",
} as const;

/** How long a session lasts without use, and how often use renews it: a
 *  learner who practises at least once a month never signs in again. */
export const SESSION_DAYS = 30;
const DAY = 60 * 60 * 24;

/** Whether an address may become an account: Google vouches for it, and the
 *  tester list names it. The same list core/caller.ts reads for every query. */
export async function mayCreateAccount(db: D1Database, email: unknown, emailVerified: unknown): Promise<boolean> {
  const address = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!address || emailVerified !== true) return false;
  const listed = await db.prepare("select 1 as listed from testers where email = ?").bind(address).first();
  return listed !== null;
}

/** The options, apart from the instance: a test builds them with its own
 *  database and secret. */
export function authOptions(env: Required<AuthEnv>): BetterAuthOptions {
  return {
    appName: "Business Japanese drill",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Better Auth recognises a D1 binding and uses its own D1 driver.
    database: env.DB,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // Always offer the account picker: one Google account on a shared
        // computer should not silently become the learner.
        prompt: "select_account",
      },
    },
    user: { modelName: AUTH_TABLES.user },
    session: {
      modelName: AUTH_TABLES.session,
      expiresIn: SESSION_DAYS * DAY,
      updateAge: DAY,
      // A signed cookie vouches for the session for five minutes, so a page of
      // clips and pictures does not read the database once each.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    account: { modelName: AUTH_TABLES.account },
    verification: { modelName: AUTH_TABLES.verification },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ((await mayCreateAccount(env.DB, user.email, user.emailVerified)) ? undefined : false),
        },
      },
    },
    telemetry: { enabled: false },
  };
}

type Auth = ReturnType<typeof betterAuth>;
let cached: { key: string; db: D1Database; auth: Auth } | null = null;

/** The sign-in for this Worker, or null while it is not configured. One
 *  instance per isolate and settings, not one per request. */
export function authFor(env: AuthEnv): Auth | null {
  const { DB, BETTER_AUTH_URL, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env;
  if (!BETTER_AUTH_URL?.trim() || !BETTER_AUTH_SECRET?.trim() || !GOOGLE_CLIENT_ID?.trim() || !GOOGLE_CLIENT_SECRET?.trim()) {
    return null;
  }
  const key = [BETTER_AUTH_URL, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET].join("\n");
  if (cached && cached.key === key && cached.db === DB) return cached.auth;
  const auth = betterAuth(
    authOptions({ DB, BETTER_AUTH_URL: BETTER_AUTH_URL.trim(), BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET })
  );
  cached = { key, db: DB, auth };
  return auth;
}
