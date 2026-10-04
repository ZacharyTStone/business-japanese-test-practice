/**
 * What the way back from Google says (lib/signin.ts): Better Auth's error
 * codes, read into the things the sign-in screen can say, on the web and on a
 * phone; and how a phone says who it is.
 */
import { describe, expect, it } from "vitest";

import { bearerHeaders, googleRefusal, phoneSignInAnswer, signInRefusal } from "./signin";

describe("the way back from a sign-in", () => {
  it("says nothing when there was nothing wrong", () => {
    expect(signInRefusal("")).toBeNull();
    expect(signInRefusal("?next=/practice")).toBeNull();
  });

  it("reads the tester list's own refusal as not listed", () => {
    // worker/auth.ts throws this code from the sign-up and session hooks.
    expect(signInRefusal("?error=not_on_tester_list")).toBe("not_listed");
  });

  it("never tells a listed tester they are not listed because something else failed", () => {
    // What a database hiccup while making the account looks like.
    expect(signInRefusal("?error=unable_to_create_user")).toBe("failed");
    expect(signInRefusal("?error=email_not_verified")).toBe("failed");
    expect(signInRefusal("?error=state_mismatch")).toBe("failed");
    expect(signInRefusal("?error=internal_server_error")).toBe("failed");
  });
});

describe("a phone's sign-in", () => {
  it("sends its session as a bearer, and nothing without one", () => {
    expect(bearerHeaders("abc.def%3D")).toEqual({ authorization: "Bearer abc.def%3D" });
    expect(bearerHeaders(null)).toEqual({});
    expect(bearerHeaders("")).toEqual({});
  });

  it("reads Google's sheet closing as nothing to say, and no account as its own case", () => {
    expect(googleRefusal("ERR_SIGN_IN_CANCELLED")).toBe("cancelled");
    expect(googleRefusal("ERR_NO_GOOGLE_ACCOUNT")).toBe("no_account");
    expect(googleRefusal("ERR_SIGN_IN_FAILED")).toBe("failed");
    expect(googleRefusal(undefined)).toBe("failed");
  });

  it("keeps the token the Worker signed, from its header", () => {
    expect(phoneSignInAnswer(200, "tok.sig", { token: "unsigned" })).toEqual({ token: "tok.sig" });
    // A 200 without the signed token is no sign-in: the body's token is unsigned.
    expect(phoneSignInAnswer(200, null, { token: "unsigned" })).toEqual({ refused: "failed" });
  });

  it("tells a stranger they are not listed, and nobody else", () => {
    expect(phoneSignInAnswer(403, null, { code: "not_on_tester_list" })).toEqual({ refused: "not_listed" });
    expect(phoneSignInAnswer(403, null, { code: "email_not_verified" })).toEqual({ refused: "failed" });
    expect(phoneSignInAnswer(401, null, { code: "INVALID_TOKEN" })).toEqual({ refused: "failed" });
    expect(phoneSignInAnswer(500, null, null)).toEqual({ refused: "failed" });
  });

  it("says so when the Worker has no sign-in yet", () => {
    expect(phoneSignInAnswer(404, null, { error: { code: "sign_in_not_configured" } })).toEqual({ refused: "not_configured" });
  });
});
