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
