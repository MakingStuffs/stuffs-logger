import { defineConfig } from "vitest/config";

/**
 * Covers the workspace's own tooling — the release scripts in `scripts/`,
 * which no package owns and which `pnpm -r test` therefore never sees.
 *
 * `include` is deliberately narrow: without it, a root-level Vitest would glob
 * every test in `packages/` and `apps/` and run them a second time, outside
 * their own environments and configs.
 */
export default defineConfig({
  test: {
    environment: "node",
    restoreMocks: true,
    include: ["scripts/**/*.test.mjs"],
  },
});
