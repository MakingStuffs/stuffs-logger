# stuffs-logger — known follow-ups

Everything here was found by review, deliberately deferred, and is not a surprise.
Nothing below blocks the branch; each is a decision or a scoped piece of work.

## 1. Provision the first admin (REQUIRED before first use)

Self-service sign-up is deliberately disabled on BOTH routes: a MEMBER can read every
application's logs, so an open registration form would hand your logs to anyone with an
email address. The password route is closed by `emailAndPassword.disableSignUp` and by
`disabledPaths`, and the Google route by `disableSignUp` / `disableImplicitSignUp` on the
provider itself (the password flag never reaches an OAuth callback). Accounts are
operator-provisioned and default to `MEMBER` / `isActive: true`.

Create the first administrator with `pnpm --filter @stuffs-logger/dashboard
user:create-admin -- --email … --name …` ([`DEPLOYMENT.md`](./DEPLOYMENT.md)). Every later
user, application, ingest key and API token is managed from the admin screens in the app;
no administrative task needs SQL any more.

Known gap: sign-in does not refuse a deactivated account. It gets a session row that every
page and data gate then refuses with "your account is no longer active". Turning it away at
the sign-in action instead is a small change to `src/app/sign-in/actions.ts`.

If you want self-service instead, the safe shape is sign-up creating `isActive: false`
accounts that an admin approves - a small change to `src/lib/auth/auth.ts`.

## 2. Access model

- Any authenticated, **active** user reads logs and applications (`assertActiveViewer`).
- Only an **ADMIN** manages applications, ingest keys, users and API tokens
  (`assertAdminViewer`).

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
`src/lib/security/csp.ts`. Promoting it also closes §11.

## 5. Quota upsert under concurrency — VERIFIED, closed

`prisma.applicationUsage.upsert` is emitted as a single
`INSERT … ON CONFLICT DO UPDATE SET … + $n` statement. Against a real Postgres 17,
200 concurrent upserts on a fresh `(applicationId, day)` row produced zero failures,
a final count of exactly 200 and 200 distinct returned totals, with no retry. No
unique-violation retry is needed.

## 6. In-memory limiters are per-instance

Five limiters live in module memory and reset on a cold start: ingest rate limiting
(`src/lib/ingest/rate-limit.ts`), the invalid-key throttle
(`src/lib/ingest/invalid-key-throttle.ts`), the secret-key exposure warning throttle
(`src/lib/ingest/secret-key-exposure.ts`), the sign-in throttle
(`src/lib/auth/sign-in-throttle.ts`), and the registered-origin snapshot. Each is a
first line, not a distributed guarantee. The durable per-application quota is the real
ingest ceiling. Making any of them global needs Redis or Vercel KV.

