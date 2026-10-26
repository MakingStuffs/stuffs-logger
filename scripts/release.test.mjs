import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RELEASE_SCRIPT = fileURLToPath(new URL("./release.sh", import.meta.url));
const REPO_URL = "https://github.com/example/project";

/**
 * Git and the script read their configuration from the environment, so every
 * run gets one that ignores the developer's own git config (signing, hooks,
 * default branch) and the CI runner's own branch name.
 */
const GIT_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: tmpdir(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.test",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.test",
};

/**
 * Every test gets its own throwaway repository: the script reads real git
 * history, so the history is the fixture.
 */
let repoDir;

/** @param {string[]} args */
function git(...args) {
  const result = spawnSync("git", args, {
    cwd: repoDir,
    env: GIT_ENV,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

/** Records a commit with the given message and no file changes. */
function commit(message) {
  git("commit", "--allow-empty", "--quiet", "--message", message);
}

/**
 * Runs `release.sh --dry-run` as if from `branch`.
 *
 * @param {string} branch - The branch name, as CI would report it.
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function dryRun(branch = "main") {
  return spawnSync("bash", [RELEASE_SCRIPT, "--dry-run"], {
    cwd: repoDir,
    env: { ...GIT_ENV, GITHUB_REF_NAME: branch },
    encoding: "utf8",
  });
}

/** The version the dry run would release, read from its summary line. */
function nextTag(branch = "main") {
  const result = dryRun(branch);
  expect(result.stderr).toBe("");
  return /-> (v\S+)/.exec(result.stdout)?.[1];
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "stuffs-logger-release-"));
  git("init", "--quiet", "--initial-branch", "main");
  writeFileSync(
    join(repoDir, "package.json"),
    JSON.stringify({ repository: { url: `git+${REPO_URL}.git` } }),
  );
  git("add", "package.json");
  commit("chore: initial commit");
  git("tag", "v0.1.0");
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("release.sh --dry-run", () => {
  it("releases a patch for a fix", () => {
    commit("fix(sdk): flush on unload");

    expect(nextTag()).toBe("v0.1.1");
  });

  it("releases a patch for a performance improvement", () => {
    commit("perf: faster facet query");

    expect(nextTag()).toBe("v0.1.1");
  });

  it("releases a patch for a revert, under its own heading", () => {
    commit("revert: undo the facet index");

    expect(nextTag()).toBe("v0.1.1");
    expect(dryRun().stdout).toContain("### Reverts\n\n* undo the facet index");
  });

  it("releases a minor for a feature, however many fixes come with it", () => {
    commit("fix: one");
    commit("feat(dashboard): admin screens");
    commit("fix: two");

    expect(nextTag()).toBe("v0.2.0");
  });

  it("releases nothing when no commit is release-worthy", () => {
    commit("chore: bump a dependency");
    commit("docs: reword the readme");
    commit("not a conventional commit at all");

    const result = dryRun();

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/nothing to release/);
  });

  it("counts only the commits since the last stable tag", () => {
    commit("feat: already released");
    git("tag", "v0.2.0");
    commit("fix: after the release");

    expect(nextTag()).toBe("v0.2.1");
  });

  describe("breaking changes", () => {
    beforeEach(() => {
      commit("chore: past 0.x");
      git("tag", "v1.2.3");
    });

    it("bumps the major for a `!` after the type", () => {
      commit("feat!: drop the v1 ingest route");

      expect(nextTag()).toBe("v2.0.0");
    });

    it("bumps the major for a `!` after a scope", () => {
      commit("fix(sdk)!: rename the transport option");

      expect(nextTag()).toBe("v2.0.0");
    });

    it("bumps the major for a BREAKING CHANGE footer", () => {
      commit(
        "refactor: move the schemas\n\nBREAKING CHANGE: import from @stuffs/logger-core/schemas",
      );

      expect(nextTag()).toBe("v2.0.0");
    });

    it("accepts the hyphenated BREAKING-CHANGE footer", () => {
      commit("feat: new config\n\nBREAKING-CHANGE: `endpoint` is required");

      expect(nextTag()).toBe("v2.0.0");
    });

    it("does not treat the phrase inside a sentence as a footer", () => {
      commit("fix: wording\n\nThis avoids a BREAKING CHANGE: nothing moved.");

      expect(nextTag()).toBe("v1.2.4");
    });

    it("lists the breaking change, using the footer's text when there is one", () => {
      commit("feat(sdk)!: drop Node 20");
      commit("refactor: move it\n\nBREAKING CHANGE: import from /schemas");

      const { stdout } = dryRun();

      expect(stdout).toContain("### ⚠ BREAKING CHANGES");
      expect(stdout).toContain("* **sdk:** drop Node 20\n");
      expect(stdout).toContain("* import from /schemas\n");
    });
  });

  it("bumps the minor, not the major, for a breaking change while on 0.x", () => {
    commit("feat!: new wire format");

    expect(nextTag()).toBe("v0.2.0");
  });

  it("writes the notes grouped by kind, with scopes and commit links", () => {
    commit("feat(sdk): batched transport");
    commit("fix: count bytes, not characters");
    const sha = git("rev-parse", "HEAD");

    const { stdout } = dryRun();

    expect(stdout).toMatch(/^## 0\.2\.0 \(\d{4}-\d{2}-\d{2}\)$/m);
    expect(stdout).toContain("### Features\n\n* **sdk:** batched transport");
    expect(stdout).toContain(
      `### Bug Fixes\n\n* count bytes, not characters ([${sha.slice(0, 7)}](${REPO_URL}/commit/${sha}))`,
    );
    expect(stdout).not.toContain("### Performance Improvements");
  });

  describe("on an -rc branch", () => {
    beforeEach(() => {
      git("switch", "--quiet", "--create", "next-rc");
      commit("feat: something new");
    });

    it("releases the first prerelease of the next version on the rc dist-tag", () => {
      const { stdout } = dryRun("next-rc");

      expect(stdout).toContain("v0.1.0 -> v0.2.0-rc.1 (npm dist-tag: rc)");
    });

    it("numbers past the prereleases already tagged", () => {
      git("tag", "v0.2.0-rc.1");
      git("tag", "v0.2.0-rc.2");
      commit("fix: follow-up");

      expect(nextTag("next-rc")).toBe("v0.2.0-rc.3");
    });

    it("measures from the last stable tag, not the last prerelease", () => {
      git("tag", "v0.2.0-rc.1");
      commit("fix: only a fix since rc.1");

      expect(nextTag("next-rc")).toBe("v0.2.0-rc.2");
    });
  });

  it("refuses a branch that is neither main nor *-rc", () => {
    commit("fix: something");

    const result = dryRun("feature/x");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/main or a \*-rc branch/);
  });

  it("refuses to guess a baseline when there is no stable tag", () => {
    git("tag", "--delete", "v0.1.0");
    commit("feat: anything");

    const result = dryRun();

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no stable vX\.Y\.Z tag/);
  });

  it("refuses to publish outside CI", () => {
    commit("fix: something");

    const result = spawnSync("bash", [RELEASE_SCRIPT], {
      cwd: repoDir,
      env: { ...GIT_ENV, GITHUB_REF_NAME: "main" },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/CI only/);
  });
});
