/**
 * Sign-in, on the Worker itself: Better Auth, on the same D1, with Google.
 *
 * Cloudflare Access was the sign-in until 2026-10-03 (blockers.md #4): a gate
 * for known people in a browser, with no native path and nothing that keeps a
 * session alive. This replaces it with an ordinary account sign-in that the
 * web and the phone share — on the web a session cookie on this origin, on a
 * phone the same signed session token sent as `Authorization: Bearer` (the
 * bearer plugin) — and that renews itself while it is used.
 *
 * What does not change is the door. A sign-in is not an account: an address
 * the tester list does not name, or one Google has not verified, is refused
 * here before Better Auth writes a row about it, with a code the app can say
 * (`not_on_tester_list`, `email_not_verified`); an account already made whose
 * address has since left the list gets no new session either; and every query
 * still meets the list in core/caller.ts. The learner's account is the
 * existing `users` row, found by the verified address, so nobody's history
 * moves when they first sign in this way. Better Auth's own tables are named
 * `auth_*` and hold sign-in state only — no Google tokens, no addresses or
 * user agents, no photo: an identity-only sign-in reads none of them back.
 *
 * Google is the only way in for now (2026-10-03): one tap on Android, one
 * button on the web, no password and no emailed code.
 *
 * Unconfigured — any of the four settings below missing — this is null, and
 * the Worker goes on accepting only what Access signs, exactly as before. So
 * the code can ship before the secrets exist, and Access can come off after.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { bearer } from "better-auth/plugins";

export type AuthEnv = {
  DB: D1Database;
  /** All four are Worker secrets (`wrangler secret put`), never `vars`: a
   *  deploy keeps secrets and replaces vars with wrangler.jsonc's. */
  /** The Worker's own address, e.g. https://<host>. */
  BETTER_AUTH_URL?: string;
  /** Signs the session cookie and token: `openssl rand -base64 32`. */
  BETTER_AUTH_SECRET?: string;
  /** The Google Cloud "Web application" OAuth client. A phone's ID token is
   *  issued for this client too (Credential Manager's serverClientId). */
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
 *  learner who practises at least once a month never signs in again. The
 *  renewed cookie reaches the browser on the next query (who.ts). */
export const SESSION_DAYS = 30;
const DAY = 60 * 60 * 24;

/** The only routes the app uses. Every other Better Auth route (passwords,
 *  account linking, listing sessions, updating the user…) answers 404, so a
 *  session — even one whose address has left the tester list — opens nothing
 *  but these. Server-side calls (`auth.api.getSession` in who.ts) are not
 *  routes and are unaffected. */
export const OPEN_ROUTES = ["/sign-in/social", "/callback/:id", "/sign-out", "/ok", "/error"] as const;
const CLOSED_ROUTES = [
  "/account-info", "/change-email", "/change-password", "/delete-user", "/delete-user/callback",
  "/get-access-token", "/get-session", "/link-social", "/list-accounts", "/list-sessions", "/refresh-token",
  "/request-password-reset", "/reset-password", "/reset-password/:token", "/revoke-other-sessions",
  "/revoke-session", "/revoke-sessions", "/send-verification-email", "/sign-in/email", "/sign-up/email",
  "/unlink-account", "/update-session", "/update-user", "/verify-email", "/verify-password",
];

/** Why an address may not have an account or a session, or null if it may.
 *  The same list core/caller.ts reads for every query. */
export async function refusalFor(
  db: D1Database,
  email: unknown,
  emailVerified: unknown
): Promise<"email_not_verified" | "not_on_tester_list" | null> {
  const address = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!address) return "not_on_tester_list";
  if (emailVerified !== true) return "email_not_verified";
  const listed = await db.prepare("select 1 as listed from testers where email = ?").bind(address).first();
  return listed === null ? "not_on_tester_list" : null;
}

/** Thrown from a hook, a code reaches the app: the Google callback sends the
 *  browser back with `?error=<code>` (lib/signin.ts reads it), and a phone's
 *  sign-in gets it as the JSON error's code. */
function refuse(code: "email_not_verified" | "not_on_tester_list"): never {
  throw new APIError("FORBIDDEN", { code, message: code === "not_on_tester_list" ? "Not on the tester list" : "Email not verified" });
}

/** Nothing of Google's tokens is kept: the sign-in is identity only. */
const NO_TOKENS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  scope: null,
};

/** The options, apart from the instance: a test builds them with its own
 *  database and secret. */
export function authOptions(env: Required<AuthEnv>): BetterAuthOptions {
  const db = env.DB;
  return {
    appName: "Business Japanese drill",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Better Auth recognises a D1 binding and uses its own D1 driver.
    database: db,
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
      // clips and pictures does not read the database once each. who.ts
      // passes the refreshed cookie on.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    account: {
      modelName: AUTH_TABLES.account,
      // The few minutes between leaving for Google and coming back live in an
      // encrypted cookie, not a row: a stranger pressing the button over and
      // over writes nothing.
      storeStateStrategy: "cookie",
    },
    verification: { modelName: AUTH_TABLES.verification },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const why = await refusalFor(db, user.email, user.emailVerified);
            if (why) refuse(why);
            return { data: { ...user, image: null } };
          },
        },
        update: { before: async (user) => ({ data: { ...user, image: null } }) },
      },
      account: {
        create: { before: async (account) => ({ data: { ...account, ...NO_TOKENS } }) },
        update: { before: async (account) => ({ data: { ...account, ...NO_TOKENS } }) },
      },
      session: {
        create: {
          // An account made while its address was listed gets no new session
          // once it is not; and a session keeps no address or browser.
          before: async (session) => {
            const row = await db
              .prepare('select "email", "emailVerified" from "auth_users" where "id" = ?')
              .bind(session.userId)
              .first<{ email: string; emailVerified: number }>();
            const why = await refusalFor(db, row?.email, row?.emailVerified === 1);
            if (why) refuse(why);
            return { data: { ...session, ipAddress: null, userAgent: null } };
          },
        },
      },
    },
    // On by default only where NODE_ENV says production, which a Worker
    // without Node compatibility never does: so, always. In memory, per
    // isolate, so it writes nothing; Cloudflare's address header is the key.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: { "/sign-in/social": { window: 60, max: 10 } },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      // The schema is held by a database test (auth.db.test.ts), not checked
      // at run time: a check that failed once, in the minutes between a
      // deploy and its migration, would stay failed for the life of the
      // isolate.
      database: { validateSchema: false },
    },
    disabledPaths: CLOSED_ROUTES,
    // A phone sends the signed session token as `Authorization: Bearer`; an
    // unsigned token is refused.
    plugins: [bearer({ requireSignature: true })],
    telemetry: { enabled: false },
  };
}

type Auth = ReturnType<typeof betterAuth>;
let cached: { key: string; db: D1Database; auth: Auth } | null = null;

/** The sign-in for this Worker, or null while it is not configured. One
 *  instance per isolate and settings, not one per request. Every setting is
 *  trimmed: a secret pasted with a newline is the commonest mistake. */
export function authFor(env: AuthEnv): Auth | null {
  const settings = {
    BETTER_AUTH_URL: env.BETTER_AUTH_URL?.trim() ?? "",
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET?.trim() ?? "",
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID?.trim() ?? "",
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
  };
  if (Object.values(settings).some((v) => !v)) return null;
  const key = Object.values(settings).join("\n");
  if (cached && cached.key === key && cached.db === env.DB) return cached.auth;
  const auth = betterAuth(authOptions({ DB: env.DB, ...settings }));
  cached = { key, db: env.DB, auth };
  return auth;
}
