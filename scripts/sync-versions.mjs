import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Writes one version into every manifest in the workspace.
 *
 * `scripts/release.sh` computes a single version for the repository, and this
 * repository ships that one version everywhere: the root, both published
 * packages and the (private) dashboard. Lockstep is what lets
 * `@stuffs-logger/sdk@1.4.0` state `"@stuffs-logger/core": "1.4.0"` and mean
 * it — pnpm rewrites the SDK's `workspace:*` to the core's concrete version at
 * pack time, so if the two manifests ever disagreed the published SDK would
 * quietly depend on a core that was never released.
 *
 * It is a plain `.mjs` module with no build step on purpose: it runs partway
 * through the release, where anything that needs compiling first is a way for
 * a release to fail halfway through.
 *
 * @example
 * node scripts/sync-versions.mjs 1.4.0
 */

/**
 * Every manifest that carries the lockstep version, relative to the repo root.
 *
 * The dashboard is in the list and stays `"private": true` — it takes the
 * version so a deployed dashboard can be traced back to a release, but it is
 * never sent to a registry.
 */
export const LOCKSTEP_MANIFESTS = [
  "package.json",
  "packages/logger-core/package.json",
  "packages/logger-sdk/package.json",
  "apps/dashboard/package.json",
];

/**
 * The official SemVer 2.0.0 grammar, anchored.
 *
 * The version arrives as a command-line argument from the release script,
 * so it is untrusted input by the time it reaches this
 * module. Validating it here means a malformed or hostile value fails loudly
 * before anything is written, rather than landing in four manifests.
 */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** The repository root, derived from this file's own location. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Serialises a manifest the way Prettier already formats these files, so a
 * sync never shows up as a formatting diff.
 *
 * @param {Record<string, unknown>} manifest - The parsed manifest.
 * @returns {string} The file contents, trailing newline included.
 */
function serialiseManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Writes `version` into every lockstep manifest.
 *
 * Rewrites a file only when its contents would actually change, which is what
 * makes a second run a no-op rather than a fresh set of modified timestamps
 * for the release commit to pick up.
 *
 * @param {object} options
 * @param {string} options.version - The version to write. Must be valid SemVer.
 * @param {string} [options.rootDir] - Workspace root; defaults to this repo.
 * @returns {{ path: string, changed: boolean }[]} One entry per manifest, in
 *   `LOCKSTEP_MANIFESTS` order, saying whether the file was rewritten.
 * @throws {Error} If the version is not valid SemVer, or a manifest is missing
 *   or unparseable.
 */
export function syncVersions({ version, rootDir = REPO_ROOT }) {
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error(`Not a valid semver version: ${JSON.stringify(version)}`);
  }

  return LOCKSTEP_MANIFESTS.map((relativePath) => {
    const path = join(rootDir, relativePath);

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not read manifest ${relativePath}: ${reason}`);
    }

    const before = serialiseManifest(manifest);
    manifest.version = version;
    const after = serialiseManifest(manifest);

    if (before === after) {
      return { path: relativePath, changed: false };
    }

    writeFileSync(path, after);
    return { path: relativePath, changed: true };
  });
}

/** True when this module was executed directly rather than imported. */
function isMain() {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const version = process.argv[2];

  if (version === undefined) {
    console.error("usage: node scripts/sync-versions.mjs <version>");
    process.exit(1);
  }

  try {
    for (const { path, changed } of syncVersions({ version })) {
      console.log(`${changed ? "updated" : "unchanged"}  ${path}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
