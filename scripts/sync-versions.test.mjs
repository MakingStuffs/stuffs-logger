import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LOCKSTEP_MANIFESTS, syncVersions } from "./sync-versions.mjs";

/**
 * The script rewrites files in place, so every test gets its own throwaway
 * workspace rather than a shared fixture directory.
 */
let rootDir;

/**
 * Builds a manifest with the fields the sync has to leave alone.
 *
 * @param {Record<string, unknown>} overrides
 * @returns {Record<string, unknown>}
 */
function makeManifest(overrides = {}) {
  return {
    name: "@stuffs-logger/example",
    version: "0.1.0",
    private: true,
    dependencies: { "@stuffs-logger/core": "workspace:*" },
    ...overrides,
  };
}

/**
 * @param {string} relativePath
 * @param {Record<string, unknown>} manifest
 */
function writeManifest(relativePath, manifest) {
  const path = join(rootDir, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * @param {string} relativePath
 * @returns {Record<string, unknown>}
 */
function readManifest(relativePath) {
  return JSON.parse(readFileSync(join(rootDir, relativePath), "utf8"));
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "stuffs-logger-sync-"));
  for (const relativePath of LOCKSTEP_MANIFESTS) {
    writeManifest(relativePath, makeManifest({ name: relativePath }));
  }
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("syncVersions", () => {
  it("writes the same version into every workspace manifest", () => {
    syncVersions({ version: "1.4.0", rootDir });

    for (const relativePath of LOCKSTEP_MANIFESTS) {
      expect(readManifest(relativePath).version).toBe("1.4.0");
    }
  });

  it("covers the root, both packages and the dashboard", () => {
    expect(LOCKSTEP_MANIFESTS).toEqual([
      "package.json",
      "packages/logger-core/package.json",
      "packages/logger-sdk/package.json",
      "apps/dashboard/package.json",
    ]);
  });

  it("reports every manifest it rewrote", () => {
    const results = syncVersions({ version: "1.4.0", rootDir });

    expect(results).toEqual(
      LOCKSTEP_MANIFESTS.map((path) => ({ path, changed: true })),
    );
  });

  it("is idempotent — a second run rewrites nothing", () => {
    syncVersions({ version: "1.4.0", rootDir });
    const afterFirstRun = LOCKSTEP_MANIFESTS.map((relativePath) =>
      readFileSync(join(rootDir, relativePath), "utf8"),
    );

    const results = syncVersions({ version: "1.4.0", rootDir });

    expect(results.every(({ changed }) => changed === false)).toBe(true);
    expect(
      LOCKSTEP_MANIFESTS.map((relativePath) =>
        readFileSync(join(rootDir, relativePath), "utf8"),
      ),
    ).toEqual(afterFirstRun);
  });

  it("accepts a prerelease version", () => {
    syncVersions({ version: "2.0.0-rc.3", rootDir });

    expect(readManifest("package.json").version).toBe("2.0.0-rc.3");
  });

  it("leaves every other field, and the key order, untouched", () => {
    syncVersions({ version: "1.4.0", rootDir });

    const manifest = readManifest("packages/logger-sdk/package.json");
    expect(Object.keys(manifest)).toEqual([
      "name",
      "version",
      "private",
      "dependencies",
    ]);
    expect(manifest.dependencies).toEqual({
      "@stuffs-logger/core": "workspace:*",
    });
  });

  it("keeps the two-space formatting and trailing newline Prettier expects", () => {
    syncVersions({ version: "1.4.0", rootDir });

    const contents = readFileSync(join(rootDir, "package.json"), "utf8");
    expect(contents).toMatch(/\n {2}"version": "1\.4\.0",\n/);
    expect(contents.endsWith("}\n")).toBe(true);
  });

  it.each([
    ["not-a-version", "an arbitrary string"],
    ["1.4", "a two-part version"],
    ["v1.4.0", "a leading v"],
    ["1.4.0 && rm -rf /", "a shell metacharacter payload"],
    ["", "an empty string"],
  ])("rejects %j — %s", (version) => {
    expect(() => syncVersions({ version, rootDir })).toThrow(
      /Not a valid semver version/,
    );
  });

  it("writes nothing when the version is rejected", () => {
    expect(() => syncVersions({ version: "nope", rootDir })).toThrow();

    for (const relativePath of LOCKSTEP_MANIFESTS) {
      expect(readManifest(relativePath).version).toBe("0.1.0");
    }
  });

  it("names the manifest it could not read", () => {
    rmSync(join(rootDir, "packages/logger-sdk/package.json"));

    expect(() => syncVersions({ version: "1.4.0", rootDir })).toThrow(
      /Could not read manifest packages\/logger-sdk\/package\.json/,
    );
  });
});
