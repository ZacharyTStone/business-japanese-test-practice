/**
 * The password-reset link: a session to set the password with, or why not.
 */
import { describe, expect, it } from "vitest";

import { parseAuthLink } from "./authlink";

describe("a password-reset link", () => {
  it("carries a session after the # on the web and in the app", () => {
    const web = parseAuthLink(
      "https://example.app/reset-password#access_token=aaa&expires_in=3600&refresh_token=rrr&token_type=bearer&type=recovery"
    );
    expect(web).toEqual({ recovery: true, accessToken: "aaa", refreshToken: "rrr", code: null, error: null });
    const app = parseAuthLink("bizjadrill://reset-password#access_token=aaa&refresh_token=rrr&type=recovery");
    expect(app.recovery).toBe(true);
    expect(app.refreshToken).toBe("rrr");
  });

  it("carries a code instead under the PKCE flow", () => {
    const link = parseAuthLink("bizjadrill://reset-password?code=c0de");
    expect(link.recovery).toBe(true);
    expect(link.code).toBe("c0de");
  });

  it("says why when the link is too old or already used", () => {
    const link = parseAuthLink(
      "https://example.app/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"
    );
    expect(link.recovery).toBe(true);
    expect(link.error).toEqual({ code: "otp_expired", message: "Email link is invalid or has expired" });
    expect(link.accessToken).toBeNull();
  });

  it("is not every address the app is opened at", () => {
    expect(parseAuthLink("https://example.app/").recovery).toBe(false);
    expect(parseAuthLink("https://example.app/history?item=abc").recovery).toBe(false);
    expect(parseAuthLink("bizjadrill://reset-password").recovery).toBe(false);
    // A sign-up confirmation is a session too, but not one for a new password.
    expect(parseAuthLink("https://example.app/#access_token=a&refresh_token=r&type=signup").recovery).toBe(false);
  });
});
