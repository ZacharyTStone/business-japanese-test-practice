/**
 * The Worker's queries and the schema's promises, against a real local D1
 * with the whole published bank (worker/test/global-setup.ts) — `npm run
 * test:db`. Kept out of `npm test`, which needs nothing but Node.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["worker/**/*.db.test.ts"],
    environment: "node",
    globalSetup: ["worker/test/global-setup.ts"],
    // Building the bank takes a while; a query takes milliseconds.
    hookTimeout: 120_000,
    testTimeout: 60_000,
    // Each file has its own copy of the bank; within a file the cases build
    // on each other.
    sequence: { concurrent: false },
  },
});
