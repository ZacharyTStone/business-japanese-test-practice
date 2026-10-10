/**
 * The Worker's own sign-in, the parts that need no database: when it exists
 * at all, the settings it is made with, and who.ts's answer when the sign-in
 * is missing or broken. The sign-in itself, the tester list's hold on it and
 * the schema are test/auth.db.test.ts.
 */
import { describe, expect, it } from "vitest";

import { AUTH_TABLES, authFor, authOptions, OPEN_ROUTES, refusalFor, SESSION_DAYS } from "./auth";
import { whoIsAsking } from "./who";
import { sessionCookie } from "./test/tokens";

// Shaped like a D1 binding, so Better Auth takes it for one (it looks for
// prepare, batch and exec), and refusing every call: a database that is down.
const down = () => {
  throw new Error("no database in this test");
};
const DB = { prepare: down, batch: down, exec: down } as unknown as D1Database;
const SECRET = "a-test-secret-that-is-long-enough-0123456789";
const FULL = {
  DB,
  BETTER_AUTH_URL: "https://app.example",
  BETTER_AUTH_SECRET: SECRET,
  GOOGLE_CLIENT_ID: "web-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-secret",
};

describe("the sign-in's settings", () => {
  it("is not there until every setting is", () => {
    expect(authFor({ DB })).toBeNull();
    for (const missing of ["BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const) {
      expect(authFor({ ...FULL, [missing]: "" }), missing).toBeNull();
      expect(authFor({ ...FULL, [missing]: "   " }), missing).toBeNull();
    }
  });

  it("is made once per isolate, not once per request", () => {
    const first = authFor(FULL);
    expect(first).not.toBeNull();
    expect(authFor({ ...FULL })).toBe(first);
    expect(authFor({ ...FULL, GOOGLE_CLIENT_ID: "another" })).not.toBe(first);
  });

  it("trims every setting, so a secret pasted with a newline still works", () => {
    const auth = authFor({ ...FULL, GOOGLE_CLIENT_ID: " web-client.apps.googleusercontent.com\n", BETTER_AUTH_SECRET: `${SECRET}\n` });
    const google = auth?.options.socialProviders?.google as { clientId?: string } | undefined;
    expect(google?.clientId).toBe("web-client.apps.googleusercontent.com");
    expect(auth?.options.secret).toBe(SECRET);
  });

  it("keeps its tables apart from the learner's, and sends nothing home", () => {
    const o = authOptions(FULL);
    expect(o.user?.modelName).toBe(AUTH_TABLES.user);
    expect(o.session?.modelName).toBe(AUTH_TABLES.session);
    expect(o.account?.modelName).toBe(AUTH_TABLES.account);
    expect(o.verification?.modelName).toBe(AUTH_TABLES.verification);
    for (const name of Object.values(AUTH_TABLES)) expect(name).toMatch(/^auth_/);
    expect(o.telemetry?.enabled).toBe(false);
  });

  it("is Google only, with the account picker, and a session a month long", () => {
    const o = authOptions(FULL);
    expect(Object.keys(o.socialProviders ?? {})).toEqual(["google"]);
    // The options type allows a function here; auth.ts gives the object.
    const google = o.socialProviders?.google as { prompt?: string } | undefined;
    expect(google?.prompt).toBe("select_account");
    expect(o.emailAndPassword?.enabled ?? false).toBe(false);
    expect(o.session?.expiresIn).toBe(SESSION_DAYS * 24 * 60 * 60);
  });

  it("opens only the routes the app uses", () => {
    const closed = authOptions(FULL).disabledPaths ?? [];
    for (const open of OPEN_ROUTES) expect(closed).not.toContain(open);
    for (const route of ["/get-session", "/list-sessions", "/list-accounts", "/get-access-token", "/update-user", "/sign-in/email", "/sign-up/email", "/link-social"]) {
      expect(closed).toContain(route);
    }
  });

  // The list above is written out by hand, so a Better Auth upgrade that adds
  // a route would leave it open. Every endpoint the library builds is read off
  // its api object here: each is one the app uses or one that is closed.
  it("closes every route Better Auth has that the app does not use", () => {
    const auth = authFor(FULL)!;
    const closed: readonly string[] = authOptions(FULL).disabledPaths ?? [];
    const open: readonly string[] = OPEN_ROUTES;
    const paths = Object.values(auth.api)
      .map((endpoint) => (endpoint as { path?: unknown }).path)
      .filter((path): path is string => typeof path === "string");
    expect(paths.length).toBeGreaterThan(open.length);
    for (const route of open) expect(paths, route).toContain(route);
    expect(paths.filter((path) => !open.includes(path) && !closed.includes(path))).toEqual([]);
  });

  it("limits the rate everywhere, and keeps a sign-in's state out of the database", () => {
    const o = authOptions(FULL);
    // On by default only where NODE_ENV says production, which a Worker never does.
    expect(o.rateLimit?.enabled).toBe(true);
    expect(o.rateLimit?.customRules?.["/sign-in/social"]).toMatchObject({ max: 10 });
    expect(o.account?.storeStateStrategy).toBe("cookie");
    expect(o.advanced?.database?.validateSchema).toBe(false);
    expect(o.advanced?.ipAddress?.ipAddressHeaders).toEqual(["cf-connecting-ip"]);
  });

  it("takes a phone's signed token as a bearer, and only a signed one", () => {
    const bearer = authOptions(FULL).plugins?.find((p) => p.id === "bearer") as { options?: { requireSignature?: boolean } } | undefined;
    expect(bearer?.options?.requireSignature).toBe(true);
  });

  it("refuses an address Google has not verified, or none, without asking the list", async () => {
    // DB throws if asked: neither gets that far.
    expect(await refusalFor(DB, "me@example.com", false)).toBe("email_not_verified");
    expect(await refusalFor(DB, "", true)).toBe("not_on_tester_list");
    expect(await refusalFor(DB, undefined, true)).toBe("not_on_tester_list");
  });
});

describe("who is asking, when the sign-in is missing or broken", () => {
  const ask = (env: Parameters<typeof whoIsAsking>[1], headers: Record<string, string> = {}) =>
    whoIsAsking(new Request("https://app.example/api/q/whoami", { method: "POST", headers }), env);

  it("says it is not set up, rather than signed out, when its secrets are missing", async () => {
    expect(await ask({ DB })).toMatchObject({ status: 500, code: "sign_in_not_configured" });
  });

  it("says it could not check, rather than signed out, when its database is down", async () => {
    const cookie = await sessionCookie("a-session-token-of-some-length-000000", SECRET);
    expect(await ask(FULL, { cookie })).toMatchObject({ status: 503, code: "sign_in_unavailable" });
  });

  it("takes nothing Cloudflare Access would have sent as anybody", async () => {
    // Access's header and cookie, and the address header it adds: all nobody.
    // No session cookie, so the database (which throws) is never asked.
    const headers = {
      "cf-access-jwt-assertion": "a.b.c",
      "cf-access-authenticated-user-email": "me@example.com",
      cookie: "CF_Authorization=a.b.c",
    };
    expect(await ask(FULL, headers)).toMatchObject({ status: 401, code: "signed_out" });
  });
});
