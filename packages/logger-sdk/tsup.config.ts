import { defineConfig } from "tsup";

/**
 * Four builds from one source tree:
 *
 * - `index`  — isomorphic ESM/CJS, picks its runtime at load.
 * - `browser`— the DOM-only build, which the `browser` export condition steers
 *              every browser bundler to.
 * - `node`   — the Node-only build.
 * - `global` — an IIFE exposing `window.JFLogger` for pages with no build step.
 *
 * `@jf-logger/core` is a source-only workspace package, so it is bundled in
 * rather than externalised. Its zod-backed schemas are never reachable: every
 * runtime import goes through `src/contract.ts`, which imports the core's leaf
 * modules by path mapping. `pnpm size` proves it.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    browser: "src/browser/index.ts",
    node: "src/node/index.ts",
  },
  format: ["esm", "cjs"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  noExternal: ["@jf-logger/core"],
  tsconfig: "./tsconfig.json",
  outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
  esbuildOptions(options) {
    options.legalComments = "none";
  },
});
