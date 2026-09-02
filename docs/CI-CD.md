# CI/CD, testing and releases

Everything the pipeline does, everything a maintainer has to configure once,
and how to run each suite on your own machine.

> Deploying the dashboard is a separate document — see
> [`DEPLOYMENT.md`](./DEPLOYMENT.md). This repository publishes packages; it
> does not deploy the dashboard.

## The workflows

| File                            | Trigger                                               | What it does                                                            |
| ------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `.github/workflows/ci.yml`      | `pull_request`; `push` to `main` and `*-rc`           | Runs the whole verification suite, and auto-formats same-repo PRs.      |
| `.github/workflows/verify.yml`  | `workflow_call` only — never on its own               | Format, lint, types, unit tests, build, tarball audit, e2e and smoke.   |
| `.github/workflows/release.yml` | `push` to `main` and `*-rc`                           | Verifies, then runs semantic-release: version, publish, tag, changelog. |
| `.github/workflows/smoke.yml`   | `workflow_dispatch` with a URL input; `workflow_call` | Runs the `@smoke` subset against a deployed origin.                     |

`verify.yml` is a **reusable** workflow rather than a copy of the same steps in
two files. That is what makes "a release runs exactly the checks the pull
request ran" true by construction instead of by convention — there is only one
definition of those checks and both entry points call it.

### Jobs

`verify.yml`

| Job      | Runs                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `static` | `pnpm format:check`, `pnpm lint`, `pnpm typecheck`                                                                                           |
| `unit`   | `pnpm test:unit`                                                                                                                             |
| `build`  | `pnpm build`, then `pnpm release:verify-pack` (packs both published packages and audits the tarballs offline)                                |
| `e2e`    | `pnpm test:e2e` and `pnpm test:smoke` against a Postgres **service container**, with `prisma migrate deploy` applied and the fixtures seeded |

`ci.yml`

| Job            | Runs                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `verify`       | Calls `verify.yml`.                                                                             |
| `format-patch` | Runs Prettier on the pull request's code and uploads the resulting patch. Holds no credential.  |
| `auto-format`  | Applies that patch and pushes it to the PR branch. Holds `contents: write` and runs no PR code. |

`release.yml`

| Job       | Runs                                                               |
| --------- | ------------------------------------------------------------------ |
| `verify`  | Calls `verify.yml`. The release job `needs:` it.                   |
| `release` | `pnpm release` — semantic-release.                                 |
| `smoke`   | Calls `smoke.yml`, only when the `SMOKE_BASE_URL` variable is set. |

### Badges

```markdown
[![CI](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/ci.yml/badge.svg)](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/ci.yml)
[![Release](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/release.yml/badge.svg)](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/release.yml)
[![Smoke](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/smoke.yml/badge.svg)](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/smoke.yml)
```

`verify.yml` has no badge of its own: it never runs standalone, so its badge
would always read "no status".

## What a maintainer must configure

### Secrets

