# Deploying the dashboard

`@stuffs-logger/dashboard` is a standard Next.js 16 application backed by
Postgres. It is **private** and is never published to npm — only
`@stuffs-logger/core` and `@stuffs-logger/sdk` are (see
[`CI-CD.md`](./CI-CD.md)).

This document is deliberately **documentation, not automation**. Nothing in
this repository deploys the dashboard: there is no Dockerfile, no compose file
and no deploy workflow, because where this runs is the operator's decision and
a half-opinionated deploy pipeline is worse than none. Two supported paths are
described below.

> The Postgres **service container** in `.github/workflows/verify.yml` is a
> different thing entirely — a throwaway database for the e2e job, not a
> deployment artefact.

## Prerequisites

- **Node 22 or newer.** The workspace declares `engines.node: ">=22"`; CI runs
  Node 24, which is what production is tested on.
- **Postgres 14 or newer.** Nothing exotic: recursive CTEs, `COUNT(*) FILTER`
  and per-table autovacuum settings, all of which every supported release has.
- **pnpm 11.22.0**, from the root `packageManager` field. pnpm 11 re-verifies
  the lockfile against the registry on every install (`minimumReleaseAge` in
  `pnpm-workspace.yaml`); an offline install needs `--trust-lockfile`.

## Environment variables

Copy `apps/dashboard/.env.example` and fill it in. The complete list, with what
happens if you get it wrong:

| Variable               | Required             | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | **Yes**              | The runtime connection. Point it at a **pooled** connection in production. The auth tables live in this same database as the log tables.                                                                                                                                                                                                                                                                                                                                                           |
| `DIRECT_DATABASE_URL`  | **Yes**              | The **direct, unpooled** connection, used only by `prisma migrate`. A transaction pooler cannot hold the advisory lock migrations take, so this must bypass it. Often the same value in a simple setup.                                                                                                                                                                                                                                                                                            |
| `BETTER_AUTH_SECRET`   | **Yes**              | Signs session cookies. Must be **at least 32 characters**: the server refuses to start in production with a shorter one (`src/instrumentation.ts`), and Better Auth itself refuses its built-in default. Generate one with `openssl rand -base64 32`.                                                                                                                                                                                                                                              |
| `BETTER_AUTH_URL`      | **Yes (production)** | This app's own origin, e.g. `https://logger.example.com` — an `https` origin with no path, query or fragment. Every `/api/auth/*` URL, the trusted origins and the OAuth redirect URI are built from it. The server **refuses to start** in production without it (`src/instrumentation.ts`), because the alternative is deriving all three from each request's `Host` header, which a caller chooses. Cleartext `http` is tolerated only on a loopback host, so a local `next start` still works. |
| `GOOGLE_CLIENT_ID`     | No                   | Google sign-in. Set **both** or neither: the provider is registered only when the pair is complete, and the sign-in page only offers the button when it is.                                                                                                                                                                                                                                                                                                                                        |
| `GOOGLE_CLIENT_SECRET` | No                   | As above. The redirect URI to register with Google is `${BETTER_AUTH_URL}/api/auth/callback/google`.                                                                                                                                                                                                                                                                                                                                                                                               |
| `CRON_SECRET`          | If you run retention | The raw API token whose SHA-256 digest is a live row in `api_tokens`. Sent as `Authorization: Bearer <value>` to `/api/cron/retention`.                                                                                                                                                                                                                                                                                                                                                            |

### Database connection pooling

