import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src/renderer/src"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
    // A handful of secrets tests spawn a REAL `sh` (commandProvider /
    // api-server-key overlay). Under a CPU-saturated parallel full-suite run,
    // process spawn + teardown can exceed vitest's default 5s per-test
    // deadline, producing flaky failures unrelated to the code under test
    // (observed 3–6.4s on the list()/vault-key spawn tests). A 20s ceiling
    // removes the race while still catching a genuinely hung test. The
    // provider's OWN 3s production timeout is unaffected (this is the test
    // runner's deadline, not the spawn cap).
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ["./src/renderer/src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
  },
});
