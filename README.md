# stuffs-logger

**Self-hosted application logging: a cross-platform TypeScript SDK and a Next.js
dashboard.** Built to replace the small slice of a hosted logging vendor we
actually used, without the bill.

[![CI](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/ci.yml/badge.svg)](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/ci.yml)
[![npm @stuffs-logger/sdk](https://img.shields.io/npm/v/@stuffs-logger/sdk?label=%40stuffs-logger%2Fsdk)](https://www.npmjs.com/package/@stuffs-logger/sdk)
[![npm @stuffs-logger/core](https://img.shields.io/npm/v/@stuffs-logger/core?label=%40stuffs-logger%2Fcore)](https://www.npmjs.com/package/@stuffs-logger/core)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue)](./LICENSE)

[Changelog](./CHANGELOG.md) ·
[SDK reference](./packages/logger-sdk/README.md) ·
[Deployment](./docs/DEPLOYMENT.md) ·
[CI/CD](./docs/CI-CD.md) ·
[Report a bug](https://github.com/MakingStuffs/stuffs-logger/issues/new) ·
[Report a vulnerability](#security)

```
stuffs-logger/
├── packages/logger-core/   shared wire schema, limits, redaction — published
├── packages/logger-sdk/    browser + node + <script> client — published
└── apps/dashboard/         ingest API, Postgres/Prisma, log explorer — self-hosted
```

There are two ways to use this, and they do not overlap much:

- **You want to log from an app.** Install the SDK from npm and point it at a
  dashboard someone is already running. Start at
  [Using the SDK](#using-the-sdk).
- **You want to run the dashboard.** Clone the repo and self-host it. Start at
  [Running the dashboard](#running-the-dashboard).

## Contents

- [Features](#features)
- [Project status](#project-status)
- [Compatibility](#compatibility)
- [Using the SDK](#using-the-sdk)
- [Running the dashboard](#running-the-dashboard)
- [Commands](#commands)
- [Tests](#tests)
- [Versioning and releases](#versioning-and-releases)
- [Contributing](#contributing)
- [Security](#security)
- [Docs](#docs)
- [Licence](#licence)

## Features

**The SDK** ([`@stuffs-logger/sdk`](./packages/logger-sdk/README.md))

- One package for Node, React, Next.js and a plain `<script>` tag, and it never
  throws into your code.
- `captureConsole()` forwards every `console.*` call and still prints it, so no
  call sites change. `captureErrors()` picks up uncaught errors and unhandled
  rejections.
- Logging only queues an event. Batching, serialisation and the network happen
  later, on an idle callback, behind a bounded queue with capped retry backoff.
- Secret-looking context keys and URL parameters are redacted before an event
  is queued.
- No third-party code in the bundle: under 8 KB gzipped for the drop-in
  `<script>` build.

**The dashboard** (`apps/dashboard`, self-hosted)

- Ingest API with origin-checked public keys for browsers and secret keys for
  servers, server-side redaction, a per-application daily quota and throttling
  of invalid keys.
- Overview and log explorer with search, filters and keyset pagination, kept
  fast at millions of rows.
- Admin screens for applications, ingest keys, users, roles and API tokens.
  Sign-up is closed by design.
- Scheduled retention sweep, and nothing to run beyond Next.js and Postgres.

## Project status

Pre-1.0. The packages follow [SemVer](https://semver.org), and the version is
set from commit messages by the release script. While the version is `0.x`, a
breaking change bumps the minor (`0.1.x` to `0.2.0`); moving to `1.0.0` is a
deliberate step, not a side effect of a commit. Read the
[changelog](./CHANGELOG.md) before upgrading.

Scope is deliberately one organisation per deployment: every signed-in account
can read every application's logs. It is not designed as a multi-tenant hosted
service.

## Compatibility

|                       | Supported                                                       |
| --------------------- | --------------------------------------------------------------- |
| Node (SDK, dashboard) | 22 or newer. CI runs Node 24                                    |
| Browsers (SDK)        | Any browser that runs ES2022                                    |
| Module formats (SDK)  | ESM, CommonJS and a `<script>` build. TypeScript types included |
| Postgres (dashboard)  | 14 or newer                                                     |
| Next.js (dashboard)   | 16, bundled. The dashboard is an app, not a plugin              |

## Using the SDK

```sh
pnpm add @stuffs-logger/sdk
```

```ts
import {
  captureConsole,
  captureErrors,
  createLogger,
} from "@stuffs-logger/sdk";

const logger = createLogger({ apiKey: "slg_pub_…" });
captureConsole(logger); // console.log/warn/error still work, and ship
captureErrors(logger);
```

No build step at all:

```html
<script
  src="https://unpkg.com/@stuffs-logger/sdk/dist/stuffs-logger.global.js"
  data-slg-key="slg_pub_…"
  data-slg-endpoint="https://logs.example.com"
></script>
```

[`packages/logger-sdk/README.md`](./packages/logger-sdk/README.md) is the full
reference — Node, React and Next.js setup, every option, and what publishing a
public key actually costs you. Read that last section before you ship a
`slg_pub_` key.

## Running the dashboard

The dashboard is not published to npm; you run it from a clone. It needs
Postgres and nothing else.

```bash
pnpm install
cp apps/dashboard/.env.example apps/dashboard/.env.local
# fill in DATABASE_URL, DIRECT_DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL
pnpm --filter @stuffs-logger/dashboard db:migrate    # needs a running Postgres
pnpm dev
```

`build`, `typecheck` and `test` each run `prisma generate` first, so a fresh
clone needs no separate generate step. Run
`pnpm --filter @stuffs-logger/dashboard db:generate` by hand only if you want
the client without doing any of the three.

Self-service sign-up is off by design: any signed-in account reads every
application's logs. Create the first administrator from the command line, then
manage everyone else from the app:

```bash
DATABASE_URL='postgres://…' \
  pnpm --filter @stuffs-logger/dashboard user:create-admin -- \
  --email you@example.com --name "Your Name"
```

[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) has the exact steps, the full
environment-variable table, and both deployment paths.

## Commands

| Command                                  | What it does                                                   |
| ---------------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                               | The dashboard, in development                                  |
| `pnpm build`                             | Core, SDK, then the dashboard                                  |
| `pnpm typecheck`                         | Types, across every package                                    |
| `pnpm lint`                              | ESLint, across every package plus `scripts/`                   |
| `pnpm format` / `pnpm format:check`      | Prettier, write and check                                      |
| `pnpm test` (alias `pnpm test:unit`)     | Every unit suite                                               |
| `pnpm test:e2e`                          | Playwright, against a real Postgres and a production build     |
| `pnpm test:smoke`                        | The `@smoke` subset against `SMOKE_BASE_URL` + `E2E_BASE_URL`  |
| `pnpm --filter @stuffs-logger/sdk build` | SDK bundles + size report                                      |
| `pnpm --filter @stuffs-logger/sdk size`  | Rebuilds the `<script>` bundle and prints its gzipped size     |
| `pnpm release:verify-pack`               | Packs both published packages and audits the tarballs. Offline |
| `pnpm release:dry-run`                   | The next version and its notes. Writes and publishes nothing   |
| `pnpm version:sync <version>`            | Writes one version into all four manifests                     |

## Tests

Three suites, three questions:

- **`pnpm test`** — unit and component tests, Vitest. Pure logic, React
  components under jsdom, and the e2e harness's own helpers. No database, no
  browser.
- **`pnpm test:e2e`** — Playwright. Starts a production build of the dashboard,
  applies migrations, seeds a fixture application with 120 log events and two
  users, signs in through the real form, and drives the UI. Needs Postgres and
  a Chromium binary:

  ```sh
  createdb stuffs_logger_e2e
  cp apps/dashboard/.env.e2e.example apps/dashboard/.env.e2e
  pnpm --filter @stuffs-logger/dashboard exec playwright install chromium
  pnpm test:e2e
  ```

  `E2E_DATABASE_URL` — which that example file sets — is required and never
  falls back to `DATABASE_URL`, and the database it names must contain `e2e`
  or `test` as a whole word. The harness migrates, seeds and truncates
  whatever it is pointed at, so it refuses anything that does not read as
  disposable.

- **`pnpm test:smoke`** — the tagged critical-path subset, run against a
  deployed origin after a release. Unauthenticated and read-only by
  construction, so it is safe against production. Point both `SMOKE_BASE_URL`
  and `E2E_BASE_URL` at that origin: Playwright's managed server is global to
  the config rather than per project, so without `E2E_BASE_URL` the run also
  builds and starts a local dashboard it never visits.

`*.test.ts` belongs to Vitest and `*.spec.ts` to Playwright; neither runner can
see the other's files. [`docs/CI-CD.md`](./docs/CI-CD.md) covers the workflows,
the collection boundary, and how to write a new spec.

## Versioning and releases

Every package carries the **same version**, and it is set by
[`scripts/release.sh`](./scripts/release.sh) from Conventional Commits — there
are no changeset files and no manual bumps.

| Branch     | Version      | npm dist-tag | git tag       |
| ---------- | ------------ | ------------ | ------------- |
| `main`     | `x.y.z`      | `latest`     | `vX.Y.Z`      |
| any `*-rc` | `x.y.z-rc.N` | `rc`         | `vX.Y.Z-rc.N` |

Merging to `main` publishes a stable release; pushing to a branch whose name
ends in `-rc` publishes a release candidate on the `rc` tag. The release commits
`CHANGELOG.md` and all four manifests back as
`chore(release): <version> [skip ci]`. `@stuffs-logger/dashboard` stays private
and is never published.

[`CHANGELOG.md`](./CHANGELOG.md) is written by the same release, from the same
commits, and the notes also go to
[GitHub Releases](https://github.com/MakingStuffs/stuffs-logger/releases). Each
release adds its entry above the previous one, below the header; nothing in
it is edited by hand.

Setting up a fork means one npm automation token and a branch-protection
allowance for the release actor — both in [`docs/CI-CD.md`](./docs/CI-CD.md).

## Contributing

Issues and pull requests are welcome. For anything bigger than a bug fix, open
an [issue](https://github.com/MakingStuffs/stuffs-logger/issues) first so the
approach can be agreed before you write it.

You need Node 22 or newer and pnpm 11.22.0 (the version pinned in
`packageManager`; `corepack enable` will provide it). Before pushing, run what
CI runs:

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm format:check
```

Run `pnpm test:e2e` as well if you changed the dashboard; the [Tests](#tests)
section has the setup. CI pushes Prettier fixes back to pull requests opened
from branches in this repository. Pull requests from forks have to be formatted
before they are pushed.

**Commit messages are the changelog.** Each commit on `main` must follow
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), because
the release script reads them to choose the next version and write its
changelog entry. A commit that does not follow the format is left out of both. If a pull request is squash-merged, its title becomes the
commit message, so the title must follow the same format.

| Commit                                                      | Release | Changelog section        |
| ----------------------------------------------------------- | ------- | ------------------------ |
| `fix(sdk): …`                                               | patch   | Bug Fixes                |
| `feat(dashboard): …`                                        | minor   | Features                 |
| `perf: …`                                                   | patch   | Performance Improvements |
| `revert: …`                                                 | patch   | Reverts                  |
| `feat!: …`, or a `BREAKING CHANGE:` footer                  | major¹  | ⚠ BREAKING CHANGES       |
| `docs`, `chore`, `refactor`, `test`, `ci`, `build`, `style` | none    | Not listed               |

¹ Minor while the version is `0.x`. The `!` works after a scope too
(`fix(sdk)!: …`), and the footer may be spelled `BREAKING-CHANGE:`; it must
start its own line.

Add a scope (`core`, `sdk`, `dashboard` or `ci`) when a change belongs to one
area; the changelog prints it in bold. Write the subject for the person
reading the changelog, not for the reviewer.

## Security

**Do not report vulnerabilities in public issues.** Report them privately
through [GitHub's vulnerability reporting](https://github.com/MakingStuffs/stuffs-logger/security/advisories/new).
The fix ships as a normal release, and the advisory is published once a fixed
version is on npm.

What the SDK protects, and what a published `slg_pub_` key can and cannot do,
is set out in
[the SDK reference](./packages/logger-sdk/README.md#what-publishing-a-public-key-actually-costs-you).
How to deploy the dashboard safely is in
[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

## Docs

- [`CHANGELOG.md`](./CHANGELOG.md) — every release, newest first.
- [`packages/logger-sdk/README.md`](./packages/logger-sdk/README.md) — the full
  SDK reference.
- [`docs/CI-CD.md`](./docs/CI-CD.md) — workflows, secrets, release channels,
  and running each test suite locally.
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — environment variables,
  migrations, provisioning the first administrator, Vercel and plain Node.
- [`docs/FOLLOW-UPS.md`](./docs/FOLLOW-UPS.md) — deferred decisions and known
  gaps, written down rather than forgotten.

## Licence

[MIT](./LICENSE) © MakingStuffs
