/**
 * The Worker's Access settings are filled in, and filled in plausibly.
 *
 * `worker/access.ts` refuses every query when either is empty, which is the
 * safe failure but still an app that is down for everybody: the merge that
 * shipped the token check with both left blank did exactly that. These are the
 * two values the Worker pins — the team whose keys must sign a token, and the
 * Access application it must be for — so their shape is checked here, offline,
 * before a deploy can carry a blank or a typo.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const WRANGLER = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "wrangler.jsonc");

function setting(name: string): string {
  const text = readFileSync(WRANGLER, "utf8");
  const found = [...text.matchAll(new RegExp(`^\\s*"${name}"\\s*:\\s*"([^"]*)"`, "gm"))].map((m) => m[1]);
  expect(found.length, `${name} should be set once in wrangler.jsonc vars, found ${found.length}`).toBe(1);
  return found[0];
}

describe("wrangler.jsonc", () => {
  test("the Access team domain is a team domain", () => {
    expect(setting("ACCESS_TEAM_DOMAIN"), "ACCESS_TEAM_DOMAIN must be <team>.cloudflareaccess.com (Zero Trust → Settings)").toMatch(/^[a-z0-9-]+\.cloudflareaccess\.com$/);
  });

  test("the Access AUD is an AUD tag", () => {
    expect(setting("ACCESS_AUD"), "ACCESS_AUD must be the Access application's 64-character AUD tag (the Worker's Access tab)").toMatch(/^[0-9a-f]{64}$/);
  });
});