Prisma opens its own pool per process, sized `num_cpus * 2 + 1` by default,
and on a serverless host every concurrent instance opens its own. A burst of
instances therefore multiplies connections well past what a small Postgres
accepts. Behind a transaction-mode pooler (PgBouncer, Neon's pooled endpoint,
Vercel Postgres's pooled string) keep each instance's share small and let the
pooler do the multiplexing:

```text
DATABASE_URL=postgresql://…/db?pgbouncer=true&connection_limit=3&pool_timeout=10
```

`pgbouncer=true` makes Prisma avoid prepared statements, which transaction-mode
poolers cannot hold between transactions; `connection_limit` caps the
per-instance pool; `pool_timeout` fails a request fast rather than queueing it
until the function times out. Keep `DIRECT_DATABASE_URL` pointed at the
unpooled endpoint for migrations, as above.

### `SKIP_AUTH` must never be set

`SKIP_AUTH=true` / `NEXT_PUBLIC_SKIP_AUTH=true` make `getSession()` return a
mock **ADMIN** session to every visitor: an unauthenticated dashboard exposing
every application's logs, and a mock administrator who can mint and revoke
ingest keys.

`apps/dashboard/src/constants/environment.ts` refuses to boot when either is
set while `NODE_ENV=production`. Keep that guard. Neither variable appears
anywhere in the e2e path either — the suite signs in through the real form.

## Migrations

Run **`prisma migrate deploy`** on every release, before the new code serves
traffic. `deploy` applies the committed migrations and nothing else — it never
generates a migration and never resets a database, which is what makes it the
only safe command to point at a production database.

```sh
pnpm --filter @stuffs-logger/dashboard exec prisma migrate deploy
```

It reads `DIRECT_DATABASE_URL`, so that variable must be present wherever you
run it.

## Provisioning the first administrator

**There is no sign-up, deliberately, on either route.** Any signed-in account
reads every application's logs, so self-service registration would hand your
logs to anyone with an email address. Both doors are shut in
`src/lib/auth/auth.ts`:

- the **password route** by `emailAndPassword.disableSignUp: true`, and by
  `disabledPaths` taking `/api/auth/sign-up/email` off the router entirely;
- the **Google route** by `disableSignUp: true` and `disableImplicitSignUp: true`
  on the provider itself. The password flag does not reach an OAuth callback —
  Better Auth creates a user for an unknown Google account unless the
  _provider_ says not to — so these are not redundant.

> **If `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` were ever set on a deployment
> before the provider flags existed**, anyone with a Google account could have
> signed in and been given a `MEMBER` account. Audit for accounts nobody
> provisioned:
>
> ```sql
> SELECT u.id, u.email, u."createdAt"
>   FROM users u JOIN accounts a ON a."userId" = u.id
>  WHERE a."providerId" = 'google';
> ```
>
> Deactivate any you do not recognise from **Users** in the app, which also
> signs them out everywhere. The **Signs in with** column on that page shows
> Google-only accounts, so it doubles as this audit.

The first administrator has to exist before anyone can manage users in the
app, so it is created from the command line. Point `DATABASE_URL` at the
deployment's database (the same value `prisma migrate deploy` uses) and leave
`SKIP_AUTH` unset — the command refuses to run with it set:

```sh
DATABASE_URL='postgres://…' \
  pnpm --filter @stuffs-logger/dashboard user:create-admin -- \
  --email you@example.com --name "Your Name"
```

It creates an active `ADMIN` through Better Auth's own password hasher and
adapter — the same code the in-app **Add user** uses — and prints a temporary
password **once**. It refuses an address that already exists, in any case. It
runs the TypeScript sources directly, so it needs Node 22.18 or newer and no
build step. Sign in with the temporary password, then change it on
**Account**.

Everything after that happens in the app, for administrators only:

- **Users** adds people with a temporary password shown once (send it through
  a private channel), changes roles, deactivates (which also signs them out
  everywhere), reactivates, and resets passwords — or adds one for a
  Google-only account. An administrator cannot demote, deactivate or reset
  themself there, and nobody can demote or deactivate the last active
  administrator.
- **Applications** creates an application (name, permanent slug, optional
  description), edits its name and description, and deletes it from its
  **Danger zone** by retyping the slug. Deletion permanently removes the
  application's ingest keys, log events and usage history; a very large
  application may need the delete repeated, and each attempt keeps what it
  already removed.
- **Ingest keys** live on each application's page.
- **API tokens** mints and revokes the token the retention job uses (below).

Deactivate a leaver rather than deleting them: the audit trail of who held
which key, and the ability to turn the account back on, both survive.
`getSession` reports a deactivated account as its own denial reason and every
data-access gate refuses it immediately — sessions are row-backed, so this
takes effect on the next request rather than at the next expiry.

If you would rather have self-service, the safe shape is sign-up creating
`isActive: false` accounts that an administrator approves. That is a small
change to `src/lib/auth/auth.ts`.

## Path 1 — Vercel

1. **Import the repository** and set the project's **root directory** to
   `apps/dashboard`.
2. **Build command:** the default is correct. `apps/dashboard`'s `build` script
   is `prisma generate && next build --webpack`, so the Prisma client is
   generated during the build. Vercel caches `node_modules`, and a cached
   install can skip the generation step — if you hit
   `Cannot read properties of undefined (reading 'LogLevel')` at runtime, set
   the build command explicitly to
   `pnpm install && pnpm --filter @stuffs-logger/dashboard build`.
3. **Environment variables:** set every required variable from the table above
   in the project settings, for Production and Preview separately.
   `DATABASE_URL` should be the pooled connection string and
   `DIRECT_DATABASE_URL` the direct one — for Vercel Postgres and Neon these
   are two different values, and using the pooled one for migrations will hang.
4. **Migrations:** Vercel does not run them for you. Either run
   `prisma migrate deploy` from your machine against production before
   promoting the deployment, or add it to the build command:
   `prisma migrate deploy && pnpm --filter @stuffs-logger/dashboard build`.
   Prefer the former for anything with real data — a migration that runs inside
   a build runs on every preview too.
5. **Retention cron:** `apps/dashboard/vercel.json` already schedules
   `/api/cron/retention` daily at 03:00 UTC, so there is nothing to add. What
   you must set is `CRON_SECRET`. Sign in as an administrator, open **API
   tokens** (`/tokens`) and choose **Create token**. Copy the token it shows —
   it is displayed once, and only its SHA-256 digest is stored — and set it as
   `CRON_SECRET` in the project's environment variables. Vercel sends it as
   `Authorization: Bearer <CRON_SECRET>`. A token is accepted at most once an
   hour; a second call inside that window answers `429`. To rotate, mint a new
   token, update `CRON_SECRET`, then revoke the old one.

   Without a live token every invocation is a `401` and retention silently
   never runs; the cron shows green in Vercel because the request was made,
   not because it did anything. Check the function log after the first
   scheduled run.

6. **Smoke:** set the repository variable `SMOKE_BASE_URL` to the production
   origin, and `release.yml` will check it after each publish.

`@vercel/analytics` is already a dependency and needs no configuration. The
root layout renders it only when Vercel's own `VERCEL=1` variable is present,
so a self-hosted build ships neither its script nor its component.

## Path 2 — plain Node

Any host that can run a Node process and reach Postgres. No container image is
required.

```sh
# 1. Install and build
pnpm install --frozen-lockfile
pnpm --filter @stuffs-logger/dashboard build

# 2. Apply migrations (reads DIRECT_DATABASE_URL)
pnpm --filter @stuffs-logger/dashboard exec prisma migrate deploy

# 3. Serve (see below — not `next start`)
cd apps/dashboard
cp -r .next/static .next/standalone/apps/dashboard/.next/static
PORT=3000 HOSTNAME=0.0.0.0 node .next/standalone/apps/dashboard/server.js
```

`next.config.ts` sets `output: "standalone"`, so the build writes a
self-contained server to `apps/dashboard/.next/standalone/` — only the files
the routes actually load, the Prisma query engine included, with no need for
the workspace `node_modules`. Because this is a monorepo the folder mirrors the
repository layout and the server is at
`.next/standalone/apps/dashboard/server.js`. The static assets are not copied
automatically, which is what the `cp` above is for; this app has no `public/`
directory (`/icon.svg` is a build output, not a public file).

`server.js` sets `NODE_ENV=production` itself and reads `PORT` and
`HOSTNAME`. `pnpm --filter @stuffs-logger/dashboard start` still works — the
e2e suite uses it — but Next warns that it is not the server to deploy. Vercel
ignores the standalone setting.

Notes for a self-managed host:

- **Put it behind TLS.** The session cookie is `Secure` in production, so the
  app is unusable over plain HTTP anywhere except loopback. `Strict-Transport-Security`
  is also sent in production only, as `max-age=63072000; includeSubDomains`
  without `preload`: preload is a commitment to the browser preload list, so an
  operator who has submitted their domain to hstspreload.org appends
  `; preload` in `next.config.ts` themselves.
- **Do not strip the security headers.** `apps/dashboard/next.config.ts` sets
  `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy` and a `Permissions-Policy` on every response except the
  ingest endpoint, which is a cross-origin API and sets its own CORS headers
  per key. The smoke suite asserts on these, so a reverse proxy that drops them
  will be caught.
- **The reverse proxy must set `x-forwarded-for`** (or `x-real-ip`) to the
  client's address, and must _overwrite_ any value the client sent rather than
  append to it. The sign-in throttle keys its tight window on
  `client address | account` (`src/lib/auth/sign-in-throttle.ts`), so a proxy
  that forwards a caller-chosen header lets a guesser pick their own window,
  and a proxy that sets none collapses every caller into one. With no proxy at
  all, `next start` fills the header from the socket itself. Better Auth's own
  per-route limiter reads the same header and, with nothing configured,
  trusts a single-value `x-forwarded-for` as-is; if your proxy sends a
  multi-hop chain or a different header, set `advanced.ipAddress.trustedProxies`
  (the proxy CIDRs to strip from the right) or
  `advanced.ipAddress.ipAddressHeaders` in `src/lib/auth/auth.ts` so it keys
  on the real client. The ingest endpoint reads the same header for its
  invalid-key throttle: 60 refused keys per client address per minute, after
  which that address gets a `429` before the key is even looked up
  (`src/lib/ingest/invalid-key-throttle.ts`). A proxy that appends rather than
  overwrites leaves the first entry under the caller's control, which lets them
  dodge the throttle or pin it on someone else's address; a request with neither
  header is never throttled. Like the other in-memory limiters this is per
  instance and resets on restart, so a WAF or edge rate limit on
  `/api/v1/ingest` is still recommended as the durable line.
- **Run the retention sweep** on a schedule, as an authenticated request to
  `/api/cron/retention` carrying `Authorization: Bearer $CRON_SECRET`, where
  `CRON_SECRET` is a token minted on **API tokens** (`/tokens`). A missing or
  revoked token makes every run a `401` — and a silent one, since nothing else
  notices retention not happening.
- **One process per instance is fine.** The in-memory ingest rate limiter, the
  invalid-key throttle, the sign-in throttle and the registered-origin snapshot
  are per-instance and reset on restart by design; the durable per-application
  quota in Postgres is the real ceiling. See [`FOLLOW-UPS.md`](./FOLLOW-UPS.md)
  §6.
- **The seeded e2e accounts can never reach a deployment.** The harness refuses
  any non-loopback database unless `E2E_ALLOW_REMOTE_DATABASE=1`, refuses any
  database name containing `prod`, `production` or `live` as a word, and
  deactivates the seeded users when a run ends ([`CI-CD.md`](./CI-CD.md), "The
  e2e database is an explicit opt-in").

## After deploying

Point the smoke suite at it:

```sh
E2E_BASE_URL=https://logger.example.com \
  SMOKE_BASE_URL=https://logger.example.com pnpm test:smoke
```

**Set both.** Playwright's managed web server is global to its config rather
than per project, so `E2E_BASE_URL` is what tells the run "the server is
already there". Without it, pointing the smoke suite at your deployment would
_also_ build and start a whole local dashboard it never visits.

It checks that the app serves, that an anonymous visitor is refused rather than
shown data, that the ingest endpoint authenticates, and that the security
headers survived your proxy. It writes nothing, holds no session, and records
no trace, video or screenshot — so it is safe to run against production as
often as you like.
