import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepare } from "@semantic-release/changelog";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import releaseConfig, { CHANGELOG_TITLE } from "../release.config.mjs";

const CHANGELOG_PATH = new URL("../CHANGELOG.md", import.meta.url);

/**
 * The changelog plugin's options exactly as release.config.mjs passes them, so
 * these tests exercise the configuration that ships rather than a copy of it.
 *
 * @returns {Record<string, unknown>}
 */
function changelogPluginConfig() {
  const entry = releaseConfig.plugins.find(
    (plugin) =>
      Array.isArray(plugin) && plugin[0] === "@semantic-release/changelog",
  );
  if (!entry) throw new Error("@semantic-release/changelog is not configured");
  return entry[1];
}

/**
 * The plugin writes in place, so every test gets its own copy of the real
 * changelog to write to.
 */
let cwd;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "changelog-"));
  copyFileSync(CHANGELOG_PATH, join(cwd, "CHANGELOG.md"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("CHANGELOG.md", () => {
  it("starts with exactly the header the release config declares", () => {
    // The plugin keeps a header on top only if the file starts with it
    // verbatim; one reworded sentence on either side and every release would
    // be inserted above the header instead of below it.
    const current = readFileSync(CHANGELOG_PATH, "utf8");

    expect(current.startsWith(`${CHANGELOG_TITLE}\n\n`)).toBe(true);
  });

  it("keeps the header on top and inserts a new release directly below it", async () => {
    const before = readFileSync(join(cwd, "CHANGELOG.md"), "utf8").trim();
    const notes = "## 0.2.0 (2026-11-01)\n\n### Features\n\n* **sdk:** example";

    await prepare(changelogPluginConfig(), {
      cwd,
      nextRelease: { notes },
      logger: { log() {} },
    });

    const after = readFileSync(join(cwd, "CHANGELOG.md"), "utf8");
    const history = before.slice(CHANGELOG_TITLE.length).trim();

    expect(after).toBe(`${CHANGELOG_TITLE}\n\n${notes}\n\n${history}\n`);
  });
});