| Secret              | Required               | Used by                                                | Notes                                                                                                                                                                                                                                                        |
| ------------------- | ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NPM_TOKEN`         | Yes, to publish        | `release.yml`, the `release` job's `Release` step only | An npm **Automation** token with publish rights to the `@stuffs-logger` scope. Automation type specifically, so npm's 2FA does not block an unattended publish. **Store it as an environment secret on `npm-publish`, not a repository secret** — see below. |
| `GITHUB_TOKEN`      | Provided automatically | `release.yml`                                          | Creates the GitHub Release, comments on released issues and PRs, and authenticates the version commit's push.                                                                                                                                                |
| `FORMAT_PUSH_TOKEN` | Optional — see below   | `ci.yml`, the `auto-format` job                        | A fine-grained PAT or GitHub App installation token with `contents: write` on this repository and **no branch-protection bypass**. It must be a different credential from any release token that has one.                                                    |

No other job in any workflow receives a secret, and no workflow ever echoes,
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
public `@stuffs-logger` scope is reachable by anyone with repository **write**
access, which is a strictly lower privilege — push a branch named
`anything-rc` and `release.yml` publishes it under the maintainer's npm
identity as `x.y.z-rc.N`, on the `rc` dist-tag, unreplaceably. `needs: verify`
is not a control against that actor, because the same push supplies the code
and the tests that verify it.

Settings → Environments → **New environment**, named `npm-publish`:

1. **Required reviewers** — at least one maintainer. This is the control. Every
   release run then waits for a human before the publish job starts.
2. **Deployment branches and tags** — restrict to `main` and `*-rc`, so the
   environment's secret cannot be reached from any other ref.
3. **Move `NPM_TOKEN` to this environment's secrets** and delete the repository
   secret of that name. A repository secret is readable by any job that asks
   for it; an environment secret is readable only by a job that has passed the
   environment's gate.

### A ruleset restricting `*-rc` branches — REQUIRED

Settings → Rules → **New ruleset**, targeting the branch pattern `*-rc`:

- **Restrict creations** and **restrict updates** to a named bypass list of
  maintainers.

Without it, the `*-rc` release channel is open to every collaborator with
write access. The environment above is the credential gate; this is the trigger
gate, and they close different halves of the same hole.

### Recommended: npm trusted publishing (OIDC) instead of `NPM_TOKEN`

A long-lived automation token is a bearer credential: whoever holds it can
publish from anywhere, forever, until it is rotated. npm **trusted publishing**
binds publish rights to a specific repository, workflow file and ref via the
OIDC token GitHub already mints for this job (`id-token: write` is set). Moving
to it removes `NPM_TOKEN` from the repository entirely and makes "who may
publish" a property of the workflow rather than of whoever can read a secret.
Configure it on npmjs.com under the package's _Settings → Trusted publisher_,
then delete the secret and the `NODE_AUTH_TOKEN` line.

Until then, the publish carries **provenance** (`--provenance` in
`release.config.mjs`, `id-token: write` in `release.yml`): every published
version is signed with an attestation naming the workflow, repository and
commit it was built from. That does not stop a stolen token being used — it
makes the resulting version visibly unattested on the npm package page instead
of indistinguishable from a real one.

### Branch protection on `main`

semantic-release **commits back to the branch** — `@semantic-release/git` is in
the plugin chain, and it pushes `CHANGELOG.md` plus all four `package.json`
files with the message `chore(release): <version> [skip ci]`.

That means the release actor must be allowed to push directly to `main`. If
`main` requires pull requests, the default `GITHUB_TOKEN` **cannot** push and
every release will fail at the `git` step. Pick one:

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
`auto-format` downloads that patch and applies it with `git apply --index`,
which stages exactly the paths in the patch and nothing else; there is no
`git add --all`.

**`FORMAT_PUSH_TOKEN` must be scoped to `contents: write` on this repository
and must NOT carry a branch-protection bypass.** It is therefore a different
credential from any release token that does carry one (see "Branch protection
on `main`" below). It is optional; without it the job falls back to the default
`GITHUB_TOKEN`.

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

A tag is a mutable pointer. Once a job holds `NPM_TOKEN` or a write-scoped
token, there is no supply-chain difference between GitHub's own action and
anybody else's: a moved tag runs new code inside a privileged job either way.
Applying one rule everywhere also means a reviewer never has to decide which
actions "count".

The Postgres service container is pinned by image **digest** for the same
reason.

Bumping a pin means changing the SHA and the comment together. Dependabot's
`github-actions` ecosystem understands SHA pins with version comments and will
open those pull requests for you.

### The invariants are tested, not just reviewed

`scripts/workflow-invariants.test.mjs` runs in `pnpm test` (the root Vitest
suite collects `scripts/**/*.test.mjs`) and asserts four properties against the
real files in `.github/workflows/`:

1. No workflow is triggered by `pull_request_target`.
2. Every workflow declares a top-level `permissions:` block, and every scope in
   it is `read` or `none`.
3. Every `uses:` is pinned to a 40-character commit SHA (local reusable
   workflows excepted).
4. No `run:` block contains a `${{ … }}` expression.

Each of those is invisible in the diff that breaks it — one word, one line, or
something that looks like a version bump — so they are a test rather than a
review note.

## Node and pnpm versions

- **pnpm is read from the manifest.** `pnpm/action-setup` is used without a
  `version` input, so it takes the version from the root `packageManager` field
  (`pnpm@11.22.0`). There is no second source of truth to keep in step.
- **Node is pinned to `24` in the workflows**, deliberately not read from
  `engines.node`. That field is the _range_ `">=22"`, and resolving a range in
  CI means the pipeline silently moves to whatever Node is newest. 24 is chosen
  because `semantic-release@25` declares
  `engines.node: "^22.14.0 || >= 24.10.0"`, so it is the only major that
  satisfies both the repository and the release tool.

Installs use `pnpm install --frozen-lockfile` everywhere, and the pnpm store is
cached by `actions/setup-node`'s `cache: pnpm`, keyed on `pnpm-lock.yaml`.

## Release channels

| Branch | Version      | npm dist-tag | git tag       |
| ------ | ------------ | ------------ | ------------- |
| `main` | `x.y.z`      | `latest`     | `vX.Y.Z`      |
| `*-rc` | `x.y.z-rc.N` | `rc`         | `vX.Y.Z-rc.N` |

All four manifests move in lockstep — the root, both published packages and the
dashboard — via `scripts/sync-versions.mjs`, which semantic-release calls
through `@semantic-release/exec`.

**semantic-release resolves the `*-rc` glob with `git ls-remote`**, so an `-rc`
branch that only exists locally yields `ERELEASEBRANCHES`. Push the branch
first.

**The first release from `main` will be `1.0.0`, not `0.2.0`** — there are no
git tags, so semantic-release treats it as a first release and ignores the
`0.1.0` in the manifests. If the 0.x line should continue, push a `v0.1.0` tag
before the first release run. See `FOLLOW-UPS.md` §9.

To rehearse without publishing anything:

```sh
pnpm release:dry-run     # loads the config, resolves the branch policy; offline
pnpm release:verify-pack # builds, packs and audits both tarballs; offline
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
`DATABASE_URL`. Three rules are checked in `resolveDatabaseTarget`
(`apps/dashboard/e2e/support/env.ts`) before anything is written, and each one
refuses the run with a message naming what to fix:

