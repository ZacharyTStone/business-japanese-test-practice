import { describe, expect, it } from "vitest";

import { claimsFor, isRefusal, parseUserMap, resolveCaller } from "./identity";

const ID = "6f1c2c1e-6f0a-4a77-9d1e-2b8f6c3a9e10";

describe("the email → user id map", () => {
  it("reads the secret's JSON, lower-casing addresses", () => {
    const map = parseUserMap(JSON.stringify({ "Me@Example.com ": ID.toUpperCase() }));
    expect([...map]).toEqual([["me@example.com", ID]]);
  });

  it("maps nobody from a missing, malformed or wrongly shaped secret", () => {
    expect(parseUserMap(undefined).size).toBe(0);
    expect(parseUserMap("{not json").size).toBe(0);
    expect(parseUserMap(JSON.stringify([ID])).size).toBe(0);
    expect(parseUserMap(JSON.stringify({ "me@example.com": "not-a-uuid", nobody: ID })).size).toBe(0);
  });
});

describe("who is asking", () => {
  const users = parseUserMap(JSON.stringify({ "me@example.com": ID }));

  it("refuses when Access did not run, whatever is claimed", () => {
    const out = resolveCaller(false, "me@example.com", users);
    expect(isRefusal(out) && out.status).toBe(401);
  });

  it("reads an Access sign-in with no address as an expired session", () => {
    const out = resolveCaller(true, undefined, users);
    expect(isRefusal(out) && out.code).toBe("session_expired");
  });

  it("refuses an address the map does not name", () => {
    const out = resolveCaller(true, "someone@example.com", users);
    expect(isRefusal(out) && out).toMatchObject({ status: 403, code: "not_a_tester", email: "someone@example.com" });
  });

  it("gives the mapped id, matching the address case-insensitively", () => {
    expect(resolveCaller(true, " ME@example.com", users)).toEqual({ userId: ID, email: "me@example.com" });
  });

  it("carries the claims the schema reads", () => {
    expect(JSON.parse(claimsFor({ userId: ID, email: "me@example.com" }))).toEqual({
      sub: ID,
      email: "me@example.com",
      role: "authenticated",
      aud: "authenticated",
      is_anonymous: false,
    });
  });
});
