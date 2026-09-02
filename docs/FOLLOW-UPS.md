# stuffs-logger — known follow-ups

Everything here was found by review, deliberately deferred, and is not a surprise.
Nothing below blocks the branch; each is a decision or a scoped piece of work.

## 1. Provision the first admin (REQUIRED before first use)

Self-service sign-up is deliberately disabled: a MEMBER can read every application's
logs, so an open registration form would hand your logs to anyone with an email address.
Accounts are operator-provisioned and default to `MEMBER` / `isActive: true`.

Create the first user, then promote them to `ADMIN` in the `users` table. `.env.example`
documents the steps. Only an ADMIN can create or revoke ingest keys.

If you want self-service instead, the safe shape is sign-up creating `isActive: false`
accounts that an admin approves - a small change to `src/lib/auth/auth.ts`.

## 2. Access model

- Any authenticated, **active** user reads logs and applications (`assertActiveViewer`).
- Only an **ADMIN** manages ingest keys (`assertAdminViewer`).

This is deliberately looser than the pre-migration model, which gated every read on
"is this person staff" - a check that mattered when a signed-in user might belong to
another company. The user table is now exclusively yours, so it no longer does.
If you later host logs for outside parties, reinstate a per-application entitlement:
`Application` is already the tenant column and `buildWhere` in
`src/lib/logs/queries.ts` is where the intersection belongs.

## 3. Partition the ingest quota per key (RECOMMENDED)

`ApplicationUsage` is keyed on `(applicationId, day)`. A public key is public by design,
and `Origin` is only truthful from a real browser, so someone who reads your page source
can present a scraped `slg_pub_` key with a forged `Origin` and `source: "browser"` and
spend an application's whole daily quota in roughly 2,500-4,000 requests.

The gap is not the ceiling, it is recovery: **revoking the abused key does not restore
service**, because the counter is per-application. Partition it per key with the
application total as an outer bound, so revocation frees the remaining allowance.
Add an alert when an application crosses a fraction of its quota, and an operator path
to reset a day's counters.

## 4. Promote CSP from report-only to enforcing

`src/proxy.ts` ships a nonce-based policy in report-only mode. Promotion needs a
`report-uri`/`report-to` collector, or a manual pass over each route. Path documented in
`src/lib/security/csp.ts`.

## 5. Verify the quota upsert under real concurrency

`prisma.applicationUsage.upsert` uses atomic `increment`s, unit-tested through an injected
store. The row-creation half of an upsert under concurrent writers is the classic place a
unique-violation retry is needed. There was no Postgres available to test it against.

## 6. In-memory limiters are per-instance

Three limiters live in module memory and reset on a cold start: ingest rate limiting
(`src/lib/ingest/rate-limit.ts`), the sign-in throttle (`src/lib/auth/sign-in-throttle.ts`),
and the registered-origin snapshot. Each is a first line, not a distributed guarantee.
The durable per-application quota is the real ingest ceiling. Making any of them global
needs Redis or Vercel KV.

The sign-in throttle matters most: the sign-in Server Action calls `auth.api.signInEmail`
directly, which bypasses Better Auth's own router-level rate limiting.

## 7. Smaller items

- Browser support: `globals.css` uses CSS `light-dark()` (Chrome 123+, Safari 17.5+,
  Firefox 120+). Change this first if you need older browsers.
- No theme toggle - OS preference only. `[data-theme]` is already wired for one.
- Fonts are system stacks, chosen for zero webfont bytes and no CLS. One token to change.
- MSW is not installed, so transport tests stub `fetch` directly.
- The e2e suite runs on Chromium only. A second engine is one entry in
  `BROWSER_PROJECTS` in `apps/dashboard/playwright.config.ts`; it is left off
  because every journey in the product is server-rendered HTML and a second
  engine's cost lands on every pull request.
- `projection.test.ts` is missing the `expect("polluted" in {}).toBe(false)` assertion its
  two core counterparts carry. Pollution is impossible there by construction.

## 8. A note on `SKIP_AUTH`

`SKIP_AUTH=true` / `NEXT_PUBLIC_SKIP_AUTH=true` returns a mock ADMIN session and is
commented out in `.env.example`. `src/constants/environment.ts` throws at boot if either
is set while `NODE_ENV=production`. That guard is this app's own - nothing in the auth
library enforces it. Keep it.

## 9. Publishing and release

- **The first release from `main` will be `1.0.0`, not `0.2.0`.** semantic-release has no
  tags to read (`git tag -l` is empty), so it treats this as a first release and ignores
  the `0.1.0` in the manifests. If the 0.x line should continue instead, tag the current
  tip `v0.1.0` and push the tag before the first release run; semantic-release will then
  bump from there. This is a deliberate choice to make, not an accident to discover
  after `@stuffs-logger/sdk@1.0.0` is on npm and unpublishable.
- **`@stuffs-logger/sdk` depends on `@stuffs-logger/core` even though it bundles it.**
  `tsup`'s `noExternal` inlines the core's _code_, but the SDK's emitted declarations
  still reference `@stuffs-logger/core` for `IngestBatch` and its leaf modules for the
  taxonomy and redaction types, so the dependency is real for TypeScript consumers. The
  cost is that installing the SDK also installs zod transitively, which the READMEs
  describe as "zero runtime deps". Making the SDK's `.d.ts` fully self-contained would
  let the dependency move to `devDependencies`; `tsup`'s `dts.resolve` cannot do it,
  because its ts-resolver does not honour the tsconfig path mapping the seam relies on.
- **`@stuffs-logger/core` does not set `"sideEffects": false`.** It could: every module in
  it is pure. It is left off deliberately for now because the SDK's measured bundle size
  is an acceptance criterion, and that flag changes what a bundler may tree-shake out of
  the core's zod-bearing barrel — a size change worth making on purpose and measuring,
  not as a side effect of making the package publishable.
