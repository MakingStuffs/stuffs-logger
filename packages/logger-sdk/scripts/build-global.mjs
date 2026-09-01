import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "tsup";

/**
 * Builds the `window.StuffsLogger` IIFE and reports the real gzipped size of every
 * browser-facing artefact.
 *
 * tsup cannot emit an IIFE alongside ESM/CJS in one config — the IIFE needs its
 * own `globalName`, a single entry and minification — so it gets its own pass.
 * The sizes are printed on every build and written to `dist/size.json` because
 * bundle size is a requirement, and a requirement nobody measures is a
 * requirement that has quietly stopped holding. The target was 5 KB gzipped;
 * the core entry currently measures just over 6 KB, and the number is recorded
 * here rather than rounded down in a README nobody re-measures.
 *
 * Three numbers, because they answer different questions:
 *
 * - `global`       what a raw HTML page downloads, captures included.
 * - `browser`      what a bundler pulls in from `@stuffs-logger/sdk/browser` if the
 *                  application uses the whole surface.
 * - `browserCore`  what an application that only calls `createLogger` pays,
 *                  once its bundler has tree-shaken the captures away.
 */

const GLOBAL_OUTPUT = "dist/stuffs-logger.global.js";

/** Shared with the IIFE build so every measurement uses the same settings. */
const browserBuildOptions = {
  format: ["iife"],
  target: "es2022",
  platform: "browser",
  minify: true,
  dts: false,
  clean: false,
  treeshake: true,
  noExternal: ["@stuffs-logger/core"],
  tsconfig: "./tsconfig.json",
  silent: true,
  outExtension: () => ({ js: ".js" }),
};

function gzippedSize(path) {
  const bytes = readFileSync(path);
  return { bytes: bytes.length, gzipped: gzipSync(bytes, { level: 9 }).length };
}

await build({
  ...browserBuildOptions,
  entry: { "stuffs-logger.global": "src/global.ts" },
  globalName: "StuffsLogger",
  sourcemap: true,
});

const scratch = mkdtempSync(join(tmpdir(), "stuffs-logger-size-"));

// The probe has to sit inside the package so its relative import resolves and
// so it picks up the same tsconfig path mapping the real build uses.
const PROBE_ENTRY = "dist/size-probe.ts";

try {
  writeFileSync(
    PROBE_ENTRY,
    'import { createLogger } from "../src/browser/index";\n' +
      "export const logger = createLogger({});\n",
  );

  await build({
    ...browserBuildOptions,
    entry: { browser: "src/browser/index.ts", "core-only": PROBE_ENTRY },
    globalName: "StuffsLoggerSizeProbe",
    outDir: scratch,
  });

  const sizes = {
    global: gzippedSize(GLOBAL_OUTPUT),
    browser: gzippedSize(join(scratch, "browser.js")),
    browserCore: gzippedSize(join(scratch, "core-only.js")),
  };

  writeFileSync("dist/size.json", `${JSON.stringify(sizes, null, 2)}\n`);

  for (const [name, { bytes, gzipped }] of Object.entries(sizes)) {
    console.log(
      `${name.padEnd(12)} ${(bytes / 1024).toFixed(2).padStart(6)} KB raw   ${(gzipped / 1024).toFixed(2).padStart(5)} KB gzipped`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(PROBE_ENTRY, { force: true });
}