The sign-in throttle matters most. The Server Action calls `auth.api.signInEmail`
directly, which bypasses Better Auth's router-level rate limiting; the converse hole
(the router's own `/api/auth/sign-in/email` bypassing this throttle) is closed by
`disabledPaths` in `src/lib/auth/auth.ts`. The tight window (10 per 15 minutes) is
keyed on `client address | account`, so locking a colleague out now requires sharing
their network address. The price is a looser per-account ceiling: 50 attempts that pass the
per-address gate (at least five distinct addresses) still lock the account from
everywhere for the window, and a successful sign-in by the owner resets both windows. A
durable shared store would also allow keying on verified rather than header-claimed
addresses. Addresses come only from `X-Forwarded-For` entries a trusted proxy appended
(`TRUSTED_PROXY_HOPS`, `src/lib/net/client-ip.ts`); with no trusted proxy every attempt is
keyed on the account alone, and the ingest invalid-key throttle stands down. A shared
address (NAT, office egress) still shares one ingest throttle window, so 60 bad keys from
one machine behind it can delay a real application's logging there for up to a minute.

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
- The e2e teardown (`e2e/setup/teardown.setup.ts`) deactivates the seeded users through
  `@/lib/db` directly; move that `updateMany` into `e2e/support/seed-store.ts` as
  `deactivateSeedUsers` so seed-store stays the only DB-touching harness file.

## 8. A note on `SKIP_AUTH`

`SKIP_AUTH=true` / `NEXT_PUBLIC_SKIP_AUTH=true` returns a mock ADMIN session and is
commented out in `.env.example`. `src/constants/environment.ts` throws at boot if either
is set while `NODE_ENV=production`. That guard is this app's own - nothing in the auth
library enforces it. Keep it. The production auth environment (`BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET`) is asserted at server start in `src/instrumentation.ts`, not at
module load, because `next build` imports every route with `NODE_ENV=production` and no
environment.

## 9. Publishing and release

- **Before the first push to `main`, decide the first version.** semantic-release has no
  tags to read (`git tag -l` is empty), so it treats this as a first release and
  publishes `1.0.0`, not `0.2.0`, ignoring the `0.1.0` in the manifests. To continue the
  0.x line run `git tag v0.1.0 <commit> && git push origin v0.1.0` first. The merge of
  this branch IS the first push: the checklist in [`CI-CD.md`](./CI-CD.md) ("Before the
  first release") must be worked through before it, including protecting the
  `npm-publish` environment and restricting who may create `*-rc` branches, because any
  push to either publishes to public npm.
- **npm credential.** `NPM_TOKEN` must be a granular token that expires (record the
  expiry) or be replaced by npm trusted publishing (`CI-CD.md`, "npm credentials"). The
  release now runs `pnpm whoami` in `verifyConditions`, so an expired token fails before
  the tag is pushed rather than after. After the first rc publish confirm provenance with
  `npm view @stuffs-logger/sdk@<version> dist.attestations`; if absent, switch
  `publishCmd` to the `npm publish` form documented there.
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
  not as a side effect of making the package publishable. The core's workspace
  `exports` now expose the same leaf subpaths as `publishConfig`, which is what keeps
  zod out of the dashboard's client bundle.
- **SDK API change before first publish:** `captureErrors(logger)` on Node no longer
  takes options; the `rethrowUnhandledRejections` option and `ErrorCaptureOptions` type
  were removed. It observes through `uncaughtExceptionMonitor` only, so the process's
  `--unhandled-rejections` mode is never altered. Unpublished, so no semver concern.

## 10. Preflight origin enumeration (accepted)

`OPTIONS /api/v1/ingest` is unauthenticated and answers `Access-Control-Allow-Origin`
only for an origin some live public key has registered, so a caller can probe whether
an origin is registered one preflight at a time (from the in-memory snapshot, so at no
database cost). For a single-organisation self-host the registered origins are the
operator's own sites, and this is accepted. The alternative is to reflect any `Origin`
unconditionally on the preflight - it grants nothing by itself, since the POST re-checks
the origin against the specific key - which would make the probe worthless and let
`src/lib/ingest/origin-registry.ts` and `listRegisteredOrigins` be deleted. Revisit if
the dashboard ever hosts logs for outside parties.

## 11. `createIngestKeyAction` has no intent signal (accepted for now)

The action mints and returns a secret ingest key on a plain POST with no intent signal
beyond the admin session, so same-origin script running under an admin's session (an
XSS, a compromised dependency, a browser extension with page access) could mint and
read a key without the admin clicking anything. The dialog and action are deliberately
left alone because the e2e suite drives the current form. Two remedies, either
sufficient: (a) require a typed confirmation of the application slug, as the revoke
dialog already does, so the action refuses a request that did not carry the typed
value; or (b) promote the CSP from report-only to enforcing (§4), which removes the
injected-script precondition. Pick (a) if enforcing CSP stays deferred.

## 12. Performance items measured and deferred

Measured on a throwaway Postgres 17 seeded with 5,000,000 rows (31 days at the stated
scale). What was fixed is in the code; these were judged not worth their cost today:

- **Lean list DTO with on-demand row detail.** Each list row carries a bounded `context`
  (2 KB) and `errorStack` (2,000 chars) so expanding a row needs no round trip; at
  `limit=200` that is ~60-80 KB gzipped of RSC payload in the realistic case and up to
  ~1 MB in the worst case. Fetching the expanded panel through a Server Action instead
  would trade that for one round trip per first expand. Revisit if pages feel heavy.
- **Native `<dialog>` instead of `@radix-ui/react-dialog`.** 13.8 KB gzipped, only on the
  admin-only `/apps/[slug]` route; the browsers this app already requires all support
  `showModal()`.
- **The `application` relation in `LIST_SELECT`** costs one extra `IN (...)` query per
  page over a tiny table; dropping it would couple the query to the page's application
  list for no measurable gain.
- **Full-window free-text search.** A term that matches nothing walked all 5M rows in
  ~780 ms, so a `search` with no `From` now defaults to the last 24 hours (~50 ms); the
  page says so, and the "All time" quick-range link opts out explicitly with
  `window=all` so a deliberate choice is never silently re-bounded. If making every
  search cover the whole retention window is a requirement, the only index that helps
  `ILIKE '%x%'` is a `pg_trgm` GIN index — likely several hundred MB at this row count
  and a real write cost on ingest. A covering `(timestamp, id) INCLUDE (applicationId,
level)` index would also cut the overview aggregate from 29 ms to ~12 ms for +83 MB.
- **The overview reads `applications` twice** (once for the list, once inside
  `getApplicationActivity` for names). Tiny table; left for the same coupling reason.

## 13. Dependencies

- `pnpm audit` is clean except `braces@3.0.3` (via `micromatch` under semantic-release
  and `eslint-config-next`, dev-only): the advisory names `>=3.0.4` as patched but no
  such version is on the registry. Dependabot (`.github/dependabot.yml`) will propose it
  when it exists.
- `pnpm-workspace.yaml` carries `overrides` for four transitive packages whose dependents
  pin ranges excluding the fix (`deepmerge-ts`, `esbuild`, `vite`, `source-map-js`).
  Drop each entry once the dependent's own range includes the patched version.
- `minimumReleaseAge: 1440` is explicit and therefore STRICT in pnpm 11: a version
  younger than a day is refused at resolution time, and every `pnpm install` re-verifies
  the lockfile against the registry (offline installs need `--trust-lockfile`).
- **`better-auth` is pinned to exactly `1.7.2`, deliberately.** `1.7.3`-`1.7.12` dropped
  the `account.issuer` column (the account model is again keyed on
  `providerId + accountId`, `createLocalAccountIssuer` is gone from `better-auth/db`, and
  `signInEmail` no longer matches on `issuer`). This schema and its migrations were built
  against `1.7.2` with `issuer` NOT NULL and `@@unique([issuer, accountId])`, so a bump
  breaks sign-up, the e2e seeder (`e2e/support/credential-account.ts`) and the typecheck.
  Upgrading is a small auth-table migration — make `issuer` nullable or drop it, replace
  the unique index, drop the helper and its test — to be done on purpose, with existing
  `accounts` rows in mind, not as a side effect of a dependency update. No advisory is
  open against `1.7.2`.

## 14. Runtime verification still owed

- `advanced.database.joins: true` in `src/lib/auth/auth.ts` (one query per session
  instead of two) was enabled on source verification of the Prisma adapter and relation
  names. The e2e sign-in journey is the runtime proof; if every page bounces to sign-in
  after deploying, revert that one line.
- The streaming body cap on `/api/v1/ingest` cancels a chunked upload at 256 KiB; the
  unit test proves the stream is cancelled, but the OOM it prevents was never reproduced
  against a live `next start`.
- If Google credentials were ever set before this branch, run the account audit in
  `DEPLOYMENT.md` ("Provisioning the first administrator").
