import { defineConfig } from "tsup";

/**
 * Compiles the core to ESM, CJS and `.d.ts` in `dist/`.
 *
 * Until this package became publishable it pointed `main`/`types` straight at
 * `src/index.ts`, which only ever worked because every consumer was inside
 * this workspace and compiled TypeScript itself. A published tarball has to
 * carry real JavaScript, so the sources are compiled here and the `dist` paths
 * are swapped in at pack time by `publishConfig` (see this package's
 * `package.json`). In-workspace resolution keeps pointing at `src`, which is
 * what the SDK's path mapping and the dashboard both rely on.
 *
 * EVERY leaf module is an entry, not just the barrel, because the leaves are a
 * real part of this package's contract:
 *
 * - The barrel re-exports `./schemas`, which pulls zod in. Consumers who only
 *   want the limits or the log taxonomy can import the leaf and pay nothing
 *   for zod — which is exactly the trade the SDK makes internally, via the
 *   `@stuffs-logger/core/*` path mapping in `logger-sdk/tsconfig.json`.
 * - Because the SDK makes that trade, its emitted declarations re-export from
 *   `@stuffs-logger/core/taxonomy`, `/redaction` and `/json`. Those specifiers
 *   have to resolve in a consumer's `node_modules` or the SDK's public types
 *   collapse to `any`. Publishing the leaves is what makes them resolve.
 *
 * `zod` stays external: it is a real runtime dependency of the schemas the
 * dashboard validates ingest payloads with, and bundling a copy here would
 * give an application two zods.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    constants: "src/constants.ts",
    json: "src/json.ts",
    keys: "src/keys.ts",
    redaction: "src/redaction.ts",
    schemas: "src/schemas.ts",
    taxonomy: "src/taxonomy.ts",
    text: "src/text.ts",
    timestamps: "src/timestamps.ts",
  },
  format: ["esm", "cjs"],
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,

  // Shared chunks rather than a copy of `constants` in every entry, so an
  // application importing both the barrel and a leaf gets one module instance
  // of each. tsup only splits ESM; the CJS entries duplicate, which is the
  // usual cost of shipping both formats and matters to nothing here — every
  // core module is pure, with no module-level state to fork.
  splitting: true,
  tsconfig: "./tsconfig.json",
  outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
  esbuildOptions(options) {
    options.legalComments = "none";
  },
});
