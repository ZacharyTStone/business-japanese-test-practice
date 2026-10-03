/**
 * A native build's sign-in, the parts that are strings: the page the tab
 * opens, the link it comes back on, and how a turned-away request reads.
 */
import { describe, expect, it } from "vitest";

import { base64ToUrl, base64url, codeFromCallback, nativeSignedOut, NATIVE_REDIRECT, signInUrl } from "./signin";

const CODE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

describe("the sign-in round trip", () => {
  it("comes back to the scheme the Worker sends it to", () => {
    // worker/native.ts, NATIVE_REDIRECT: the two are one address.
    expect(NATIVE_REDIRECT).toBe("bizjadrill://auth");
  });

  it("opens the Worker's start page with the challenge and the state", () => {
    const url = new URL(signInUrl("https://app.example", "ch_al-lenge", "st-ate"));
    expect(url.origin + url.pathname).toBe("https://app.example/auth/native/start");
    expect(url.searchParams.get("challenge")).toBe("ch_al-lenge");
    expect(url.searchParams.get("state")).toBe("st-ate");
  });

  it("takes the code only from its own sign-in, on its own scheme", () => {
    expect(codeFromCallback(`${NATIVE_REDIRECT}?code=${CODE}&state=mine`, "mine")).toBe(CODE);
    expect(codeFromCallback(`${NATIVE_REDIRECT}?code=${CODE}&state=theirs`, "mine")).toBeNull();
    expect(codeFromCallback(`https://evil.example/auth?code=${CODE}&state=mine`, "mine")).toBeNull();
    expect(codeFromCallback(`${NATIVE_REDIRECT}?state=mine`, "mine")).toBeNull();
    expect(codeFromCallback(`${NATIVE_REDIRECT}?code=short&state=mine`, "mine")).toBeNull();
  });

  it("writes base64url as RFC 7636 does", () => {
    expect(base64url(new Uint8Array([251, 255, 191]))).toBe("-_-_");
    expect(base64ToUrl("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw+cM=")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("a native request Access turned away", () => {
  it("reads Access's sign-in page, or a bare refusal, as signed out", () => {
    expect(nativeSignedOut(200, "text/html; charset=utf-8")).toBe(true);
    expect(nativeSignedOut(401, null)).toBe(true);
    expect(nativeSignedOut(403, "text/html")).toBe(true);
  });

  it("leaves the Worker's own answers, and a server's failure, alone", () => {
    expect(nativeSignedOut(200, "application/json; charset=utf-8")).toBe(false);
    expect(nativeSignedOut(401, "application/json")).toBe(false);
    expect(nativeSignedOut(502, "text/html")).toBe(false);
  });
});
