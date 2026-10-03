/**
 * The Worker's own sign-in (auth.ts) and the door in front of the queries and
 * the media (who.ts), against a real local D1 with every migration applied.
 *
 * Google cannot be asked from a test, so the sign-in is driven from the inside
 * — Better Auth's own adapter makes the user and the session, exactly what the
 * Google callback makes — and the cookie is signed as Better Auth signs it.
 * What is proven is everything after Google: who gets an account and a
 * session, what is kept about them, which credential speaks for whom, and that
 * the schema is the one Better Auth wants.
 */
import { getMigrations } from "better-auth/db/migration";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { forgetKeys } from "../access";
import { AUTH_TABLES, authFor, authOptions, type AuthEnv } from "../auth";
import { isRefusal } from "../identity";
import { whoIsAsking, type Caller, type WhoEnv } from "../who";
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

  function auth() {
    const a = authFor(env);
    if (!a) throw new Error("the sign-in should be configured");
    return a;
  }
  const context = () => auth().$context;

  async function rows(table: string, email?: string): Promise<number> {
    const sql = email ? `select count(*) as n from "${table}" where "email" = ?` : `select count(*) as n from "${table}"`;
    const stmt = email ? bank.db.prepare(sql).bind(email) : bank.db.prepare(sql);
    return (await stmt.first<{ n: number }>())?.n ?? -1;
  }

  /** A signed-in device for `email`: a user, a session, its cookie. */
  async function signIn(email: string): Promise<{ cookie: string; token: string; userId: string }> {
    const ctx = await context();
    const user = await ctx.internalAdapter.createUser({ email, name: "Tester", emailVerified: true });
    const session = await ctx.internalAdapter.createSession(user.id);
    return { cookie: await sessionCookie(session.token, SECRET), token: session.token, userId: user.id };
  }

  const ask = (headers: Record<string, string>, e: WhoEnv = env) =>
    whoIsAsking(new Request(`${BASE}/api/q/whoami`, { method: "POST", headers }), e, undefined, NOW, keysOf(ours));
  const emailOf = (who: Caller | { code: string }) => ("email" in who ? who.email : who);
  /** The code a hook's refusal carries, as the Google callback reads it. */
  const codeOf = (e: unknown) => (e as { body?: { code?: string } }).body?.code;

  it("has exactly the tables Better Auth would make", async () => {
    // The migration was compiled from these options; an upgrade that wants a
    // different shape fails here and gets a migration of its own.
    const m = await getMigrations(authOptions(env));
    expect(m.toBeCreated.map((t) => t.table)).toEqual([]);
    expect(m.toBeAdded.map((t) => t.table)).toEqual([]);
  });

  it("makes an account for a listed address Google has verified, and keeps no photo", async () => {
    const ctx = await context();
    const user = await ctx.internalAdapter.createUser({ email: tester.toUpperCase(), name: "T", emailVerified: true, image: "https://photo.example/me.jpg" });
    expect(user.email).toBe(tester);
    expect(await rows(AUTH_TABLES.user, tester)).toBe(1);
    const row = await bank.db.prepare(`select "image" from "${AUTH_TABLES.user}" where "email" = ?`).bind(tester).first<{ image: string | null }>();
    expect(row?.image).toBeNull();
  });

  it("refuses an address the tester list does not name, with the code the app reads, and writes nothing", async () => {
    const ctx = await context();
    const before = await rows(AUTH_TABLES.user);
    const refused = await ctx.internalAdapter.createUser({ email: stranger, name: "S", emailVerified: true }).catch((e: unknown) => e);
    expect(codeOf(refused)).toBe("not_on_tester_list");
    expect(await rows(AUTH_TABLES.user)).toBe(before);
    expect(await rows(AUTH_TABLES.user, stranger)).toBe(0);
    const learners = await bank.db.prepare("select count(*) as n from users where email = ?").bind(stranger).first<{ n: number }>();
    expect(learners?.n).toBe(0);
  });

  it("refuses an address Google has not verified, even a listed one", async () => {
    const ctx = await context();
    const listedButUnverified = address("signin-unverified");
    await addTester(bank.db, listedButUnverified);
    const refused = await ctx.internalAdapter.createUser({ email: listedButUnverified, name: "U", emailVerified: false }).catch((e: unknown) => e);
    expect(codeOf(refused)).toBe("email_not_verified");
    expect(await rows(AUTH_TABLES.user, listedButUnverified)).toBe(0);
  });

  it("gives no new session to an account whose address has left the list", async () => {
    const leaving = address("signin-leaving");
    await addTester(bank.db, leaving);
    const { userId } = await signIn(leaving);
    await bank.db.prepare("delete from testers where email = ?").bind(leaving).run();
    const before = await bank.db.prepare(`select count(*) as n from "${AUTH_TABLES.session}" where "userId" = ?`).bind(userId).first<{ n: number }>();
    const refused = await (await context()).internalAdapter.createSession(userId).catch((e: unknown) => e);
    expect(codeOf(refused)).toBe("not_on_tester_list");
    const after = await bank.db.prepare(`select count(*) as n from "${AUTH_TABLES.session}" where "userId" = ?`).bind(userId).first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("keeps none of Google's tokens, and no address or browser with a session", async () => {
    const ctx = await context();
    const listed = address("signin-kept");
    await addTester(bank.db, listed);
    const user = await ctx.internalAdapter.createUser({ email: listed, name: "K", emailVerified: true });
    await ctx.internalAdapter.createAccount({
      userId: user.id,
      providerId: "google",
      accountId: "google-sub-1",
      accessToken: "ya29.access",
      refreshToken: "1//refresh",
      idToken: "eyJ.id.token",
      scope: "openid email profile",
    });
    const account = await bank.db
      .prepare(`select "accessToken", "refreshToken", "idToken", "scope" from "${AUTH_TABLES.account}" where "userId" = ?`)
      .bind(user.id)
      .first();
    expect(account).toEqual({ accessToken: null, refreshToken: null, idToken: null, scope: null });

    const session = await ctx.internalAdapter.createSession(user.id, false, { ipAddress: "203.0.113.9", userAgent: "Mozilla/5.0" });
    const row = await bank.db
      .prepare(`select "ipAddress", "userAgent" from "${AUTH_TABLES.session}" where "token" = ?`)
      .bind(session.token)
      .first();
    expect(row).toEqual({ ipAddress: null, userAgent: null });
  });

  it("answers on the routes the app uses, and on no other", async () => {
    expect((await auth().handler(new Request(`${BASE}/api/auth/ok`))).status).toBe(200);
    for (const route of ["get-session", "list-sessions", "list-accounts", "get-access-token"]) {
      expect((await auth().handler(new Request(`${BASE}/api/auth/${route}`))).status, route).toBe(404);
    }
    const update = new Request(`${BASE}/api/auth/update-user`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await auth().handler(update)).status).toBe(404);
  });

  it("knows a signed-in device by its session, whatever Access says", async () => {
    const { cookie } = await signIn(otherTester);
    expect(emailOf(await ask({ cookie }))).toBe(otherTester);
    // During the switch both can arrive; the session is the one asked first.
    const access = await accessTokenFor(ours, tester, NOW);
    expect(emailOf(await ask({ cookie, "cf-access-jwt-assertion": access }))).toBe(otherTester);
  });

  it("hands on the cookies that keep a session alive", async () => {
    const listed = address("signin-renewed");
    await addTester(bank.db, listed);
    const { cookie } = await signIn(listed);
    // The first look at a session signs the five-minute cache cookie.
    const who = await ask({ cookie });
    expect(isRefusal(who)).toBe(false);
    expect((who as Caller).cookies.some((c) => c.startsWith("__Secure-better-auth.session_data="))).toBe(true);
  });

  it("knows a phone by the signed token it sends as a bearer, and not by the bare token", async () => {
    const listed = address("signin-phone");
    await addTester(bank.db, listed);
    const { cookie, token } = await signIn(listed);
    const signed = cookie.slice(cookie.indexOf("=") + 1);
    expect(emailOf(await ask({ authorization: `Bearer ${signed}` }))).toBe(listed);
    expect(await ask({ authorization: `Bearer ${token}` })).toMatchObject({ code: "signed_out" });
  });

  it("goes on taking the token Access signed while Access is still in front", async () => {
    const access = await accessTokenFor(ours, tester, NOW);
    expect(emailOf(await ask({ "cf-access-jwt-assertion": access }))).toBe(tester);
    expect(emailOf(await ask({ cookie: `CF_Authorization=${access}` }))).toBe(tester);
  });

  it("calls a token Access no longer vouches for signed out, so the app offers Google", async () => {
    const theirs = await keyPair("theirs");
    const stale = await accessTokenFor(theirs, tester, NOW);
    expect(await ask({ "cf-access-jwt-assertion": stale })).toMatchObject({ code: "signed_out", status: 401 });
  });

  it("calls nobody signed in signed_out, and a forged cookie nobody", async () => {
    expect(await ask({})).toMatchObject({ code: "signed_out", status: 401 });
    const listed = address("signin-forged");
    await addTester(bank.db, listed);
    const { cookie } = await signIn(listed);
    expect(emailOf(await ask({ cookie }))).toBe(listed);
    // The same token with a signature the secret did not make.
    const forged = `${cookie.slice(0, cookie.lastIndexOf("."))}.${encodeURIComponent("AAAA")}`;
    expect(await ask({ cookie: forged })).toMatchObject({ code: "signed_out" });
  });

  it("before its secrets are set, is not there at all, and Access alone decides", async () => {
    const bare: WhoEnv = { DB: bank.db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
    expect(authFor(bare)).toBeNull();
    const access = await accessTokenFor(ours, tester, NOW);
    expect(emailOf(await ask({ "cf-access-jwt-assertion": access }, bare))).toBe(tester);
    expect(await ask({}, bare)).toMatchObject({ code: "signed_out" });
  });
});
