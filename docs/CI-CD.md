# CI/CD, testing and releases

Everything the pipeline does, everything a maintainer has to configure once,
and how to run each suite on your own machine.

> Deploying the dashboard is a separate document — see
> [`DEPLOYMENT.md`](./DEPLOYMENT.md). This repository publishes packages; it
> does not deploy the dashboard.

## The workflows

| File                            | Trigger                                               | What it does                                                                   |
| ------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `.github/workflows/ci.yml`      | `pull_request`; `push` to `main` and `*-rc`           | Runs the whole verification suite, and auto-formats same-repo PRs.             |
| `.github/workflows/verify.yml`  | `workflow_call` only — never on its own               | Format, lint, types, unit tests, build, tarball audit, e2e and smoke.          |
| `.github/workflows/release.yml` | `push` to `main` and `*-rc`                           | Verifies, then runs `scripts/release.sh`: version, build, audit, tag, publish. |
| `.github/workflows/smoke.yml`   | `workflow_dispatch` with a URL input; `workflow_call` | Runs the `@smoke` subset against a deployed origin.                            |

`.github/dependabot.yml` is not a workflow but belongs in the list: it opens
the weekly pull requests that move the action pins and the lockfile (see
"Action pinning").

`verify.yml` is a **reusable** workflow rather than a copy of the same steps in
two files. That is what makes "a release runs exactly the checks the pull
request ran" true by construction instead of by convention — there is only one
definition of those checks and both entry points call it.

### Jobs

`verify.yml`

| Job      | Runs                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static` | `pnpm format:check`, `pnpm lint`, `pnpm typecheck`                                                                                                                                                                                                                                                                                                                                  |
| `unit`   | `pnpm test:unit`                                                                                                                                                                                                                                                                                                                                                                    |
| `build`  | `pnpm build`, then `pnpm release:verify-pack` (packs both published packages and audits the tarballs offline)                                                                                                                                                                                                                                                                       |
| `e2e`    | `pnpm test:e2e --project=smoke` — the e2e **and** smoke projects in one Playwright run, against a Postgres **service container**, with `prisma migrate deploy` applied and the fixtures seeded. One invocation means one `next build` and one `next start`; the smoke project waits for `migrate` in exactly this case (see `smokeTargetsManagedServer` in `playwright.config.ts`). |

`ci.yml`

| Job            | Runs                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `verify`       | Calls `verify.yml`.                                                                                                                 |
| `format-patch` | Runs Prettier on the pull request's code and uploads the resulting patch. Holds no credential.                                      |
| `auto-format`  | Applies that patch — never to anything under `.github/` — and pushes it to the PR branch. Holds `contents: write`, runs no PR code. |

`release.yml`

| Job       | Runs                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `verify`  | Calls `verify.yml`. The release job `needs:` it.                                                                       |
| `release` | `scripts/release.sh`, from an install of **only** `@stuffs/logger-core` and `@stuffs/logger`, with no install scripts. |
| `smoke`   | Calls `smoke.yml`, only when the `SMOKE_BASE_URL` variable is set.                                                     |

### Badges

```markdown
[![CI](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/ci.yml/badge.svg)](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/ci.yml)
[![Release](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/release.yml/badge.svg)](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/release.yml)
[![Smoke](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/smoke.yml/badge.svg)](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/smoke.yml)
```

`verify.yml` has no badge of its own: it never runs standalone, so its badge
would always read "no status".

## What a maintainer must configure

### Before the first release — the checklist

Everything in this list is repository or registry **configuration**, not
code, and none of it is checked by CI. Until it is done, **any collaborator
with write access who pushes a branch named `anything-rc` publishes to npm
under this project's name, and so does the first merge to `main`.** Each item
is expanded in its own section below.

1. **Protect the `npm-publish` environment** (Settings → Environments →
   `npm-publish`): at least one required reviewer; deployment branches and
   tags limited to `main` and `*-rc`. See "The `npm-publish` environment".
2. **Restrict who may create `*-rc` branches** with a ruleset (Settings →
   Rules): restrict creations and updates on the pattern `*-rc` to a named
   bypass list of maintainers. See "A ruleset restricting `*-rc` branches".
3. **Tag the baseline before the first release.** The release script measures
   from the last stable `vX.Y.Z` tag reachable from the branch, and refuses to
   run when there is none rather than guess a starting version. Tag first and
   push the tag:

   ```sh
   git tag v0.1.0 <the commit that is 0.1.0> && git push origin v0.1.0
   ```

   **Decided: the 0.x line continues.** `CHANGELOG.md` already carries a
   hand-written `0.1.0` entry, so tag the commit that added it (or any later
   commit already on `main`). The tag must be reachable from `main`: a tag on
   a branch commit that was later squash- or rebase-merged sits outside
   `main`'s history and the script will not find it.

   See "Release channels" and `FOLLOW-UPS.md` §9.

4. **Create the packages on npm and trust this workflow** — one hand publish
   of `0.1.0` with your own 2FA, then a trusted publisher on each package. No
   npm token is ever stored. See "npm credentials".
5. **Let the release actor push to `main`** — a bypass for the release actor,
   or a token that holds one. See "Branch protection on `main`".
6. **After the first CI publish, confirm provenance took**:
   `npm view @stuffs/logger@<version> dist.attestations`. See "npm
   credentials" for what to do if it prints nothing.

### Secrets

| Secret              | Required               | Used by                         | Notes                                                                                                                                                                                                                                       |
| ------------------- | ---------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`      | Provided automatically | `release.yml`                   | Authenticates the version commit's push (passed to that one `git push` as a header; the checkout persists no credential) and, through `gh`, creates the GitHub Release.                                                                     |
| `FORMAT_PUSH_TOKEN` | Optional — see below   | `ci.yml`, the `auto-format` job | A fine-grained PAT or GitHub App installation token with `contents: write` on this repository, **no branch-protection bypass** and **no Workflows permission**. It must be a different credential from any release token that has a bypass. |

