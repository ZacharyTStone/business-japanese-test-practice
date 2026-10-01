/**
 * Unit tests for the parts of the app that are plain functions: the practice
 * reducer, the reading clock's arithmetic, the exam date, the level helpers,
 * the role table, and the arithmetic inside a few screens' pieces. They run in
 * Node with no device, no bundler and no network — `npm test`, and the
 * `checks` workflow.
 *
 * Some of those modules import React Native, or a library built on it, for
 * what they draw; the test only ever reads their plain half. Stubs stand in
 * for React Native, react-native-svg and the safe-area library (src/test/),
 * and for AsyncStorage, where the language choice is kept — enough for the
 * module to load, nothing that pretends to render.
 */
import { defineConfig } from "vitest/config";

const stub = (file: string) => new URL(`./src/test/${file}`, import.meta.url).pathname;

export default defineConfig({
  test: {
    // The Worker's pure parts too; its queries need a database and are run by
    // `npm run test:db` instead (worker/vitest.db.config.ts).
    include: ["src/**/*.test.ts", "worker/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["worker/**/*.db.test.ts", "node_modules/**"],
    environment: "node",
  },
  resolve: {
    // Exact names only: "react-native" must not swallow "react-native-svg".
    alias: [
      { find: /^@react-native-async-storage\/async-storage$/, replacement: stub("async-storage-stub.ts") },
      { find: /^react-native$/, replacement: stub("react-native-stub.ts") },
      { find: /^react-native-svg$/, replacement: stub("native-modules-stub.ts") },
      { find: /^react-native-safe-area-context$/, replacement: stub("native-modules-stub.ts") },
    ],
  },
});
