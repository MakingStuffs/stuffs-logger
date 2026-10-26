# Changelog

All notable changes to `@stuffs-logger/core`, `@stuffs-logger/sdk` and the self-hosted dashboard. Every package shares one version, so one entry covers all three.

Entries are written by [semantic-release](https://semantic-release.gitbook.io) from the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) on `main` and on `*-rc` branches, and the same notes are published to [GitHub Releases](https://github.com/MakingStuffs/stuffs-logger/releases). Do not edit them here: fix the wording of a commit message before it merges instead.

## 0.1.0 (2026-10-26)

The baseline every later entry is measured from, written by hand because it predates the release pipeline. It was never published to npm: the first version on npm is the first one semantic-release cuts after the `v0.1.0` tag.

### Features

* **core:** shared wire contract — ingest schemas, size limits, log taxonomy and secret-key redaction — used by the SDK and the dashboard alike ([aa8cde7](https://github.com/MakingStuffs/stuffs-logger/commit/aa8cde7ca61cf9bb4db4424ed524a0504812ee26))
* **dashboard:** ingest API, Postgres/Prisma storage and the data access layer ([aa8cde7](https://github.com/MakingStuffs/stuffs-logger/commit/aa8cde7ca61cf9bb4db4424ed524a0504812ee26))
* **dashboard:** overview, log explorer and ingest key management ([050c49b](https://github.com/MakingStuffs/stuffs-logger/commit/050c49bcf2aaccaaf289b5c9c6508f3f92a881a6))
* **sdk:** cross-platform logger for Node, browsers and a plain `<script>` tag, with console and error capture and a batched, bounded transport ([7439fad](https://github.com/MakingStuffs/stuffs-logger/commit/7439fad14a36b7176607d48961566f11d61887ea))
* **dashboard:** self-hosted authentication with Better Auth: email and password, optional Google, sign-up closed by design ([7d2cefe](https://github.com/MakingStuffs/stuffs-logger/commit/7d2cefe2e37a935b9b44110ca757ce93b0d800f3))
* **dashboard:** local UI component layer, with no third-party UI kit ([5076a5d](https://github.com/MakingStuffs/stuffs-logger/commit/5076a5df3ef9ede8486871edd838d8e17330fc86))
* **core, sdk:** published to npm as `@stuffs-logger/core` and `@stuffs-logger/sdk`, with provenance attestations, plus CI, release automation, and Playwright e2e and smoke suites ([911e022](https://github.com/MakingStuffs/stuffs-logger/commit/911e022df88cc1eb08ca4da2db0715311ffd640c))
* **dashboard:** admin screens for applications, users, account and API tokens, and a `user:create-admin` command for the first administrator ([c81e9ab](https://github.com/MakingStuffs/stuffs-logger/commit/c81e9ab53f0f134534e4a362c2acd9227562d048))
* **dashboard:** faster queries on large tables: keyset pagination, a loose index scan for the environment facet (4.3 s to 0.1 ms at 5M rows), single-statement retention batches, and search limited to the last 24 hours by default ([c81e9ab](https://github.com/MakingStuffs/stuffs-logger/commit/c81e9ab53f0f134534e4a362c2acd9227562d048))

### Bug Fixes

* **sdk:** count size limits in UTF-8 bytes, flush on page unload, and redact secrets in URLs ([f131a25](https://github.com/MakingStuffs/stuffs-logger/commit/f131a25ed7f11a6284df709baec2efaf3e751ee3))
* **dashboard:** redact on the server too, gate data by application, enforce a daily ingest quota, and refuse to start production with auth disabled ([0566ee9](https://github.com/MakingStuffs/stuffs-logger/commit/0566ee91f41416bceff48f1ce64101b23c123b7f))
* **dashboard:** show context and stack traces in expanded log rows ([579f03b](https://github.com/MakingStuffs/stuffs-logger/commit/579f03b807a80340fa5ba89b90e1719977862271))
* **core:** one redaction implementation shared by the SDK and the dashboard ([3b6f298](https://github.com/MakingStuffs/stuffs-logger/commit/3b6f298aec30ebf9fcb1552591fc3045fa3c0ecd))
* **dashboard:** close Google sign-up at the provider, refuse open redirects in `returnTo`, cap the ingest body size while streaming it, and throttle invalid keys and failed sign-ins ([c81e9ab](https://github.com/MakingStuffs/stuffs-logger/commit/c81e9ab53f0f134534e4a362c2acd9227562d048))
* **sdk:** redact object messages and OAuth callback parameters, refuse redirects, and leave Node's unhandled-rejection mode unchanged ([c81e9ab](https://github.com/MakingStuffs/stuffs-logger/commit/c81e9ab53f0f134534e4a362c2acd9227562d048))
* **dashboard:** read the client address from `X-Forwarded-For` only as far as `TRUSTED_PROXY_HOPS` trusted proxies vouch for it, so spoofed addresses cannot slip past the throttles ([8e7a3e2](https://github.com/MakingStuffs/stuffs-logger/commit/8e7a3e21cc1ca165fdd753b7f240eba0b570cb95))
* **dashboard:** with no trusted client address, sign-in uses only the per-account ceiling, so ten wrong guesses at a colleague's email no longer lock them out ([68ac906](https://github.com/MakingStuffs/stuffs-logger/commit/68ac906f1872c5ec5f502f23dcd8a4acca01f605))
