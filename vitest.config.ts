/**
 * The pipeline's tests (tests/*.test.ts). Offline: tests/setup.ts takes every
 * credential out of the environment and makes each network seam refuse, so a
 * call nobody faked fails the test instead of reaching a vendor.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
    restoreMocks: true,
    unstubEnvs: true,
  },
});
