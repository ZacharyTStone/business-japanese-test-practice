/**
 * The Worker's own sign-in (auth.ts) and the door in front of the queries and
 * the media (who.ts), against a real local D1 with every migration applied.
 *
 * Google cannot be asked from a test, so the sign-in is driven from the inside
 * — Better Auth's own adapter makes the user and the session, exactly what the
 * Google callback makes — and the cookie is signed as Better Auth signs it.
 * What is proven is everything after Google: who gets an account and a
 * session, what is kept about them, which credential speaks for whom, and that
 * the schema is the one Better Auth wants. A phone's sign-in is driven from
 * the outside, through the route the app posts to, with an ID token signed by
 * a key the test serves as Google's: Better Auth's own check of the
 * signature, issuer, audience and nonce runs as it does for real.
 */
import { getMigrations } from "better-auth/db/migration";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AUTH_TABLES, authFor, authOptions, type AuthEnv } from "../auth";
import { isRefusal } from "../identity";
import { runQuery } from "../index";
import { whoIsAsking, type Caller } from "../who";
import { addTester, address, openBank, type Bank } from "./d1";
import { googleIdTokenFor, keyPair, sessionCookie, type Pair } from "./tokens";

const SECRET = "a-test-secret-that-is-long-enough-0123456789";
const BASE = "https://app.example";
const WEB_CLIENT = "web-client.apps.googleusercontent.com";
const GOOGLE_KEYS = "https://www.googleapis.com/oauth2/v3/certs";
const NOW = Date.now();

