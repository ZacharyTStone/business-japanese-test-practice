/**
 * What the way back from Google says (lib/signin.ts): Better Auth's error
 * codes, read into the two things the sign-in screen can say.
 */
import { describe, expect, it } from "vitest";

import { signInRefusal } from "./signin";

describe("the way back from a sign-in", () => {
  it("says nothing when there was nothing wrong", () => {
    expect(signInRefusal("")).toBeNull();
    expect(signInRefusal("?next=/practice")).toBeNull();
  });

  it("reads the tester list's refusal as not listed", () => {
    // worker/auth.ts returns false from the user hook; Better Auth reports it so.
    expect(signInRefusal("?error=unable_to_create_user")).toBe("not_listed");
  });

  it("reads anything else as a failure to try again", () => {
    expect(signInRefusal("?error=state_mismatch")).toBe("failed");
    expect(signInRefusal("?error=internal_server_error")).toBe("failed");
  });
});
