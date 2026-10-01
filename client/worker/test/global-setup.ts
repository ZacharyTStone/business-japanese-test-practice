/**
 * The bank the database tests run against, built once per `npm run test:db`:
 * a local D1 (Miniflare, the same SQLite the real one runs) with every
 * migration in d1/migrations applied and every published bundle in
 * batches/*.sql loaded — twice, because a bundle is applied again on every
 * deploy and must be idempotent.
 *
 * Built the way production is, with `wrangler d1 migrations apply` and
 * `wrangler d1 execute --file`, so a statement wrangler's own splitter would
 * mangle fails here rather than in the deploy. Each test file then opens its
 * own copy (d1.ts), so one file's learners never meet another's.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { TestProject } from "vitest/node";

const ROOT = resolve(__dirname, "../../..");

declare module "vitest" {
  export interface ProvidedContext {
    d1: { config: string; state: string };
  }
}

function wrangler(args: string[]): void {
  execFileSync("npx", ["wrangler", ...args], {
    cwd: resolve(ROOT, "client"),
    stdio: "pipe",
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
  });
}

export default function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), "bjt-d1-"));
  const config = join(dir, "wrangler.jsonc");
  const state = join(dir, "golden");
  writeFileSync(
    config,
    JSON.stringify({
      name: "bjt-d1-test",
      compatibility_date: "2026-09-14",
      d1_databases: [
        {
          binding: "DB",
          database_name: "bjt-d1-test",
          database_id: "00000000-0000-0000-0000-000000000000",
          migrations_dir: join(ROOT, "d1/migrations"),
        },
      ],
    })
  );

  wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state, "-c", config]);

  // The scene bank first: an item names its scene.
  const batches = readdirSync(join(ROOT, "batches"))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => (a === "scenes.sql" ? -1 : b === "scenes.sql" ? 1 : a.localeCompare(b)));
  const all = join(dir, "batches.sql");
  writeFileSync(all, batches.map((f) => readFileSync(join(ROOT, "batches", f), "utf8")).join("\n"));
  for (let i = 0; i < 2; i++) wrangler(["d1", "execute", "DB", "--local", "--persist-to", state, "-c", config, "--file", all]);

  project.provide("d1", { config, state });
  return () => rmSync(dir, { recursive: true, force: true });
}