There is no npm secret: publishing authenticates through the release job's
OIDC identity (see "npm credentials"). No other job in any workflow receives a
secret, and no workflow ever echoes,
prints or writes one to an artifact.

### Repository variables

| Variable         | Required | Effect                                                                                                                                                             |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SMOKE_BASE_URL` | No       | When set, `release.yml` runs the smoke suite against this origin after a successful publish. Leave it unset if the dashboard is not deployed from this repository. |

It is a **variable**, not a secret: a public origin is not one, and putting it
in `secrets` would only make the logs harder to read.

### The `npm-publish` environment — REQUIRED before the first release

`release.yml`'s `release` job declares `environment: npm-publish`. That key
alone changes nothing: it binds the job to an environment, and the **gating is
repository configuration**. Until the following is done, publishing to the
public `@stuffs` scope is reachable by anyone with repository **write**
access, which is a strictly lower privilege — push a branch named
`anything-rc` and `release.yml` publishes it under the maintainer's npm
identity as `x.y.z-rc.N`, on the `rc` dist-tag, unreplaceably. `needs: verify`
is not a control against that actor, because the same push supplies the code
and the tests that verify it.

Settings → Environments → **New environment**, named `npm-publish`:

1. **Required reviewers** — at least one maintainer. This is the control. Every
   release run then waits for a human before the publish job starts.
2. **Deployment branches and tags** — restrict to `main` and `*-rc`, so no
   other ref can run a job in this environment. npm's trusted publisher names
   the environment too, so a job outside it cannot publish at all.

### A ruleset restricting `*-rc` branches — REQUIRED

Settings → Rules → **New ruleset**, targeting the branch pattern `*-rc`:

- **Restrict creations** and **restrict updates** to a named bypass list of
  maintainers.

Without it, the `*-rc` release channel is open to every collaborator with
write access. The environment above is the credential gate; this is the trigger
gate, and they close different halves of the same hole.

### npm credentials: trusted publishing, and no token

There is **no npm token**, in GitHub or anywhere else. The release job
publishes through npm **trusted publishing**: npm exchanges the OIDC identity
GitHub mints for the job (`id-token: write`) for a short-lived publish token,
and only when that identity matches the trusted publisher configured on the
package. "Who may publish" is then a property of this repository, this
workflow file and this environment, not of whoever can read a secret.

**Creating the packages — once, by hand.** A trusted publisher is configured
from a package's own settings page, so the package has to exist first. Publish
the baseline `0.1.0` from your own machine, authenticated by your own npm
login and 2FA — no automation token, no 2FA bypass:

```sh
npm login                                  # your account, with 2FA
git checkout main && git pull              # before the first CI release: still 0.1.0
pnpm install
pnpm release:verify-pack                   # builds, packs and audits both tarballs
pnpm --filter @stuffs/logger-core --filter @stuffs/logger \
  publish --access public --no-git-checks  # prompts for a one-time password
