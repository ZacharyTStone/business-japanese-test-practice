/**
 * Unit tests for the parts of the app that are plain functions: the practice
 * reducer, the reading clock's arithmetic, the exam date, the level helpers
 * and the role table. They run in Node with no device, no bundler and no
 * network — `npm test`, and the `checks` workflow.
 *
 * The one module in that set with a React Native dependency is the string
 * table (for AsyncStorage, where the language choice is kept); a stub stands
 * in for it here, because what these tests check never touches storage.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@react-native-async-storage/async-storage": new URL(
        "./src/test/async-storage-stub.ts",
        import.meta.url
      ).pathname,
    },
  },
});
