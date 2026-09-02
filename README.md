# stuffs-logger

[![CI](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/ci.yml/badge.svg)](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/ci.yml)
[![Release](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/release.yml/badge.svg)](https://github.com/MakingStuffs/stuffs-logger/actions/workflows/release.yml)
[![npm @stuffs-logger/sdk](https://img.shields.io/npm/v/@stuffs-logger/sdk?label=%40stuffs-logger%2Fsdk)](https://www.npmjs.com/package/@stuffs-logger/sdk)
[![npm @stuffs-logger/core](https://img.shields.io/npm/v/@stuffs-logger/core?label=%40stuffs-logger%2Fcore)](https://www.npmjs.com/package/@stuffs-logger/core)
[![Node](https://img.shields.io/node/v/@stuffs-logger/sdk)](https://nodejs.org)
[![Licence](https://img.shields.io/github/license/MakingStuffs/stuffs-logger)](./LICENSE)

Self-hosted application logging: a cross-platform TypeScript SDK and a Next.js
dashboard. Built to replace the small slice of a hosted logging vendor we actually
used, without the bill.

```
stuffs-logger/
├── packages/logger-core/   shared wire schema, limits, redaction — published
├── packages/logger-sdk/    browser + node + <script> client — published
└── apps/dashboard/         ingest API, Postgres/Prisma, log explorer — self-hosted
```

There are two ways to use this, and they do not overlap much:

- **You want to log from an app.** Install the SDK from npm and point it at a
  dashboard someone is already running. Start below.
- **You want to run the dashboard.** Clone the repo and self-host it. Start at
  [Running the dashboard](#running-the-dashboard).

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
application's logs. Create the first user out of band, then promote them to
`ADMIN` in the `users` table — only an ADMIN can mint or revoke ingest keys.
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
| `pnpm release:dry-run`                   | What semantic-release would do. Publishes nothing              |
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
[semantic-release](https://semantic-release.gitbook.io) from Conventional
Commits — there are no changeset files and no manual bumps.

| Branch     | Version      | npm dist-tag | git tag       |
| ---------- | ------------ | ------------ | ------------- |
| `main`     | `x.y.z`      | `latest`     | `vX.Y.Z`      |
| any `*-rc` | `x.y.z-rc.N` | `rc`         | `vX.Y.Z-rc.N` |

Merging to `main` publishes a stable release; pushing to a branch whose name
ends in `-rc` publishes a release candidate on the `rc` tag. The release commits
`CHANGELOG.md` and all four manifests back as
`chore(release): <version> [skip ci]`. `@stuffs-logger/dashboard` stays private
and is never published.

Setting up a fork means one npm automation token and a branch-protection
allowance for the release actor — both in [`docs/CI-CD.md`](./docs/CI-CD.md).

## Docs

- [`docs/CI-CD.md`](./docs/CI-CD.md) — workflows, secrets, release channels,
  and running each test suite locally.
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — environment variables,
  migrations, provisioning the first administrator, Vercel and plain Node.
- [`docs/FOLLOW-UPS.md`](./docs/FOLLOW-UPS.md) — deferred decisions and known
  gaps, written down rather than forgotten.

MIT licensed. See [`LICENSE`](./LICENSE).
