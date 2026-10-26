/**
 * semantic-release configuration.
 *
 * The version is computed from the Conventional Commits already in this
 * repository's history — there are no changeset files and no hand-edited
 * version numbers anywhere. `scripts/sync-versions.mjs` then writes that one
 * version into all four manifests, so the root, both published packages and
 * the dashboard always agree.
 *
 * Run `pnpm release:dry-run` to see what the next release would be without
 * touching npm, git or GitHub.
 *
 * @type {import("semantic-release").GlobalConfig}
 */
export default {
  /**
   * `main` cuts stable releases. Any branch whose name ends in `-rc` cuts
   * `x.y.z-rc.N` prereleases on the `rc` dist-tag, so `pnpm add
   * @stuffs-logger/sdk` keeps resolving to the stable line until someone
   * explicitly asks for `@rc`.
   *
   * The prerelease identifier is spelled out rather than derived, because a
   * glob has no single name to derive it from.
   */
  branches: ["main", { name: "*-rc", channel: "rc", prerelease: "rc" }],

  plugins: [
    ["@semantic-release/commit-analyzer", { preset: "conventionalcommits" }],
    [
      "@semantic-release/release-notes-generator",
      { preset: "conventionalcommits" },
    ],
    ["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],

    /**
     * `${nextRelease.version}` is a semantic-release template, not a shell
     * variable: semantic-release renders it before the command runs. It is
     * always a version semantic-release itself computed, never anything read
     * out of a commit — and `sync-versions.mjs` re-validates it against the
     * SemVer grammar before writing a byte, because a value interpolated into
     * a shell command deserves to be checked at the far end too.
     *
     * WHICH STEP EACH COMMAND RUNS IN IS THE POINT. semantic-release's order
     * is verifyConditions → prepare → (the `@semantic-release/git` commit,
     * then the TAG, then the push) → publish. Anything that fails after the
     * tag has been pushed leaves a `vX.Y.Z` in git that npm never received,
     * and semantic-release will not re-run a version it can see a tag for —
     * so every failure that can be moved in front of the tag is:
     *
     *   - `verifyConditionsCmd` exercises the npm credential FIRST, before a
     *     byte is written. There is no `@semantic-release/npm` in this chain
     *     (it cannot publish a pnpm workspace), so without this the token is
     *     first used by the publish itself — after the tag. `pnpm whoami`
     *     fails closed (`ERR_PNPM_WHOAMI_UNAUTHORIZED`) when the token is
     *     missing, expired or revoked, and the run stops with nothing tagged.
     *     It needs a token: if `NPM_TOKEN` is retired for npm trusted
     *     publishing (docs/CI-CD.md), there is no credential to exercise and
     *     this line becomes `test -n "$ACTIONS_ID_TOKEN_REQUEST_URL"` — the
     *     check that the job was granted `id-token: write`.
     *   - `prepareCmd` syncs the versions, BUILDS, and audits the tarballs
     *     with `scripts/verify-pack.mjs` — all before the release commit and
     *     the tag exist, so a broken build or a tarball missing an entry
     *     point fails a run that can simply be re-run. `dist/` is gitignored,
     *     so building here changes nothing `@semantic-release/git` commits.
     *   - `publishCmd` is the publish and nothing else: the one step that
     *     cannot be moved in front of the tag, with everything that could
     *     fail already behind it.
     *
     * The tarball's `dist/` can only ever be the code being released, because
     * the build runs in this same job from the verified commit. npm
     * credentials come from the environment (`NODE_AUTH_TOKEN` via the
     * runner's `.npmrc`); nothing here reads or writes a token, and no
     * lifecycle script in either package does either.
     *
     * `--provenance` attaches a signed SLSA attestation naming the workflow,
     * the repository and the commit a version was built from — which is what
     * turns a stolen `NPM_TOKEN` from a silent compromise into a visible one,
     * because a version published from anywhere else carries no attestation.
     * It needs `id-token: write` on the release job (release.yml) and
     * `--access public`, both of which are set. Undocumented in
     * `pnpm publish --help` on the installed pnpm 11.22.0 but accepted:
     * `provenance` is in its npm-config option table and it bundles
     * libnpmpublish 11.2.0, which reads `opts.provenance`. Confirm it took on
     * the first rc: `npm view @stuffs-logger/sdk@<version> dist.attestations`
     * (docs/CI-CD.md has the fallback if it did not).
     */
    [
      "@semantic-release/exec",
      {
        verifyConditionsCmd:
          "pnpm whoami --registry https://registry.npmjs.org",
        prepareCmd:
          "node scripts/sync-versions.mjs ${nextRelease.version} && " +
          "pnpm --filter @stuffs-logger/core --filter @stuffs-logger/sdk build && " +
          "node scripts/verify-pack.mjs",
        publishCmd:
          "pnpm --filter @stuffs-logger/core --filter @stuffs-logger/sdk publish " +
          "--access public --provenance --no-git-checks " +
          "--tag ${nextRelease.channel || 'latest'}",
      },
    ],

    /**
     * Commits the bumped manifests and the changelog back to the release
     * branch. This is what keeps the repository's own versions in step with
     * what was published, and it is why the release job needs `contents:
     * write` and why `main` must allow this actor to push.
     *
     * `@semantic-release/git` must stay last among the `prepare` plugins:
     * everything above it edits files, and this is what commits them.
     */
    [
      "@semantic-release/git",
      {
        assets: [
          "CHANGELOG.md",
          "package.json",
          "packages/logger-core/package.json",
          "packages/logger-sdk/package.json",
          "apps/dashboard/package.json",
        ],
        message:
          "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],

    "@semantic-release/github",
  ],
};
