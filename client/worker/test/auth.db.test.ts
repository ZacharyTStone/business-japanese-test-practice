/**
 * The Worker's own sign-in (auth.ts) and the door in front of the queries and
 * the media (who.ts), against a real local D1 with every migration applied.
 *
 * Google cannot be asked from a test, so the sign-in is driven from the inside
 * — Better Auth's own adapter makes the user and the session, exactly what the
 * Google callback makes — and the cookie is signed as Better Auth signs it.
 * What is proven is everything after Google: who gets an account, which
 * credential speaks for whom, and that the schema is the one Better Auth wants.
 */
import { getMigrations } from "better-auth/db/migration";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { forgetKeys } from "../access";
import { AUTH_TABLES, authFor, authOptions, type AuthEnv } from "../auth";
import { isRefusal } from "../identity";
import { whoIsAsking, type WhoEnv } from "../who";
import { addTester, address, openBank, type Bank } from "./d1";
import { accessTokenFor, AUD, keyPair, keysOf, sessionCookie, TEAM, type Pair } from "./tokens";

const SECRET = "a-test-secret-that-is-long-enough-0123456789";
const BASE = "https://app.example";
const NOW = Date.now();

describe("the Worker's own sign-in", () => {
  let bank: Bank;
  let env: WhoEnv & Required<AuthEnv>;
  let ours: Pair;
  const tester = address("signin");
  const otherTester = address("signin-other");
  const stranger = address("signin-stranger");

  beforeAll(async () => {
    bank = await openBank();
    env = {
      DB: bank.db,
      BETTER_AUTH_URL: BASE,
      BETTER_AUTH_SECRET: SECRET,
      GOOGLE_CLIENT_ID: "web-client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "google-secret",
      ACCESS_TEAM_DOMAIN: TEAM,
      ACCESS_AUD: AUD,
    };
    ours = await keyPair("ours");
    forgetKeys();
    await addTester(bank.db, tester);
    await addTester(bank.db, otherTester);
  });

  afterAll(async () => {
    forgetKeys();
    await bank?.dispose();
  });

  async function context() {
    const auth = authFor(env);
    if (!auth) throw new Error("the sign-in should be configured");
    return auth.$context;
  }

  async function rows(table: string, email?: string): Promise<number> {
    const sql = email ? `select count(*) as n from "${table}" where "email" = ?` : `select count(*) as n from "${table}"`;
    const stmt = email ? bank.db.prepare(sql).bind(email) : bank.db.prepare(sql);
    return (await stmt.first<{ n: number }>())?.n ?? -1;
  }

  /** A signed-in device for `email`: a user, a session, its cookie. */
  async function signIn(email: string): Promise<string> {
    const ctx = await context();
    const user = await ctx.internalAdapter.createUser({ email, name: "Tester", emailVerified: true });
    if (!user) throw new Error(`no account for ${email}`);
    const session = await ctx.internalAdapter.createSession(user.id);
    return sessionCookie(session.token, SECRET);
  }

  const ask = (headers: Record<string, string>, e: WhoEnv = env) =>
    whoIsAsking(new Request(`${BASE}/api/q/whoami`, { method: "POST", headers }), e, undefined, NOW, keysOf(ours));

  it("has exactly the tables Better Auth would make", async () => {
    // The migration was compiled from these options; an upgrade that wants a
    // different shape fails here and gets a migration of its own.
    const m = await getMigrations(authOptions(env));
    expect(m.toBeCreated.map((t) => t.table)).toEqual([]);
    expect(m.toBeAdded.map((t) => t.table)).toEqual([]);
  });

  it("makes an account for a listed address Google has verified", async () => {
    const ctx = await context();
    const user = await ctx.internalAdapter.createUser({ email: tester.toUpperCase(), name: "T", emailVerified: true });
    expect(user?.email).toBe(tester);
    expect(await rows(AUTH_TABLES.user, tester)).toBe(1);
  });

  it("makes nothing for an address the tester list does not name", async () => {
    const ctx = await context();
    const before = await rows(AUTH_TABLES.user);
    expect(await ctx.internalAdapter.createUser({ email: stranger, name: "S", emailVerified: true })).toBeNull();
    expect(await rows(AUTH_TABLES.user)).toBe(before);
    expect(await rows(AUTH_TABLES.user, stranger)).toBe(0);
    const learners = await bank.db.prepare("select count(*) as n from users where email = ?").bind(stranger).first<{ n: number }>();
    expect(learners?.n).toBe(0);
  });

  it("makes nothing for an address Google has not verified, listed or not", async () => {
    const ctx = await context();
    const listedButUnverified = address("signin-unverified");
    await addTester(bank.db, listedButUnverified);
    expect(await ctx.internalAdapter.createUser({ email: listedButUnverified, name: "U", emailVerified: false })).toBeNull();
    expect(await rows(AUTH_TABLES.user, listedButUnverified)).toBe(0);
  });

  it("answers on its own routes", async () => {
    const auth = authFor(env);
    const res = await auth!.handler(new Request(`${BASE}/api/auth/ok`));
    expect(res.status).toBe(200);
  });

  it("knows a signed-in device by its session, whatever Access says", async () => {
    const cookie = await signIn(otherTester);
    expect(await ask({ cookie })).toBe(otherTester);
    // During the switch both can arrive; the session is the one asked first.
    const access = await accessTokenFor(ours, tester, NOW);
    expect(await ask({ cookie, "cf-access-jwt-assertion": access })).toBe(otherTester);
  });

  it("goes on taking the token Access signed while Access is still in front", async () => {
    const access = await accessTokenFor(ours, tester, NOW);
    expect(await ask({ "cf-access-jwt-assertion": access })).toBe(tester);
    expect(await ask({ cookie: `CF_Authorization=${access}` })).toBe(tester);
  });

  it("calls nobody signed in signed_out, and a forged cookie nobody", async () => {
    expect(await ask({})).toMatchObject({ code: "signed_out", status: 401 });
    const listed = address("signin-forged");
    await addTester(bank.db, listed);
    const cookie = await signIn(listed);
    expect(await ask({ cookie })).toBe(listed);
    // The same token with a signature the secret did not make.
    const forged = `${cookie.slice(0, cookie.lastIndexOf("."))}.${encodeURIComponent("AAAA")}`;
    expect(isRefusal(await ask({ cookie: forged }))).toBe(true);
    expect(await ask({ cookie: forged })).toMatchObject({ code: "signed_out" });
  });

  it("before its secrets are set, is not there at all, and Access alone decides", async () => {
    const bare: WhoEnv = { DB: bank.db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
    expect(authFor(bare)).toBeNull();
    const access = await accessTokenFor(ours, tester, NOW);
    expect(await ask({ "cf-access-jwt-assertion": access }, bare)).toBe(tester);
    expect(await ask({}, bare)).toMatchObject({ code: "signed_out" });
  });
});
