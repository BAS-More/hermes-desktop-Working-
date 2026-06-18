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
    // ROOT-CAUSE fix for full-suite flakes: ~27 test files spawn REAL child
    // processes (sh helpers in the secrets provider, gateway lifecycle, CLI
    // fallbacks). Vitest's default forks pool runs one worker per CPU core (8
    // here), and EACH worker then spawns its own children — oversubscribing the
    // 8 cores many times over. Under that contention a test that takes ~2s
    // isolated was observed taking 30s+ (a 16× slowdown), tripping deadlines
    // and producing flaky failures unrelated to the code under test. Capping
    // the pool to half the cores leaves headroom for the spawned children, so
    // wall-clock per test stays bounded and the races disappear.
    pool: "forks",
    poolOptions: {
      forks: { maxForks: 4, minForks: 1 },
    },
    // Safety ceiling for the genuinely process-heavy tests; with contention
    // capped above, normal tests finish in milliseconds and only real spawns
    // approach this. Not a substitute for the pool cap — both matter.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ["./src/renderer/src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
  },
});