```

That `0.1.0` carries no provenance — it was not built by CI — and is the only
version that ever will.

**Then trust this workflow**, for **each** package — `@stuffs/logger-core` and
`@stuffs/logger` — under _Package settings → Trusted publisher → GitHub
Actions_, with exactly these values:

| Field                | Value           |
| -------------------- | --------------- |
| Organization or user | `MakingStuffs`  |
| Repository           | `stuffs-logger` |
| Workflow filename    | `release.yml`   |
| Environment name     | `npm-publish`   |

The workflow filename is the file's **name**, not its path, and the
environment must match `release.yml`'s `environment.name` character for
character — npm compares both against the OIDC token's claims and refuses on
a mismatch. npm expects a new trusted publisher's **first publish within two
days**, so configure it when a release is about to go out.

**Checked before the tag.** With no token there is nothing for `npm whoami`
to exercise, so `scripts/release.sh` performs the trusted-publishing exchange
itself, for both packages, before it writes anything. A package whose trusted
publisher is missing or names the wrong repository, workflow or environment
fails the run there, with nothing tagged — not at the publish, after the tag.

**Provenance, and confirming it took.** Under trusted publishing every CI
publish carries a signed SLSA attestation naming the workflow, repository and
commit it was built from; `scripts/release.sh` also passes `--provenance`
explicitly. After the first CI publish, check that it is really there:

```sh
npm view @stuffs/logger@<version> dist.attestations
```

If that prints nothing, pnpm's publish did not attach provenance on this
toolchain. Publish the packed tarballs with npm itself (npm 11.5.1 or later):
replace the `pnpm … publish` command in `scripts/release.sh` with

```bash
TARBALLS="${RUNNER_TEMP}/tarballs"
mkdir -p "$TARBALLS"
pnpm -C packages/logger-core pack --pack-destination "$TARBALLS"
pnpm -C packages/logger-sdk pack --pack-destination "$TARBALLS"
npm publish "$TARBALLS"/stuffs-logger-core-*.tgz --access public --provenance --tag "$DIST_TAG"
npm publish "$TARBALLS"/stuffs-logger-[0-9]*.tgz --access public --provenance --tag "$DIST_TAG"
```

Core before SDK, because the SDK pins the core at the exact version being
released. `pnpm pack` applies `publishConfig` and rewrites `workspace:*`
exactly as `pnpm publish` does, so the tarballs are the ones
`scripts/verify-pack.mjs` audited before the tag.

### Branch protection on `main`

The release **commits back to the branch**: `scripts/release.sh` pushes
`CHANGELOG.md` plus all four `package.json` files with the message
`chore(release): <version> [skip ci]`, together with the tag.

That means the release actor must be allowed to push directly to `main`. If
`main` requires pull requests, the default `GITHUB_TOKEN` **cannot** push and
every release will fail at the `git push`. Pick one:

- add a bypass allowance for the release actor, or
- give the release job a PAT or GitHub App token that holds the bypass.

`[skip ci]` is already in the release commit's message, so the push does not
retrigger the pipeline.

### The Actions write permission the format job needs

Settings → Actions → General → Workflow permissions must allow
`GITHUB_TOKEN` to be granted write scopes. The workflows themselves default to
`contents: read` and only the `auto-format` and `release` jobs widen it, so
selecting "Read repository contents and packages permissions" as the default is
correct and sufficient — the per-job `permissions:` blocks do the widening.

## The auto-format jobs, and the one wrinkle in them

`ci.yml` formats a pull request and pushes the fix back, in **two jobs**:

| Job            | Holds                                          | Runs                                                        |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| `format-patch` | `contents: read`, no secret, no git credential | The PR's own code — `pnpm install`, `prettier --write .`    |
| `auto-format`  | `contents: write`, `FORMAT_PUSH_TOKEN`         | `git apply`, `git commit`, `git push` — nothing from the PR |

**The split is the security design, not an organisational one.** Formatting a
branch means running the branch's code: `pnpm install` resolves the branch's
lockfile, and Prettier discovers and executes whatever `prettier.config.mjs`
and `plugins` the branch adds. In a single job that also held the push
credential, a collaborator with repository write access — the only actor who
can open a same-repo pull request — would have arbitrary code execution beside
a write token, and could exfiltrate it or simply append a directory containing
their own `git` to `$GITHUB_PATH` for the push step to run. Where
`FORMAT_PUSH_TOKEN` carried a branch-protection bypass, that would escalate
repository write into a direct push to `main`, which triggers `release.yml`.

So `format-patch` runs that code holding nothing, checks out with
`persist-credentials: false`, installs with `--ignore-scripts` (a branch can
otherwise pair a `pnpm-workspace.yaml` build-allowlist change with a lockfile
change to authorise a dependency's install script), and its only output is
`format.patch` — `git diff` over the tracked files Prettier rewrote.
`auto-format` downloads that patch and applies it with
`git apply --index --exclude='.github/**'`, which stages exactly the paths in
the patch and nothing else; there is no `git add --all`. **The exclusion is
load-bearing**: the patch is pull-request-authored data applied blind by a job
that holds a write token, and without it a "formatting fix" could rewrite a
workflow file and push it under the bot's identity. Workflow files are
formatted by their authors; a patch that touched only `.github/` leaves
nothing staged and the job stops there, saying so in the step summary.

**`FORMAT_PUSH_TOKEN` must be scoped to `contents: write` on this repository,
must NOT carry a branch-protection bypass, and must NOT carry the `Workflows`
permission.** The last one is the GitHub-side half of the `--exclude` above:
GitHub refuses a push that changes `.github/workflows/` from a credential
without that permission, so even a bug in this job cannot land a workflow
edit. It is therefore a different credential from any release token that does
carry a bypass (see "Branch protection on `main`" below). It is optional;
without it the job falls back to the default `GITHUB_TOKEN`.

Three guards, all load-bearing, and repeated verbatim on both jobs:

1. **`pull_request`, never `pull_request_target`.** `pull_request_target` runs
   in the base repository's context — with its secrets and a potentially
   write-scoped token — while the code being checked out is the pull-request
   author's. Combining the two hands a write credential to anyone who can open
   a pull request.
2. **Same-repository pull requests only**
   (`github.event.pull_request.head.repo.full_name == github.repository`). A
   fork's pull request never reaches the `contents: write` token.
3. **Not a bot** (`!endsWith(github.actor, '[bot]')`), so the job's own push
   cannot retrigger it into a loop.

`contents: write` is held by `auto-format` alone; the workflow default is
`contents: read`.

**The wrinkle.** GitHub deliberately does not trigger workflow runs for pushes
made with the default `GITHUB_TOKEN`. So out of the box the formatting fix
lands on the branch, but the `format:check` that failed in the _same_ run stays
failed — it was evaluated against the commit before the fix. The pull request
goes green as soon as any further commit is pushed.

If you want it to go green on its own, configure `FORMAT_PUSH_TOKEN`. The push
then produces a `synchronize` event, CI runs again on the fixed commit, and the
second run finds nothing to format and pushes nothing — so it converges rather
than looping.

**Fork contributors** cannot be auto-formatted at all, by design. They run:

```sh
pnpm format
```

and push. `format:check` is a hard gate in `verify.yml` precisely so that path
still fails loudly.

## Action pinning

**Every action is pinned to a full commit SHA, with the version in a trailing
comment** — including the first-party `actions/*` ones:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

A tag is a mutable pointer. Once a job can publish to npm or holds a
write-scoped token, there is no supply-chain difference between GitHub's own action and
anybody else's: a moved tag runs new code inside a privileged job either way.
Applying one rule everywhere also means a reviewer never has to decide which
actions "count".

The Postgres service container is pinned by image **digest** for the same
reason.

Bumping a pin means changing the SHA and the comment together.
`.github/dependabot.yml` does that for you: its `github-actions` entry
understands SHA pins with version comments and moves both in one pull request,
weekly. The same file keeps the lockfile current — weekly, at most five open
pull requests, minor and patch bumps grouped into one — with a one-day
`cooldown` that matches pnpm's `minimumReleaseAge` (see "Node and pnpm
versions"), so Dependabot never proposes a version pnpm would then refuse.

### The invariants are tested, not just reviewed

`scripts/workflow-invariants.test.mjs` runs in `pnpm test` (the root Vitest
suite collects `scripts/**/*.test.mjs`) and asserts five properties against the
real files in `.github/workflows/`:

1. No workflow is triggered by `pull_request_target`.
2. Every workflow declares a top-level `permissions:` block, and every scope in
   it is `read` or `none`.
3. Every job-level `permissions:` block spells its scopes out — never
   `write-all` or `read-all` — and names only scopes a job here can use:
   `contents`, `issues`, `pull-requests`, `id-token`.
4. Every `uses:` is pinned to a 40-character commit SHA (local reusable
   workflows excepted).
5. No `run:` block contains a `${{ … }}` expression.

Each of those is invisible in the diff that breaks it — one word, one line, or
something that looks like a version bump — so they are a test rather than a
review note.

## Node and pnpm versions

- **pnpm is read from the manifest.** `pnpm/action-setup` is used without a
  `version` input, so it takes the version from the root `packageManager` field
  (`pnpm@11.22.0`). There is no second source of truth to keep in step.
- **Node is pinned to `24` in the workflows**, deliberately not read from
  `engines.node`. That field is the _range_ `">=22"`, and resolving a range in
  CI means the pipeline silently moves to whatever Node is newest. 24 is the
  active LTS line.

Installs use `pnpm install --frozen-lockfile` everywhere, and the pnpm store is
cached by `actions/setup-node`'s `cache: pnpm`, keyed on `pnpm-lock.yaml`. The
release job alone installs a **filtered** workspace — the core and the SDK,
with `--ignore-scripts` — because it is the job that holds the npm
credential and nothing in a release needs the dashboard's Next.js, Prisma or
Playwright trees (see `release.yml`).

Three pnpm 11 behaviours are worth knowing, because each one looks like a bug
the first time it is met:

- **Every install re-verifies the lockfile against `minimumReleaseAge`.** The
  line `Verifying lockfile against supply-chain policies (N entries)` is pnpm
  fetching each locked package's publish time and refusing any version under
  24 hours old. `pnpm-workspace.yaml` sets 1440 minutes **explicitly**, and
  although that is also pnpm 11's default, writing it down is not a no-op: an
  explicit value switches pnpm into its _strict_ handling, where an immature
  version fails the install (and `pnpm add` asks for approval locally) instead
  of being silently resolved to an older one and ignored in the lockfile. The
  re-check needs the registry: **an offline `pnpm install` fails** with
  `ERR_PNPM_NO_OFFLINE_META` unless pnpm has a cached verdict for this exact
  lockfile and policy, or `--trust-lockfile` is passed to skip the re-check.
  CI does not pass it — the re-check is what catches a hand-edited lockfile.
- **`pnpm run` may install first.** pnpm 11's `verifyDepsBeforeRun` defaults
  to `install`: before any script it compares `node_modules` with the
  lockfile, the workspace settings (`allowBuilds` and the release-age keys
  among them) and each workspace package's name and version, and reinstalls
  when they differ. Editing `pnpm-workspace.yaml` therefore triggers an
  install on the next `pnpm <script>`; run `pnpm install` yourself after
  editing it rather than being surprised mid-script. `release.yml` switches
  the check off for the release job (`pnpm_config_verify_deps_before_run`),
  because `sync-versions.mjs` rewrites the versions mid-release and the
  reinstall it would trigger is unfiltered and runs install scripts.
- **`allowBuilds` is the install-script allowlist.** Nothing runs a
  dependency's `postinstall` unless it is named there, so every entry is a
  package handed code execution on every machine. `sharp` was removed from it
  because, as an optional dependency of `next` that ships prebuilt binaries,
  it has had no install script since 0.33 — an entry for a package with
  nothing to run is a standing authorisation for whatever a future version
  adds.

## Release channels

| Branch | Version      | npm dist-tag | git tag       |
| ------ | ------------ | ------------ | ------------- |
| `main` | `x.y.z`      | `latest`     | `vX.Y.Z`      |
| `*-rc` | `x.y.z-rc.N` | `rc`         | `vX.Y.Z-rc.N` |

All four manifests move in lockstep — the root, both published packages and the
dashboard — via `scripts/sync-versions.mjs`, which the release script calls.

### How the version is chosen

`scripts/release.sh` reads every non-merge commit since the last stable tag
reachable from the branch (`git describe --exclude 'v*-*'`) and takes the
largest bump any of them asks for:

| Commit                                                                                                                 | Bump                 |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `!` before the colon (`feat!:`, `fix(sdk)!:`), or a line in the body starting `BREAKING CHANGE:` or `BREAKING-CHANGE:` | major (minor on 0.x) |
| `feat:`                                                                                                                | minor                |
| `fix:`, `perf:`, `revert:`                                                                                             | patch                |
| anything else, including a subject that is not a Conventional Commit                                                   | none                 |

If nothing asks for a bump, the run exits cleanly without releasing. On an
`-rc` branch the same calculation gives the next stable version, and the
release is that version's next unused `-rc.N`.

**While the version is `0.x`, a breaking change bumps the minor**, so the
first breaking change after `0.1.0` releases `0.2.0`, not `1.0.0`. Leaving
`0.x` is a deliberate step the script never takes on its own.

### What happens, in order

The script is ordered so that **everything that can fail does so before the
git tag exists**. A tag with no matching npm version is the one state a re-run
cannot repair: the next run measures from that tag and sees nothing to release.

| Step           | What runs                                                                                           | If it fails                                               |
| -------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Checks         | CI only, `GITHUB_TOKEN` set, clean tree, then the npm trusted-publishing exchange for both packages | Nothing written. A trusted-publisher mismatch stops here. |
| Prepare        | `sync-versions.mjs`, the changelog entry, the core and SDK **build**, `verify-pack.mjs`             | Nothing committed. Re-run after fixing.                   |
| Commit and tag | `chore(release): <version> [skip ci]` and an annotated `vX.Y.Z`, locally                            | Nothing pushed. Re-run after fixing.                      |
| Push           | `git push --atomic` of the commit and the tag — both land, or neither                               | Nothing published. Re-run after fixing.                   |
| Publish        | `pnpm publish` of both packages, then `gh release create`                                           | The only step after the tag. See below.                   |

`dist/` is gitignored, so building before the commit changes nothing the
commit contains.

**If the publish fails after the push**, the tag exists and the next run will
not retry it. Publish that version by hand from the tagged commit
(`git checkout vX.Y.Z`, build, then the same `pnpm … publish` command the
script runs), then create the GitHub Release with
`gh release create vX.Y.Z --verify-tag`.

To rehearse without publishing anything:

```sh
pnpm release:verify-pack # builds, packs and audits both tarballs; offline
pnpm release:dry-run     # prints the next version and its changelog entry;
                         # needs the tags locally (`git fetch --tags`)
