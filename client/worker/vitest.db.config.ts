/**
 * The Worker's queries against a real schema — run by supabase/test/run.sh,
 * which builds the database and sets BJT_WORKER_DB_TEST. Kept out of
 * `npm test`, which needs no database.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["worker/**/*.db.test.ts"],
    environment: "node",
    // One database, one learner's history: the cases build on each other.
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
