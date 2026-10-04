import { describe, expect, it } from "vitest";

import { isRefusal, notATester, signedInEmail } from "./identity";

describe("who is asking", () => {
  it("reads a session with no address as nobody signed in", () => {
    expect(signedInEmail(undefined)).toMatchObject({ status: 401, code: "signed_out" });
    expect(isRefusal(signedInEmail("  "))).toBe(true);
  });

  it("gives the address, lower-cased and trimmed", () => {
    expect(signedInEmail(" ME@Example.com")).toBe("me@example.com");
  });

  it("says which address is not on the list", () => {
    expect(notATester("someone@example.com")).toMatchObject({ status: 403, code: "not_a_tester", email: "someone@example.com" });
  });
});
