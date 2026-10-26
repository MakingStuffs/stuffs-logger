import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * `@stuffs/logger-core` publishes only its barrel, which pulls zod in. The SDK
 * reaches the core's leaf modules through a tsconfig path mapping instead
 * (see `src/contract.ts`); Vite does not read tsconfig paths, so the same
 * mapping is restated here. It is the one place the two configs must agree.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@stuffs\/logger-core\/(.*)$/,
        replacement: `${fileURLToPath(new URL("../logger-core/src", import.meta.url))}/$1`,
      },
    ],
  },
  test: {
    environment: "node",
    restoreMocks: true,
    unstubGlobals: true,
    include: ["src/**/*.test.ts"],
  },
});
