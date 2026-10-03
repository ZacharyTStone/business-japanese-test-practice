/**
 * The Worker's own sign-in, the parts that need no database: when it exists
 * at all, the settings it is made with, and who.ts's answer when the sign-in
 * is missing or broken. The sign-in itself, the tester list's hold on it and
 * the schema are test/auth.db.test.ts.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { forgetKeys } from "./access";
import { AUTH_TABLES, authFor, authOptions, OPEN_ROUTES, refusalFor, SESSION_DAYS } from "./auth";
import { whoIsAsking } from "./who";
import { accessTokenFor, AUD, keyPair, keysOf, sessionCookie, TEAM, type Pair } from "./test/tokens";

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
const NOW = Date.now();

describe("the sign-in's settings", () => {
  it("is not there until every setting is, so Access alone decides until then", () => {
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
  let ours: Pair;
  beforeAll(async () => {
    ours = await keyPair("ours");
  });
  beforeEach(() => forgetKeys());

  const ACCESS = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const ask = (env: Parameters<typeof whoIsAsking>[1], headers: Record<string, string> = {}) =>
    whoIsAsking(new Request("https://app.example/api/q/whoami", { method: "POST", headers }), env, undefined, NOW, keysOf(ours));

  it("says it is not set up, rather than signed out, when neither is configured", async () => {
    expect(await ask({ DB })).toMatchObject({ status: 500, code: "sign_in_not_configured" });
  });

  it("falls back to Access when the sign-in cannot answer", async () => {
    const cookie = await sessionCookie("a-session-token-of-some-length-000000", SECRET);
    const access = await accessTokenFor(ours, "me@example.com", NOW);
    expect(await ask({ ...FULL, ...ACCESS }, { cookie, "cf-access-jwt-assertion": access })).toEqual({ email: "me@example.com", cookies: [], viaSession: false });
    expect(await ask({ ...FULL, ...ACCESS }, { cookie })).toMatchObject({ status: 503, code: "sign_in_unavailable" });
  });

  it("without a sign-in of its own, lets Access's answer stand as before", async () => {
    const theirs = await keyPair("theirs");
    const forged = await accessTokenFor(theirs, "me@example.com", NOW);
    expect(await ask({ DB, ...ACCESS }, { "cf-access-jwt-assertion": forged })).toMatchObject({ code: "access_invalid" });
    expect(await ask({ DB, ...ACCESS })).toMatchObject({ code: "signed_out" });
  });
});
