/**
 * No sign-in setting is written in wrangler.jsonc.
 *
 * The sign-in's four settings are Worker secrets (worker/auth.ts). One put in
 * `vars` instead would be committed — the client secret and the session key
 * in the repository for anybody to read — and a deploy replaces `vars` with
 * the file's, so it would also be the value that wins. Cloudflare Access's two
 * settings went with Access (2026-10-04); a token it signs is nobody now.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const WRANGLER = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "wrangler.jsonc");
const SECRETS = ["BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

describe("wrangler.jsonc", () => {
  const text = readFileSync(WRANGLER, "utf8");
  const settings = [...text.matchAll(/^\s*"([A-Z][A-Z0-9_]*)"\s*:/gm)].map((m) => m[1]);

  test("names none of the sign-in's secrets as a setting", () => {
    for (const name of SECRETS) expect(settings, `${name} is a Worker secret; set it with wrangler secret put`).not.toContain(name);
  });

  test("no longer configures Cloudflare Access", () => {
    expect(settings.filter((name) => name.startsWith("ACCESS_"))).toEqual([]);
  });
});
