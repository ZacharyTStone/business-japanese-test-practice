/**
 * The Worker's own sign-in, the parts that need no database: when it exists
 * at all, and the settings it is made with. The sign-in itself, the tester
 * list's hold on it and the schema are test/auth.db.test.ts.
 */
import { describe, expect, it } from "vitest";

import { AUTH_TABLES, authFor, authOptions, mayCreateAccount, SESSION_DAYS } from "./auth";

// Shaped like a D1 binding, so Better Auth takes it for one (it looks for
// prepare, batch and exec), and refusing every call: nothing here may need it.
const nothing = () => {
  throw new Error("no database in this test");
};
const DB = { prepare: nothing, batch: nothing, exec: nothing } as unknown as D1Database;
const FULL = {
  DB,
  BETTER_AUTH_URL: "https://app.example",
  BETTER_AUTH_SECRET: "a-test-secret-that-is-long-enough-0123456789",
  GOOGLE_CLIENT_ID: "web-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-secret",
};

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

  it("refuses an address Google has not verified without asking the list", async () => {
    // DB throws if asked: an unverified or empty address never gets that far.
    expect(await mayCreateAccount(DB, "me@example.com", false)).toBe(false);
    expect(await mayCreateAccount(DB, "", true)).toBe(false);
    expect(await mayCreateAccount(DB, undefined, true)).toBe(false);
  });
});