```

## Testing

### The three suites

| Command           | Runs                                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| `pnpm test`       | The unit suites. Unchanged meaning; everything that depended on it still works. |
| `pnpm test:unit`  | Alias of `pnpm test`, so the three suites read as a set.                        |
| `pnpm test:e2e`   | Builds the SDK, then runs the Playwright suite (Chromium).                      |
| `pnpm test:smoke` | Runs the `@smoke` subset against `SMOKE_BASE_URL`.                              |

### The collection boundary

**`*.test.ts` / `*.test.tsx` belongs to Vitest. `*.spec.ts` and `*.setup.ts`
belong to Playwright.** Neither runner can see the other's files:

- `apps/dashboard/vitest.config.mts` includes `src/**/*.test.{ts,tsx}` and
  `e2e/**/*.test.ts`.
- `apps/dashboard/playwright.config.ts` has `testDir: "./e2e"` and
  `testMatch: /.*\.(spec|setup)\.ts$/`.

A Playwright spec named `*.test.ts` would be run by Vitest, in jsdom, with no
browser — so the extension is not a style choice.

The harness's own pure logic (the seeded-data contract, the seeding
orchestration, the environment rules, the Better Auth credential shape) is
unit-tested by Vitest with no database and no browser, in
`apps/dashboard/e2e/support/*.test.ts`.

### Running the e2e suite locally

**1. Bring up a disposable Postgres.** One container, and nothing else in this
repository needs Docker:

```sh
docker run --rm -d --name stuffs-logger-e2e -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=stuffs_logger_e2e postgres:17-alpine
```

Or, against a Postgres you already run:

```sh
createdb stuffs_logger_e2e
```

**2. Point the suite at it.**

```sh
cp apps/dashboard/.env.e2e.example apps/dashboard/.env.e2e
# edit E2E_DATABASE_URL if your connection string differs
```

`.env.e2e` is gitignored and loaded automatically by the test scripts via
Node's own `--env-file-if-exists`. Anything already in the environment wins,
which is how CI supplies its own values.

### The e2e database is an explicit opt-in, and it is enforced

`E2E_DATABASE_URL` is **required**, and the harness does **not** fall back to
`DATABASE_URL`. Five rules are checked in `resolveDatabaseTarget`
(`apps/dashboard/e2e/support/env.ts`) before anything is written, in this
order, and each one refuses the run with a message naming what to fix:

| Rule                                                                                          | Why                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_DATABASE_URL` must be set; the ambient `DATABASE_URL` is never used.                     | `DATABASE_URL` is exported as a matter of course in containers, in CI, by direnv and on a server. Naming the database in its own variable is the opt-in that says "this one is disposable".                                                                                                                                  |
| `NODE_ENV` must not be `production`.                                                          | There is no production environment in which seeding fixture accounts and deleting log rows is the intent.                                                                                                                                                                                                                    |
| Its database **name** must not contain `prod`, `production` or `live` as a whole word.        | Checked **before** the allow rule below, because the two overlap: `production-test` and `prod_e2e_replica` both contain a whole-word `test`/`e2e` and would otherwise pass. `product_e2e` is fine — the match is whole-word.                                                                                                 |
| Its database **name** must contain `e2e` or `test` as a whole word.                           | The variable can still be pointed at the wrong thing. `stuffs_logger_e2e` and `logger-test` pass; `stuffs_logger` and `latest` do not.                                                                                                                                                                                       |
| Its **host** must be `127.0.0.1`, `localhost` or `::1`, unless `E2E_ALLOW_REMOTE_DATABASE=1`. | A name check is a check on what was typed; this is a check on where the bytes go. A database on another host is the shape every shared staging or production replica has. Prisma's `?host=` query override is honoured — it is the host Prisma actually connects to — so `…@127.0.0.1/e2e?host=prod-db.internal` is refused. |

`E2E_DIRECT_DATABASE_URL` is held to every rule, because it is the connection
`prisma migrate deploy` runs against.

**`E2E_ALLOW_REMOTE_DATABASE=1`** is the opt-in for a disposable database that
really is on another machine. It relaxes the host rule and **nothing else**:
a remote `stuffs_logger` or `prod_e2e_replica` is refused with or without it.
`.env.e2e.example` documents it alongside the other variables.

That matters because the harness is **destructive by design**: it runs
`prisma migrate deploy`, force-creates (or force-promotes) an `ADMIN` account
whose password is a **public literal in this repository**
(`e2e/support/fixtures.ts`), mints an ingest key, and deletes every `LogEvent`
and `ApplicationUsage` row for the seeded application. Installing that admin
into a real deployment would recreate exactly the account `disableSignUp: true`
exists to prevent, reachable afterwards through the ordinary sign-in form.

The seeded accounts do not outlive the run, either: a `teardown` project
(`e2e/setup/teardown.setup.ts`) runs after the browser projects — whether
their tests passed or not — and sets `isActive = false` on both seeded users,
which is enough for `getSession` to refuse them. The next seed re-activates
them, so the deactivation is reversible and the seed stays idempotent. The
smoke chain never reaches it: it has no database.

If the run is refused for a name, rename the database or `createdb
stuffs_logger_e2e` — do not relax the check. The refusal messages never echo
the connection string, because a Postgres URL carries a password and a host
and they are printed in CI logs.

**3. Install the browser** (once):

```sh
pnpm --filter @stuffs/logger-dashboard exec playwright install chromium
```

**4. Run it.**

```sh
pnpm test:e2e
```

Playwright builds and starts the dashboard itself, applies
`prisma migrate deploy`, seeds the fixtures, signs in once per role through the
real form, and then runs the specs. To view the report afterwards:

```sh
pnpm --filter @stuffs/logger-dashboard test:e2e:report
```

If port 3000 is already taken — a very common state on a developer's machine —
set `E2E_PORT` and the base URL every spec navigates against moves with it:

```sh
E2E_PORT=3100 pnpm test:e2e
```

If you already have a dashboard running, set `E2E_BASE_URL` to its origin
instead and Playwright will neither start one nor stop one.

### Writing a spec

Specs live in `apps/dashboard/e2e/specs/` and **must** be named `*.spec.ts`.
Setup projects live in `apps/dashboard/e2e/setup/` and are named `*.setup.ts`.
Anything named `*.test.ts` belongs to Vitest and will never be run by
Playwright.

The seeded fixtures every spec can rely on are declared in
`apps/dashboard/e2e/support/fixtures.ts` — the two users, the application, the
key labels, the level and environment spread of the 120 seeded log events. Read
the run-specific values (the application id and the two freshly minted ingest
keys) from the manifest:

```ts
import { readSeedManifest } from "../support/manifest";

const seeded = await readSeedManifest();
await page.goto(`/apps/${seeded.applicationSlug}`);
```

Specs run as the seeded **ADMIN** by default. To run one as the **MEMBER**, put
this at the top of a `describe`:

```ts
import { SEED_MEMBER } from "../support/fixtures";

test.describe("as a member", () => {
  test.use({ storageState: SEED_MEMBER.storageStatePath });
  // ...
});
```

**Exactly one spec drives the sign-in form**, and it is
`apps/dashboard/e2e/specs/sign-in.spec.ts`. Every other spec starts from the
storage state the `auth` setup project saved, because
`src/lib/auth/sign-in-throttle.ts` allows only ten attempts per ADDRESS per
fifteen minutes and a suite that signed in per test would throttle itself into
red. If you add an authentication test, add it to that file and budget the
attempts — it spends three of the admin's ten and two of the member's, and CI
retries each test twice.

A spec that must run **signed out** has one non-obvious requirement:

```ts
// The idiom. An EMPTY state, not `undefined`.
test.use({ storageState: { cookies: [], origins: [] } });
```

In the installed Playwright 1.62.1, `test.use({ storageState: undefined })`
means "not overridden" rather than "no session": an `undefined` option value
resolves to the nearest enclosing one, which is the chromium project's ADMIN
state. A spec written that way runs as the seeded administrator and its
assertions pass for the wrong reason.

The suite runs `fullyParallel`, so a spec that ingests or creates anything must
use a value unique to itself (`crypto.randomUUID()`), and must filter for that
value rather than asserting on row counts. The seeded corpus is shared and
read-only.

`apps/dashboard/e2e/specs/roles.spec.ts` is the worked example of both the role
switch and a cross-role denial assertion.

### Running the smoke suite locally

```sh
E2E_BASE_URL=https://logger.example.com \
  SMOKE_BASE_URL=https://logger.example.com pnpm test:smoke
```

**Both variables, and the second one is not redundant.** Playwright's managed
`webServer` is global to a config rather than per project: it starts before any
project runs, and `--project=smoke` does not filter it. With only
`SMOKE_BASE_URL` set, the run would also `prisma generate && next build` and
`next start` a whole local dashboard it never visits — against whatever
database happened to be configured. `E2E_BASE_URL` is how a caller says "the
server is already there", and setting it skips the managed server entirely.

`.github/workflows/smoke.yml` sets both from its one input. The single place
that deliberately sets only `SMOKE_BASE_URL` is `verify.yml`, where the locally
managed server **is** the target and both suites run in one invocation:

```sh
SMOKE_BASE_URL=http://127.0.0.1:3000 pnpm test:e2e --project=smoke
```

pnpm appends the extra `--project=smoke` to the dashboard's `test:e2e`
script, so Playwright runs the e2e chain and the smoke chain in one process
against one managed dashboard. The config notices that the smoke target is the
server it manages and makes the smoke project wait for `migrate`
(`smokeTargetsManagedServer` in `playwright.config.ts`), because that server
boots against an empty database and the ingest probe looks its key up in the
schema. Against a deployed origin there is no such dependency.

`SMOKE_BASE_URL` is **required and has no default**. It is the one suite that
runs against a deployed environment, so a fallback would let a mis-set variable
report a healthy deployment nobody checked. Without it the run fails
immediately with a message naming the variable.

The smoke suite is safe against production: it holds no session, creates no
user, relies on no seeded data, and its only write-shaped request is one the
ingest endpoint refuses before it reads the body.

## Troubleshooting

**`pnpm test:e2e` fails at the `migrate` project.** Either Postgres is not up,
or the target was refused. The message says which: `E2E_DATABASE_URL` is unset
(it does not fall back to `DATABASE_URL`), the database name contains `prod`,
`production` or `live` as a whole word, the name does not contain `e2e` or
`test` as one, the host is not loopback (set `E2E_ALLOW_REMOTE_DATABASE=1`
only if the remote database really is disposable), or `NODE_ENV=production`.
See "The e2e database is an explicit opt-in" above.

**`pnpm install` fails offline with `Lockfile failed supply-chain policy
check` / `ERR_PNPM_NO_OFFLINE_META`.** pnpm 11 re-checks every locked
version's publish age against the registry on install. Pass
`--trust-lockfile` for an offline install; see "Node and pnpm versions".

**A `pnpm <script>` unexpectedly runs an install first.** pnpm 11's
`verifyDepsBeforeRun` noticed that `pnpm-workspace.yaml`, the lockfile or a
workspace version changed since the last install. Run `pnpm install`; see
"Node and pnpm versions".

**`EADDRINUSE: address already in use :::3000`.** Something else on your
machine holds the port. Set `E2E_PORT` to a free one.

**Sign-in fails in the `auth` project with "user not found".** The seed did not
run, or ran against a different database than the server. Both read the same
resolved `E2E_DATABASE_URL`, so this usually means a stale server is being
reused — stop it, or unset `E2E_BASE_URL`.

**A smoke run builds the dashboard.** `E2E_BASE_URL` is not set. See "Running
the smoke suite locally".

**The round-trip spec fails with "the SDK's `<script>` build is missing".** Run
`pnpm --filter @stuffs/logger build`. The root `pnpm test:e2e` does this
for you; running Playwright directly does not.

**The release fails with `no stable vX.Y.Z tag is reachable from HEAD`.** The
baseline tag is missing, or sits on a commit outside the branch's history. See
"Before the first release", item 3.

**The release fails with `npm does not trust this workflow to publish …`.**
The package has no trusted publisher, or it names a different repository,
workflow file or environment than `MakingStuffs/stuffs-logger`, `release.yml`
and `npm-publish`. Nothing was tagged; fix it on npmjs.com and re-run. See
"npm credentials".

**The release fails at `git push`.** Branch protection is refusing the
version commit. See "Branch protection on `main`" above.
