import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The four security properties every GitHub Actions workflow in this
 * repository must hold, checked against the real files.
 *
 * WHY THIS IS A TEST RATHER THAN A REVIEW NOTE. Each property below is
 * invisible in the diff that breaks it: swapping `pull_request` for
 * `pull_request_target` is one word, widening a top-level `permissions:` is
 * one line, replacing a SHA pin with a tag looks like a version bump, and
 * interpolating `${{ github.event.… }}` into a `run:` block looks like every
 * other expression in the file. Nothing else in `pnpm test`, `pnpm lint` or CI
 * re-checks them, so without this a future workflow edit regresses all four
 * with a green build.
 *
 * PARSED AS TEXT, NOT AS YAML. `js-yaml` is not a dependency of this
 * repository and adding one to run a lint is a poor trade; the four questions
 * asked here are line-shaped, and a text scan cannot be fooled by a YAML
 * feature (an anchor, a merge key, a folded scalar) that a reader of the file
 * would not have noticed either.
 */

const WORKFLOW_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github",
  "workflows",
);

/** How many spaces a line begins with, for the block scanners below. */
function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** A blank or comment-only line belongs to no block. */
function isStructural(line) {
  return line.trim().length > 0 && !line.trim().startsWith("#");
}

/**
 * Every workflow file, read once.
 *
 * @returns {{ name: string, lines: string[] }[]}
 */
function readWorkflows() {
  return readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => ({
      name,
      lines: readFileSync(join(WORKFLOW_DIR, name), "utf8").split("\n"),
    }));
}

/**
 * The body of every `run:` step in a workflow.
 *
 * Handles both spellings: an inline `run: some command`, and a block scalar
 * (`run: |`) whose body is every following line indented past the key.
 *
 * @param {string[]} lines - The workflow's lines.
 * @returns {{ line: number, text: string }[]} One entry per line of shell.
 */
function runBlockLines(lines) {
  const found = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^(\s*)(?:-\s+)?run:(.*)$/.exec(line);
    if (match === null) continue;

    const [, indent, remainder] = match;
    const inline = remainder.trim();

    // `run: |`, `run: >-` and friends open a block; anything else is the
    // command itself, on the key's own line.
    if (inline.length > 0 && !/^[|>][-+]?\d*$/.test(inline)) {
      found.push({ line: index + 1, text: inline });
      continue;
    }

    const keyIndent = indent.length + (/^\s*-\s/.test(line) ? 2 : 0);
    for (let body = index + 1; body < lines.length; body += 1) {
      const bodyLine = lines[body];
      if (!isStructural(bodyLine)) continue;
      if (indentOf(bodyLine) <= keyIndent) break;

      found.push({ line: body + 1, text: bodyLine });
    }
  }

  return found;
}

/**
 * Every `uses:` reference in a workflow.
 *
 * @param {string[]} lines - The workflow's lines.
 * @returns {{ line: number, ref: string }[]}
 */
function usesReferences(lines) {
  const found = [];

  for (const [index, line] of lines.entries()) {
    const match = /^\s*(?:-\s+)?uses:\s*(\S+)/.exec(line);
    if (match === null) continue;

    found.push({ line: index + 1, ref: match[1] });
  }

  return found;
}

/**
 * The workflow-level `permissions:` block — the one at column zero, not a
 * job's.
 *
 * @param {string[]} lines - The workflow's lines.
 * @returns {{ key: string, value: string }[] | undefined} The scopes, or
 *   `undefined` when the workflow declares none at all.
 */
function topLevelPermissions(lines) {
  const start = lines.findIndex((line) => /^permissions:/.test(line));
  if (start === -1) return undefined;

  const scopes = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isStructural(line)) continue;
    if (indentOf(line) === 0) break;

    const match = /^\s*([\w-]+):\s*([\w-]+)/.exec(line);
    if (match !== null) scopes.push({ key: match[1], value: match[2] });
  }

  return scopes;
}

const workflows = readWorkflows();

describe("the workflow files", () => {
  it("are actually being read", () => {
    // Without this, a moved directory or a changed extension would turn every
    // assertion below into a vacuous pass over an empty list — which is the
    // one failure mode a guard test must not have.
    expect(workflows.map((workflow) => workflow.name).sort()).toEqual([
      "ci.yml",
      "release.yml",
      "smoke.yml",
      "verify.yml",
    ]);
  });
});

describe("no workflow is triggered by pull_request_target", () => {
  it.each(workflows)("$name", ({ lines }) => {
    // `pull_request_target` runs in the BASE repository's context — its
    // secrets, a potentially write-scoped token — while `github.head_ref`
    // names code the pull-request author controls. Checking that code out
    // under that token hands a write credential to anyone who can open a pull
    // request. There is no safe combination of the two.
    const offenders = lines
      .map((line, index) => ({ line: index + 1, text: line }))
      .filter(({ text }) => /^\s*pull_request_target\s*:/.test(text));

    expect(offenders).toEqual([]);
  });
});

describe("every workflow defaults to a read-only token", () => {
  it.each(workflows)("$name", ({ lines }) => {
    // A workflow-level write scope is handed to EVERY job in the file,
    // including the ones that run third-party code from the dependency tree.
    // Jobs widen it for themselves; the default never does.
    const scopes = topLevelPermissions(lines);

    expect(scopes).toBeDefined();
    expect(scopes.length).toBeGreaterThan(0);

    for (const { key, value } of scopes ?? []) {
      expect(`${key}: ${value}`).toMatch(/: (read|none)$/);
    }
  });
});

describe("every action is pinned to a commit SHA", () => {
  it.each(workflows)("$name", ({ lines }) => {
    // A tag is a mutable pointer. Once a job holds NPM_TOKEN or a write-scoped
    // token there is no supply-chain difference between GitHub's own action
    // and anybody else's: a moved tag runs new code inside a privileged job
    // either way.
    const unpinned = usesReferences(lines).filter(({ ref }) => {
      // A reusable workflow in this repository is not a third-party action.
      if (ref.startsWith("./")) return false;

      return !/@[0-9a-f]{40}$/.test(ref);
    });

    expect(unpinned).toEqual([]);
  });
});

describe("no run: block interpolates a workflow expression", () => {
  it.each(workflows)("$name", ({ lines }) => {
    // `${{ … }}` inside a `run:` is substituted into the shell script BEFORE
    // the shell sees it, so a value an outside caller controls — a branch
    // name, a pull-request title, a dispatch input — becomes shell source.
    // Values reach `run:` steps through `env:` bindings instead.
    const offenders = runBlockLines(lines).filter(({ text }) =>
      text.includes("${{"),
    );

    expect(offenders).toEqual([]);
  });
});
