import { describe, expect, it } from "vitest";

import { isRefusal, notATester, signedInEmail } from "./identity";

describe("who is asking", () => {
  it("refuses when Access did not run, whatever is claimed", () => {
    const out = signedInEmail(false, "me@example.com");
    expect(isRefusal(out) && out.status).toBe(401);
  });

  it("reads an Access sign-in with no address as an expired session", () => {
    const out = signedInEmail(true, undefined);
    expect(isRefusal(out) && out.code).toBe("session_expired");
    expect(isRefusal(signedInEmail(true, "  "))).toBe(true);
  });

  it("gives the address, lower-cased and trimmed", () => {
    expect(signedInEmail(true, " ME@Example.com")).toBe("me@example.com");
  });

  it("says which address is not on the list", () => {
    expect(notATester("someone@example.com")).toMatchObject({ status: 403, code: "not_a_tester", email: "someone@example.com" });
  });
});
