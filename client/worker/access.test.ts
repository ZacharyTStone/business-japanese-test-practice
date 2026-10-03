import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { accessEmail, accessToken, forgetKeys, teamHost, verifyAccessToken, type KeySource } from "./access";
import { isRefusal } from "./identity";

const TEAM = "drill.cloudflareaccess.com";
const AUD = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2";
const CONFIG = { teamDomain: TEAM, aud: AUD };
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const SEC = NOW / 1000;

type Pair = { privateKey: CryptoKey; jwk: JsonWebKey & { kid: string } };

async function pair(kid: string): Promise<Pair> {
  const k = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", k.publicKey)) as JsonWebKey;
  return { privateKey: k.privateKey, jwk: { ...jwk, kid, alg: "RS256", use: "sig" } };
}

function b64url(data: Uint8Array | string): string {
  const raw = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(key: Pair, claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const h = b64url(JSON.stringify({ alg: "RS256", kid: key.jwk.kid, typ: "JWT", ...header }));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

const good = (over: Record<string, unknown> = {}) => ({
  aud: [AUD],
  email: "Me@Example.com",
  exp: SEC + 3600,
  iat: SEC - 60,
  nbf: SEC - 60,
  iss: `https://${TEAM}`,
  type: "app",
  ...over,
});

let ours: Pair;
let theirs: Pair;
let asked: string[];
let published: Pair[];
const source: KeySource = async (url) => {
  asked.push(url);
  return published.map((p) => p.jwk);
};

beforeAll(async () => {
  ours = await pair("ours");
  theirs = await pair("theirs");
});

beforeEach(() => {
  forgetKeys();
  asked = [];
  published = [ours];
});

describe("the token Access signed", () => {
  it("gives the claims of a token our team signed for this app", async () => {
    const out = await verifyAccessToken(await sign(ours, good()), CONFIG, NOW, source);
    expect(isRefusal(out)).toBe(false);
    expect(asked).toEqual([`https://${TEAM}/cdn-cgi/access/certs`]);
  });

  it("takes an audience given as a single string", async () => {
    expect(isRefusal(await verifyAccessToken(await sign(ours, good({ aud: AUD })), CONFIG, NOW, source))).toBe(false);
  });

  it("refuses a token signed by a key that is not the team's", async () => {
    const forged = await sign(theirs, good(), { kid: "ours" });
    expect(await verifyAccessToken(forged, CONFIG, NOW, source)).toMatchObject({ code: "access_invalid" });
  });

  it("refuses a token whose claims were changed after signing", async () => {
    const [h, , s] = (await sign(ours, good())).split(".");
    const tampered = `${h}.${b64url(JSON.stringify(good({ email: "someone.else@example.com" })))}.${s}`;
    expect(await verifyAccessToken(tampered, CONFIG, NOW, source)).toMatchObject({ code: "access_invalid" });
  });

  it("refuses another team's token, even one signed properly by that team", async () => {
    const other = await sign(ours, good({ iss: "https://someone.cloudflareaccess.com" }));
    expect(await verifyAccessToken(other, CONFIG, NOW, source)).toMatchObject({ code: "access_invalid" });
  });

  it("never asks the token where to fetch the keys", async () => {
    await verifyAccessToken(await sign(ours, good({ iss: "https://evil.example" })), CONFIG, NOW, source);
    expect(asked.every((u) => u === `https://${TEAM}/cdn-cgi/access/certs`)).toBe(true);
  });

  it("refuses a token for another application", async () => {
    const other = await sign(ours, good({ aud: ["another-app"] }));
    expect(await verifyAccessToken(other, CONFIG, NOW, source)).toMatchObject({ code: "access_invalid" });
  });

  it("reads an expired token as an expired session", async () => {
    const old = await sign(ours, good({ exp: SEC - 1 }));
    expect(await verifyAccessToken(old, CONFIG, NOW, source)).toMatchObject({ status: 401, code: "session_expired" });
    expect(await verifyAccessToken(await sign(ours, good({ exp: undefined })), CONFIG, NOW, source)).toMatchObject({
      code: "session_expired",
    });
  });

  it("refuses a token not valid yet, beyond a minute's clock skew", async () => {
    expect(isRefusal(await verifyAccessToken(await sign(ours, good({ nbf: SEC + 30 })), CONFIG, NOW, source))).toBe(false);
    expect(await verifyAccessToken(await sign(ours, good({ nbf: SEC + 600 })), CONFIG, NOW, source)).toMatchObject({
      code: "access_invalid",
    });
  });

  it("refuses any algorithm but RS256, and an unsigned token", async () => {
    const [, p] = (await sign(ours, good())).split(".");
    const none = `${b64url(JSON.stringify({ alg: "none", kid: "ours" }))}.${p}.`;
    expect(await verifyAccessToken(none, CONFIG, NOW, source)).toMatchObject({ code: "access_invalid" });
    const hs = await sign(ours, good(), { alg: "HS256" });
    expect(await verifyAccessToken(hs, CONFIG, NOW, source)).toMatchObject({ code: "access_invalid" });
  });

  it("refuses what is not a token at all", async () => {
    for (const junk of ["", "abc", "a.b", "a.b.c.d", "!!.??.**", "e30.e30.e30"]) {
      expect(await verifyAccessToken(junk, CONFIG, NOW, source)).toMatchObject({ code: "access_invalid" });
    }
  });

  it("fetches the keys again when a token names one the cached set lacks", async () => {
    await verifyAccessToken(await sign(ours, good()), CONFIG, NOW, source);
    const rotated = await pair("rotated");
    published = [ours, rotated];
    expect(isRefusal(await verifyAccessToken(await sign(rotated, good()), CONFIG, NOW + 1000, source))).toBe(false);
    expect(asked).toHaveLength(2);
    await verifyAccessToken(await sign(ours, good()), CONFIG, NOW + 2000, source);
    expect(asked).toHaveLength(2);
  });
});

describe("who is asking", () => {
  const request = (headers: Record<string, string>) => new Request("https://app.example/api/q/whoami", { method: "POST", headers });

  it("reads the token from Access's header, else from its cookie", () => {
    expect(accessToken(request({ "cf-access-jwt-assertion": "a.b.c" }))).toBe("a.b.c");
    expect(accessToken(request({ cookie: "x=1; CF_Authorization=d.e.f; y=2" }))).toBe("d.e.f");
    expect(accessToken(request({ cookie: "CF_AuthorizationX=d.e.f" }))).toBeNull();
    expect(accessToken(request({}))).toBeNull();
  });

  it("reads the token a native build sends, after Access's own header", () => {
    expect(accessToken(request({ "cf-access-token": "g.h.i" }))).toBe("g.h.i");
    expect(accessToken(request({ "cf-access-jwt-assertion": "a.b.c", "cf-access-token": "g.h.i" }))).toBe("a.b.c");
  });

  it("checks a native build's token as it checks Access's own", async () => {
    expect(await accessEmail(request({ "cf-access-token": await sign(ours, good()) }), CONFIG, NOW, source)).toBe("me@example.com");
    const forged = await sign(theirs, good(), { kid: "ours" });
    expect(await accessEmail(request({ "cf-access-token": forged }), CONFIG, NOW, source)).toMatchObject({ code: "access_invalid" });
  });

  it("gives the signed-in address, lower-cased", async () => {
    const r = request({ "cf-access-jwt-assertion": await sign(ours, good()) });
    expect(await accessEmail(r, CONFIG, NOW, source)).toBe("me@example.com");
  });

  it("refuses a request Access did not sign, whatever its headers claim", async () => {
    const r = request({ "cf-access-authenticated-user-email": "me@example.com" });
    expect(await accessEmail(r, CONFIG, NOW, source)).toMatchObject({ status: 401, code: "access_missing" });
  });

  it("refuses everybody, not nobody, when the settings are missing", async () => {
    const r = request({ "cf-access-jwt-assertion": await sign(ours, good()) });
    expect(await accessEmail(r, { teamDomain: TEAM }, NOW, source)).toMatchObject({ status: 500, code: "access_not_configured" });
    expect(await accessEmail(r, { aud: AUD, teamDomain: " " }, NOW, source)).toMatchObject({ code: "access_not_configured" });
  });

  it("says so when the team's keys cannot be fetched", async () => {
    const r = request({ "cf-access-jwt-assertion": await sign(ours, good()) });
    const down: KeySource = async () => {
      throw new Error("down");
    };
    expect(await accessEmail(r, CONFIG, NOW, down)).toMatchObject({ status: 503, code: "access_keys_unavailable" });
  });

  it("reads a token with no address as an expired session", async () => {
    const r = request({ "cf-access-jwt-assertion": await sign(ours, good({ email: undefined })) });
    expect(await accessEmail(r, CONFIG, NOW, source)).toMatchObject({ code: "session_expired" });
  });

  it("takes the team domain however it was written down", () => {
    expect(teamHost("https://drill.cloudflareaccess.com/")).toBe(TEAM);
    expect(teamHost(" drill.cloudflareaccess.com ")).toBe(TEAM);
  });
});
