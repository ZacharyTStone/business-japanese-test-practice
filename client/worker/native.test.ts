/**
 * A native build's sign-in, the parts that need no database: the PKCE
 * arithmetic, what a start or a collection must look like, and the routes.
 * The whole round trip, against a real local D1, is test/native.db.test.ts.
 */
import { describe, expect, it } from "vitest";

import { base64url, challengeOf, handleNative, NATIVE_REDIRECT, newCode, validChallenge, validState, validVerifier } from "./native";

const NO_DB = {} as D1Database;
const ENV = { db: NO_DB, access: { teamDomain: "drill.cloudflareaccess.com", aud: "x".repeat(64) } };

describe("PKCE, as the app and the Worker both compute it", () => {
  it("makes RFC 7636's own example challenge from its example verifier", async () => {
    // RFC 7636, appendix B.
    expect(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("writes base64url without padding", () => {
    expect(base64url(new Uint8Array([251, 255, 191]))).toBe("-_-_");
    expect(base64url(new Uint8Array([1]))).toBe("AQ");
  });

  it("makes codes nobody can guess, each a different one", () => {
    const codes = new Set(Array.from({ length: 50 }, newCode));
    expect(codes.size).toBe(50);
    for (const c of codes) expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("takes a challenge, a verifier and a state only in their own shapes", () => {
    expect(validChallenge("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(validChallenge("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-c")).toBe(false);
    expect(validChallenge("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM")).toBe(false);
    expect(validVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(true);
    expect(validVerifier("short")).toBe(false);
    expect(validVerifier("a".repeat(129))).toBe(false);
    expect(validVerifier(42)).toBe(false);
    expect(validState("abcdefghijklmnop")).toBe(true);
    expect(validState("short")).toBe(false);
    expect(validState("abcdefghijklmnop<script>")).toBe(false);
  });
});

describe("the routes", () => {
  const at = (path: string, init?: RequestInit) => new Request(`https://app.example${path}`, init);

  it("starts only with a GET and collects only with a POST", async () => {
    expect((await handleNative(at("/auth/native/start", { method: "POST" }), ENV)).status).toBe(405);
    expect((await handleNative(at("/auth/native/token"), ENV)).status).toBe(405);
    expect((await handleNative(at("/auth/native/elsewhere"), ENV)).status).toBe(404);
  });

  it("refuses a start without a well-formed challenge and state, before asking who it is", async () => {
    // No token, no database: a malformed start never gets as far as either.
    const res = await handleNative(at("/auth/native/start?challenge=abc&state=abcdefghijklmnop"), ENV);
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("goes back to the app's own scheme and nowhere else", () => {
    expect(NATIVE_REDIRECT).toBe("bizjadrill://auth");
  });
});
