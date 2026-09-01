# stuffs-logger — known follow-ups

Everything here was found by review, deliberately deferred, and is not a surprise.
Nothing below blocks the branch; each is a decision or a scoped piece of work.

## 1. Register the app's access mode in the portal (DECISION NEEDED, before deploy)

Log reads are gated to internal Making Stuffs staff (`assertInternalViewer`). Whether a
non-staff user can reach the app at all also depends on the `accessMode` set for the
`stuffs-logger` entry in the portal Application catalog, which lives outside this repo.
Set it deliberately. `STAFF` matches how the code is written today.

If you later want a client to see only their own application's logs, that needs a
per-application entitlement model: `Application` is already the tenant column, and
`buildWhere` in `src/lib/logs/queries.ts` is where the intersection would go. This is a
product decision, not a bug.

## 2. Partition the ingest quota per key (RECOMMENDED)

`ApplicationUsage` is keyed on `(applicationId, day)`. A public key is public by design,
and `Origin` is only truthful from a real browser, so someone who reads your page source
can present a scraped `slg_pub_` key with a forged `Origin` and `source: "browser"` and
spend an application's whole daily quota in roughly 2,500-4,000 requests.

The gap is not the ceiling, it is recovery: **revoking the abused key does not restore
service**, because the counter is per-application. Partition it per key with the
application total as an outer bound, so revocation frees the remaining allowance.
Add an alert when an application crosses a fraction of its quota, and an operator path
to reset a day's counters.

Needs a schema migration; deferred out of the last fix round to avoid risking a green branch.

## 3. Promote CSP from report-only to enforcing

`src/proxy.ts` ships a nonce-based policy in report-only mode. Promotion needs a
`report-uri`/`report-to` collector, or a manual pass over each route. Path documented in
`src/lib/security/csp.ts`.

## 4. Verify the quota upsert under real concurrency

`prisma.applicationUsage.upsert` uses atomic `increment`s, unit-tested through an injected
store. The row-creation half of an upsert under concurrent writers is the classic place a
unique-violation retry is needed. There was no Postgres available to test it against.
Worth one integration test before heavy traffic.

## 5. Rate limiting is per-instance

`src/lib/ingest/rate-limit.ts` counters live in module memory; on Vercel the real ceiling
is `120/min x live instances` and a cold start resets the window. It guards a runaway loop
in a client app, not a determined attacker. The durable per-application quota (item 2) is
the real ceiling. Making the limiter global needs Redis/Vercel KV on the hottest path.

## 6. Smaller items

- `apps/dashboard/src/lib/ingest/keys.ts` has a doc comment implying a public key is safe
  to publish *because* it is origin-gated. The SDK README was corrected to state the real
  residual; this comment was not in the last round's scope and should match it.
- `projection.test.ts` is missing the `expect("polluted" in {}).toBe(false)` assertion its
  two core counterparts carry. Pollution is impossible there by construction; add it so a
  future switch back to plain assignment fails loudly.
- MSW is not installed, so transport tests stub `fetch` directly. Revisit when it can be added.
- No e2e/Playwright suite exists. `test:e2e`/`test:smoke` scripts are not wired up.

## Upstream: salient-auth

`auth-guidelines` states `SKIP_AUTH` "must never be settable in a deployed environment",
implying platform enforcement. Installed `@journey-further/salient-auth@6.0.0-rc.25`
`dist/lib/is-auth-skipped.js` has **no `NODE_ENV` guard at all** - a bare two-variable
string check - and `getSession` then returns `MOCK_SERVER_SESSION` with
`scope: "INTERNAL_ADMIN"`. Every consuming app must enforce this itself. This app does
(`src/constants/environment.ts`). Worth raising with whoever owns the package, since other
apps likely do not.
