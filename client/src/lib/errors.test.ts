import { describe, expect, it } from "vitest";

import { errorKind, errorText, friendlyError } from "./errors";

describe("errorText", () => {
  it("joins a PostgREST error's parts and keeps its code", () => {
    expect(errorText({ message: "column x does not exist", hint: "", code: "42703" })).toBe(
      "column x does not exist (42703)"
    );
  });
  it("reads an Error's message and passes a string through", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText("plain")).toBe("plain");
  });
});

describe("errorKind", () => {
  it("recognises being offline", () => {
    expect(errorKind(new TypeError("Failed to fetch"))).toBe("offline");
    expect(errorKind({ message: "TypeError: Network request failed" })).toBe("offline");
    expect(errorKind({ name: "AuthRetryableFetchError", message: "x", status: 0 })).toBe("offline");
  });
  it("recognises an expired session", () => {
    expect(errorKind({ message: "JWT expired", code: "PGRST301" })).toBe("session_expired");
    expect(errorKind({ name: "AuthSessionMissingError", message: "Auth session missing!" })).toBe(
      "session_expired"
    );
  });
  it("recognises a wrong password", () => {
    expect(errorKind({ message: "Invalid login credentials", code: "invalid_credentials" })).toBe(
      "wrong_password"
    );
  });
  it("leaves everything else alone", () => {
    expect(errorKind({ message: "duplicate key", code: "23505" })).toBe("other");
  });
});

describe("friendlyError", () => {
  const t = (key: string) => `<${key}>`;
  it("gives a sentence and no small print for a known failure", () => {
    expect(friendlyError(new TypeError("Failed to fetch"), t)).toEqual({ message: "<err_offline>", detail: "" });
  });
  it("keeps the technical text for an unknown one", () => {
    expect(friendlyError({ message: "boom", code: "XX000" }, t)).toEqual({
      message: "<err_other>",
      detail: "boom (XX000)",
    });
  });
});
