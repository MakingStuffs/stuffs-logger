import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    restoreMocks: true,
    setupFiles: ["./src/test/setup.ts"],
    /**
     * THE COLLECTION BOUNDARY with Playwright. Vitest owns `*.test.{ts,tsx}`
     * and Playwright owns `*.spec.ts` / `*.setup.ts` (see
     * `playwright.config.ts`), so neither runner can ever pick up the other's
     * files. `e2e/**` is included so the harness's own pure logic - the
     * seeded-data contract, the seeding orchestration, the environment rules -
     * is unit-tested here, with no browser and no database.
     */
    include: ["src/**/*.test.{ts,tsx}", "e2e/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