| Rule                                                                      | Why                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_DATABASE_URL` must be set; the ambient `DATABASE_URL` is never used. | `DATABASE_URL` is exported as a matter of course in containers, in CI, by direnv and on a server. Naming the database in its own variable is the opt-in that says "this one is disposable". |
| Its database **name** must contain `e2e` or `test` as a whole word.       | The variable can still be pointed at the wrong thing. `stuffs_logger_e2e` and `logger-test` pass; `stuffs_logger` and `latest` do not. `E2E_DIRECT_DATABASE_URL` is held to the same rule.  |
| `NODE_ENV` must not be `production`.                                      | There is no production environment in which seeding fixture accounts and deleting log rows is the intent.                                                                                   |

That matters because the harness is **destructive by design**: it runs
`prisma migrate deploy`, force-creates (or force-promotes) an `ADMIN` account
whose password is a **public literal in this repository**
(`e2e/support/fixtures.ts`), mints an ingest key, and deletes every `LogEvent`
and `ApplicationUsage` row for the seeded application. Installing that admin
into a real deployment would recreate exactly the account `disableSignUp: true`
exists to prevent, reachable afterwards through the ordinary sign-in form.

If the run is refused for a name, rename the database or `createdb
stuffs_logger_e2e` — do not relax the check. The refusal messages never echo
the connection string, because a Postgres URL carries a password and they are
printed in CI logs.

**3. Install the browser** (once):

```sh
pnpm --filter @stuffs-logger/dashboard exec playwright install chromium
```

**4. Run it.**

```sh
pnpm test:e2e
```

Playwright builds and starts the dashboard itself, applies
`prisma migrate deploy`, seeds the fixtures, signs in once per role through the
real form, and then runs the specs. To view the report afterwards:

```sh
pnpm --filter @stuffs-logger/dashboard test:e2e:report
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
that deliberately sets only `SMOKE_BASE_URL` is `verify.yml`'s smoke step,
where the locally managed server **is** the target.

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
(it does not fall back to `DATABASE_URL`), the database name does not contain
`e2e` or `test` as a whole word, or `NODE_ENV=production`. See "The e2e
database is an explicit opt-in" above.

**`EADDRINUSE: address already in use :::3000`.** Something else on your
machine holds the port. Set `E2E_PORT` to a free one.

**Sign-in fails in the `auth` project with "user not found".** The seed did not
run, or ran against a different database than the server. Both read the same
resolved `E2E_DATABASE_URL`, so this usually means a stale server is being
reused — stop it, or unset `E2E_BASE_URL`.

**A smoke run builds the dashboard.** `E2E_BASE_URL` is not set. See "Running
the smoke suite locally".

**The round-trip spec fails with "the SDK's `<script>` build is missing".** Run
`pnpm --filter @stuffs-logger/sdk build`. The root `pnpm test:e2e` does this
for you; running Playwright directly does not.

**`ERELEASEBRANCHES` from semantic-release.** The `-rc` branch does not exist on
the remote. Push it.

**The release fails at `@semantic-release/git`.** Branch protection is refusing
the version commit. See "Branch protection on `main`" above.
