/**
 * A native build's sign-in (worker/native.ts), end to end against a real
 * local D1 with the migrations applied: a tester's tab is sent back to the
 * app with a code, the code buys the token once and only with the app's
 * secret, a stranger is told no and nothing is kept, and nothing outlives
 * its two minutes.
 *
 * The tokens are signed here with a key of the test's own, handed to the
 * check as the team's (as access.test.ts does): what is being tested is what
 * happens after the signature is good, and that a bad one stops everything.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { forgetKeys, type KeySource } from "../access";
import { challengeOf, CODE_TTL_MS, handleNative, issueCode, NATIVE_REDIRECT, type NativeEnv } from "../native";
import { addTester, address, openBank, type Bank } from "./d1";

const TEAM = "drill.cloudflareaccess.com";
const AUD = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2";
const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const STATE = "state-from-the-app-0001";

type Pair = { privateKey: CryptoKey; jwk: JsonWebKey & { kid: string } };

function b64url(data: Uint8Array | string): string {
  const raw = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pair(kid: string): Promise<Pair> {
  const k = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", k.publicKey)) as JsonWebKey;
  return { privateKey: k.privateKey, jwk: { ...jwk, kid, alg: "RS256", use: "sig" } };
}

async function tokenFor(key: Pair, email: string): Promise<string> {
  const sec = NOW / 1000;
  const h = b64url(JSON.stringify({ alg: "RS256", kid: key.jwk.kid, typ: "JWT" }));
  const p = b64url(JSON.stringify({ aud: [AUD], email, exp: sec + 3600, iat: sec - 60, nbf: sec - 60, iss: `https://${TEAM}`, type: "app" }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

describe("a native build's sign-in", () => {
  let bank: Bank;
  let env: NativeEnv;
  let ours: Pair;
  let theirs: Pair;
  let challenge: string;
  const keys: KeySource = async () => [ours.jwk];
  const tester = address("native");
  const stranger = address("native-stranger");

  beforeAll(async () => {
    bank = await openBank();
    env = { db: bank.db, access: { teamDomain: TEAM, aud: AUD } };
    ours = await pair("ours");
    theirs = await pair("theirs");
    challenge = await challengeOf(VERIFIER);
    forgetKeys();
    await addTester(bank.db, tester);
  });

  afterAll(async () => {
    forgetKeys();
    await bank?.dispose();
  });

  async function start(token: string | null, now = NOW, c = challenge): Promise<Response> {
    const headers: Record<string, string> = token ? { "cf-access-jwt-assertion": token } : {};
    const req = new Request(`https://app.example/auth/native/start?challenge=${c}&state=${STATE}`, { headers });
    return handleNative(req, env, now, keys);
  }

  async function collect(code: string, verifier = VERIFIER, now = NOW): Promise<Response> {
    const req = new Request("https://app.example/auth/native/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier }),
    });
    return handleNative(req, env, now, keys);
  }

  function codeIn(res: Response): string {
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith(`${NATIVE_REDIRECT}?`)).toBe(true);
    const url = new URL(location);
    expect(url.searchParams.get("state")).toBe(STATE);
    return url.searchParams.get("code") ?? "";
  }

  async function rows(): Promise<number> {
    const r = await bank.db.prepare("select count(*) as n from native_sign_ins").first<{ n: number }>();
    return r?.n ?? -1;
  }

  it("sends a tester's tab back to the app with a code, which buys the token once", async () => {
    const token = await tokenFor(ours, tester);
    const res = await start(token);
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const code = codeIn(res);

    const got = await collect(code);
    expect(got.status).toBe(200);
    expect(((await got.json()) as { data: { token: string } }).data.token).toBe(token);

    const again = await collect(code);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("sign_in_failed");
  });

  it("keeps only the code's hash, never the code", async () => {
    const code = codeIn(await start(await tokenFor(ours, tester)));
    const stored = await bank.db.prepare("select code_hash from native_sign_ins").all<{ code_hash: string }>();
    expect(stored.results.map((r) => r.code_hash)).not.toContain(code);
    expect((await collect(code)).status).toBe(200);
  });

  it("spends a code on a wrong secret, so whoever took it gets one try", async () => {
    const code = codeIn(await start(await tokenFor(ours, tester)));
    expect((await collect(code, "x".repeat(43))).status).toBe(400);
    expect((await collect(code)).status).toBe(400);
  });

  it("lets a code lapse after two minutes, and clears it on the next sign-in", async () => {
    const code = codeIn(await start(await tokenFor(ours, tester)));
    expect((await collect(code, VERIFIER, NOW + CODE_TTL_MS)).status).toBe(400);

    const before = await rows();
    await issueCode(bank.db, "a.b.c", challenge, NOW);
    expect(await rows()).toBe(before + 1);
    await issueCode(bank.db, "d.e.f", challenge, NOW + CODE_TTL_MS + 1);
    // The first is past its time and goes; the second stays.
    expect(await rows()).toBe(before + 1);
  });

  it("tells an address that is not on the list so, and keeps nothing about it", async () => {
    const before = await rows();
    const res = await start(await tokenFor(ours, stranger));
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain(stranger);
    expect(await rows()).toBe(before);
    const users = await bank.db.prepare("select count(*) as n from users where email = ?").bind(stranger).first<{ n: number }>();
    expect(users?.n).toBe(0);
  });

  it("starts nothing for a request Access did not sign", async () => {
    const before = await rows();
    expect((await start(null)).status).toBe(401);
    const forged = (await start(await tokenFor(theirs, tester))).status;
    expect(forged).toBe(401);
    expect(await rows()).toBe(before);
  });

  it("collects nothing for a code it never made", async () => {
    expect((await collect("A".repeat(43))).status).toBe(400);
    const req = new Request("https://app.example/auth/native/token", { method: "POST", body: "not json" });
    expect((await handleNative(req, env, NOW, keys)).status).toBe(400);
  });
});