describe("the Worker's own sign-in", () => {
  let bank: Bank;
  let env: Required<AuthEnv>;
  const tester = address("signin");
  const otherTester = address("signin-other");
  const stranger = address("signin-stranger");

  beforeAll(async () => {
    bank = await openBank();
    env = {
      DB: bank.db,
      BETTER_AUTH_URL: BASE,
      BETTER_AUTH_SECRET: SECRET,
      GOOGLE_CLIENT_ID: WEB_CLIENT,
      GOOGLE_CLIENT_SECRET: "google-secret",
    };
    await addTester(bank.db, tester);
    await addTester(bank.db, otherTester);
  });

  afterAll(async () => {
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

  const sessionsOf = async (userId: string | undefined) =>
    (await bank.db.prepare(`select count(*) as n from "${AUTH_TABLES.session}" where "userId" = ?`).bind(userId).first<{ n: number }>())?.n;

  /** A signed-in device for `email`: a user, a session, its cookie. */
  async function signIn(email: string): Promise<{ cookie: string; token: string; userId: string }> {
    const ctx = await context();
    const user = await ctx.internalAdapter.createUser({ email, name: "Tester", emailVerified: true });
    const session = await ctx.internalAdapter.createSession(user.id);
    return { cookie: await sessionCookie(session.token, SECRET), token: session.token, userId: user.id };
  }

  const ask = (headers: Record<string, string>, e: AuthEnv = env) =>
    whoIsAsking(new Request(`${BASE}/api/q/whoami`, { method: "POST", headers }), e);
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

  it("makes an account for a listed address Google has verified, and keeps no name or photo", async () => {
    const ctx = await context();
    const user = await ctx.internalAdapter.createUser({ email: tester.toUpperCase(), name: "Taro Tester", emailVerified: true, image: "https://photo.example/me.jpg" });
    expect(user.email).toBe(tester);
    expect(await rows(AUTH_TABLES.user, tester)).toBe(1);
    const row = await bank.db.prepare(`select "name", "image" from "${AUTH_TABLES.user}" where "email" = ?`).bind(tester).first();
    expect(row).toEqual({ name: "", image: null });
    // Nor when Better Auth would update it from a later sign-in.
    await ctx.internalAdapter.updateUser(user.id, { name: "Taro", image: "https://photo.example/new.jpg" });
    const later = await bank.db.prepare(`select "name", "image" from "${AUTH_TABLES.user}" where "email" = ?`).bind(tester).first();
    expect(later).toEqual({ name: "", image: null });
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
    const before = await sessionsOf(userId);
    const refused = await (await context()).internalAdapter.createSession(userId).catch((e: unknown) => e);
    expect(codeOf(refused)).toBe("not_on_tester_list");
    expect(await sessionsOf(userId)).toBe(before);
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

  it("knows a signed-in device by its session, and by nothing Access would have sent", async () => {
    const { cookie } = await signIn(otherTester);
    expect(emailOf(await ask({ cookie }))).toBe(otherTester);
    // Access is gone (2026-10-04): its header and cookie name nobody, beside
    // a session or alone.
    const access = { "cf-access-jwt-assertion": "a.b.c", "cf-access-authenticated-user-email": tester };
    expect(emailOf(await ask({ cookie, ...access }))).toBe(otherTester);
    expect(await ask(access)).toMatchObject({ code: "signed_out", status: 401 });
    expect(await ask({ cookie: "CF_Authorization=a.b.c" })).toMatchObject({ code: "signed_out", status: 401 });
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

  it("before its secrets are set, is not there at all, and says so", async () => {
    const bare: AuthEnv = { DB: bank.db };
    expect(authFor(bare)).toBeNull();
    expect(await ask({}, bare)).toMatchObject({ code: "sign_in_not_configured", status: 500 });
  });

  it("deletes the sign-in with the account, and a second device's cached session cannot make it again", async () => {
    const leaving = address("signin-leaving-for-good");
    await addTester(bank.db, leaving);
    const { cookie } = await signIn(leaving);
    // The second device has also been vouched for by the five-minute cookie.
    const first = (await ask({ cookie })) as Caller;
    const cached = first.cookies.map((c) => c.slice(0, c.indexOf(";"))).find((c) => c.includes("session_data="));
    expect(cached).toBeTruthy();
    const query = async (name: string, args: Record<string, unknown> = {}) => {
      const res = await runQuery(bank.db, leaving, name, args);
      return { status: res.status, body: (await res.json()) as { data?: unknown; error?: { code: string } } };
    };
    expect((await query("whoami")).status).toBe(200);

    const userId = (await bank.db.prepare(`select "id" from "${AUTH_TABLES.user}" where "email" = ?`).bind(leaving).first<{ id: string }>())?.id;
    expect((await query("deleteAccount", { email: leaving })).body.data).toMatchObject({ deleted: true });
    expect(await rows(AUTH_TABLES.user, leaving)).toBe(0);
    expect(await sessionsOf(userId)).toBe(0);

    // Without the cache the session is gone at once.
    expect(await ask({ cookie })).toMatchObject({ code: "signed_out" });
    // With it, the Worker still hears the address for a few minutes; it gets
    // no account back, only the door.
    const ghost = await ask({ cookie: `${cookie}; ${cached}` });
    expect(emailOf(ghost)).toBe(leaving);
    expect((await query("whoami")).body.error).toMatchObject({ code: "not_a_tester" });
    expect(await rows("users", leaving)).toBe(0);
  });

  describe("a phone's sign-in", () => {
    let google: Pair;
    beforeAll(async () => {
      google = await keyPair("google");
      // Google's keys, served from the test: everything else goes out as usual.
      const real = globalThis.fetch;
      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return url === GOOGLE_KEYS ? Promise.resolve(Response.json({ keys: [google.jwk] })) : real(input, init);
      });
    });
    afterAll(() => vi.restoreAllMocks());

    /** What lib/phoneSignIn.ts posts: no cookie, no Origin, as React Native
     *  sends it with `credentials: "omit"`. */
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      auth().handler(
        new Request(`${BASE}/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        })
      );
    const signInWith = (token: string, nonce?: string) => post("/sign-in/social", { provider: "google", idToken: { token, nonce } });

    it("turns Google's ID token into a session token the phone sends as a bearer", async () => {
      const listed = address("phone");
      await addTester(bank.db, listed);
      const token = await googleIdTokenFor(google, { aud: WEB_CLIENT, email: listed, nonce: "nonce-1" }, Date.now());
      const res = await signInWith(token, "nonce-1");
      expect(res.status).toBe(200);
      const bearer = res.headers.get("set-auth-token");
      expect(bearer).toBeTruthy();
      expect(emailOf(await ask({ authorization: `Bearer ${bearer}` }))).toBe(listed);
      // The ID token is not kept, any more than a web sign-in's.
      const account = await bank.db
        .prepare(`select a."idToken" from "${AUTH_TABLES.account}" a join "${AUTH_TABLES.user}" u on u."id" = a."userId" where u."email" = ?`)
        .bind(listed)
        .first<{ idToken: string | null }>();
      expect(account).toEqual({ idToken: null });
    });

    it("refuses a token for another client, another nonce, or not signed by Google", async () => {
      const listed = address("phone-forged");
      await addTester(bank.db, listed);
      const androidClient = await googleIdTokenFor(google, { aud: "android-client.apps.googleusercontent.com", email: listed }, Date.now());
      expect((await signInWith(androidClient)).status).toBe(401);
      const nonced = await googleIdTokenFor(google, { aud: WEB_CLIENT, email: listed, nonce: "the-phone-s" }, Date.now());
      expect((await signInWith(nonced, "another")).status).toBe(401);
      const stranger = await keyPair("google");
      const forged = await googleIdTokenFor(stranger, { aud: WEB_CLIENT, email: listed }, Date.now());
      expect((await signInWith(forged)).status).toBe(401);
      expect(await rows(AUTH_TABLES.user, listed)).toBe(0);
    });

    it("refuses an address the tester list does not name with the code the app reads, and writes nothing", async () => {
      const outsider = address("phone-stranger");
      const token = await googleIdTokenFor(google, { aud: WEB_CLIENT, email: outsider }, Date.now());
      const res = await signInWith(token);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "not_on_tester_list" });
      expect(res.headers.get("set-auth-token")).toBeNull();
      expect(await rows(AUTH_TABLES.user, outsider)).toBe(0);
    });

    it("signs a phone out by its bearer alone, and the token is nobody after", async () => {
      const listed = address("phone-out");
      await addTester(bank.db, listed);
      const res = await signInWith(await googleIdTokenFor(google, { aud: WEB_CLIENT, email: listed }, Date.now()));
      const bearer = res.headers.get("set-auth-token") ?? "";
      expect(emailOf(await ask({ authorization: `Bearer ${bearer}` }))).toBe(listed);
      const out = await post("/sign-out", {}, { authorization: `Bearer ${bearer}` });
      expect(out.status).toBe(200);
      expect(await ask({ authorization: `Bearer ${bearer}` })).toMatchObject({ code: "signed_out" });
    });
  });
});
