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
- **Postgres 14 or newer.** The schema uses a GIN index with `ArrayOps` on
  `ingest_keys.allowedOrigins`; anything modern has it.
- **pnpm 11.22.0**, from the root `packageManager` field.

## Environment variables

Copy `apps/dashboard/.env.example` and fill it in. The complete list, with what
happens if you get it wrong:

| Variable               | Required             | Purpose                                                                                                                                                                                                                                       |
| ---------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | **Yes**              | The runtime connection. Point it at a **pooled** connection in production. The auth tables live in this same database as the log tables.                                                                                                      |
| `DIRECT_DATABASE_URL`  | **Yes**              | The **direct, unpooled** connection, used only by `prisma migrate`. A transaction pooler cannot hold the advisory lock migrations take, so this must bypass it. Often the same value in a simple setup.                                       |
| `BETTER_AUTH_SECRET`   | **Yes**              | Signs session cookies. Better Auth **refuses to start** with its built-in default when `NODE_ENV=production`, which is the correct behaviour — a shared default would let anyone mint a session. Generate one with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL`      | Strongly advised     | This app's own origin, e.g. `https://logger.example.com`. Every `/api/auth/*` URL and OAuth callback is built from it. Left unset, the origin is derived from request headers — which a caller can influence.                                 |
| `GOOGLE_CLIENT_ID`     | No                   | Google sign-in. Set **both** or neither: the provider is registered only when the pair is complete, and the sign-in page only offers the button when it is.                                                                                   |
| `GOOGLE_CLIENT_SECRET` | No                   | As above. The redirect URI to register with Google is `${BETTER_AUTH_URL}/api/auth/callback/google`.                                                                                                                                          |
| `CRON_SECRET`          | If you run retention | The raw API token whose SHA-256 digest is a live row in `api_tokens`. Sent as `Authorization: Bearer <value>` to `/api/cron/retention`.                                                                                                       |

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

**There is no sign-up form, deliberately.** Any signed-in account reads every
application's logs, so self-service registration would hand your logs to
anyone with an email address — `emailAndPassword.disableSignUp` is `true` in
`src/lib/auth/auth.ts`.

The first account therefore has to be created out of band. This is also
recorded in [`FOLLOW-UPS.md`](./FOLLOW-UPS.md) §1.

1. Create the user. The supported route is to temporarily set
   `disableSignUp: false` in `src/lib/auth/auth.ts`, deploy, sign up once, then
   **set it back and redeploy**.
2. Promote them:

   ```sql
   UPDATE users SET role = 'ADMIN' WHERE email = 'you@example.com';
   ```

3. Verify: only an `ADMIN` can see or mint ingest keys, so
   `/apps/<slug>` showing the keys section is the confirmation.

Deactivate a leaver rather than deleting them, so the sessions, the audit trail
of who held which key, and the ability to turn the account back on all survive:

```sql
UPDATE users SET "isActive" = false WHERE email = 'them@example.com';
```

`getSession` reports a deactivated account as its own denial reason and every
data-access gate refuses it, immediately — sessions are row-backed, so this
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
5. **Retention cron:** add a `vercel.json` cron entry hitting
   `/api/cron/retention`, and set `CRON_SECRET` to a token whose digest is a
   live row in `api_tokens`.
6. **Smoke:** set the repository variable `SMOKE_BASE_URL` to the production
   origin, and `release.yml` will check it after each publish.

`@vercel/analytics` is already a dependency and needs no configuration.

## Path 2 — plain Node

Any host that can run a Node process and reach Postgres. No container image is
required.

```sh
# 1. Install and build
pnpm install --frozen-lockfile
pnpm --filter @stuffs-logger/dashboard build

# 2. Apply migrations (reads DIRECT_DATABASE_URL)
pnpm --filter @stuffs-logger/dashboard exec prisma migrate deploy

# 3. Serve
pnpm --filter @stuffs-logger/dashboard start
```

`next start` listens on port 3000 unless `PORT` says otherwise, and sets
`NODE_ENV=production` itself.

Notes for a self-managed host:

- **Put it behind TLS.** The session cookie is `Secure` in production, so the
  app is unusable over plain HTTP anywhere except loopback. `Strict-Transport-Security`
  is also sent in production only.
- **Do not strip the security headers.** `apps/dashboard/next.config.ts` sets
  `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy` and a `Permissions-Policy` on every response except the
  ingest endpoint, which is a cross-origin API and sets its own CORS headers
  per key. The smoke suite asserts on these, so a reverse proxy that drops them
  will be caught.
- **Run the retention sweep** on a schedule, as an authenticated request to
  `/api/cron/retention` carrying `Authorization: Bearer $CRON_SECRET`.
- **One process per instance is fine.** The in-memory ingest rate limiter, the
  sign-in throttle and the registered-origin snapshot are per-instance and
  reset on restart by design; the durable per-application quota in Postgres is
  the real ceiling. See [`FOLLOW-UPS.md`](./FOLLOW-UPS.md) §6.

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
