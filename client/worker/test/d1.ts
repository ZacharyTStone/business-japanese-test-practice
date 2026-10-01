/**
 * A test file's own copy of the bank (global-setup.ts built it): the schema
 * and every published bundle, in a local D1 nobody else is writing to.
 */
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { inject } from "vitest";
import { getPlatformProxy } from "wrangler";

export type Bank = { db: D1Database; dispose: () => Promise<void> };

export async function openBank(): Promise<Bank> {
  const { config, state } = inject("d1");
  const copy = mkdtempSync(join(dirname(state), "copy-"));
  cpSync(state, copy, { recursive: true });
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: config, persist: { path: join(copy, "v3") } });
  return {
    db: proxy.env.DB,
    async dispose() {
      await proxy.dispose();
      rmSync(copy, { recursive: true, force: true });
    },
  };
}

/** A unique address, so a learner made in one test is never another's. */
export function address(name: string): string {
  return `${name}-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

/** Put an address on the tester list, as the owner does (`bjt tester`). */
export async function addTester(
  db: D1Database,
  email: string,
  opts: { unlimited?: boolean; mayVeto?: boolean; maxDailyGoal?: number | null } = {}
): Promise<void> {
  await db
    .prepare("insert into testers (email, note, unlimited, may_veto, max_daily_goal) values (?, 'test', ?, ?, ?)")
    .bind(email, opts.unlimited ? 1 : 0, opts.mayVeto ? 1 : 0, opts.maxDailyGoal ?? null)
    .run();
}
