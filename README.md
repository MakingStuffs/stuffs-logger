# stuffs-logger

Self-hosted application logging: a cross-platform TypeScript SDK and a Next.js
dashboard. Built to replace the small slice of a hosted logging vendor we actually
used, without the bill.

```
stuffs-logger/
├── packages/logger-core/   shared wire schema, limits, redaction
├── packages/logger-sdk/    browser + node + <script> client, zero runtime deps
└── apps/dashboard/         ingest API, Postgres/Prisma, log explorer
```

## Quick start

```bash
pnpm install
pnpm --filter @stuffs-logger/dashboard db:generate   # generate the Prisma client
cp apps/dashboard/.env.example apps/dashboard/.env.local
# set DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL
pnpm --filter @stuffs-logger/dashboard db:migrate    # needs a running Postgres
pnpm dev
```

A fresh clone must run `db:generate` before `typecheck` or `build` will pass —
`build` and `typecheck` now do it for you.

Self-service sign-up is off by design. Create the first user, then promote them to
`ADMIN` in the `users` table. Only an ADMIN can mint or revoke ingest keys.

## Using the SDK

```ts
import { createLogger, captureConsole, captureErrors } from "@stuffs-logger/sdk";

const logger = createLogger({ apiKey: "slg_pub_…" });
captureConsole(logger);   // console.log/warn/error still work, and ship
captureErrors(logger);
```

Raw HTML:

```html
<script src="/stuffs-logger.global.js" data-slg-key="slg_pub_…"></script>
```

See `packages/logger-sdk/README.md` for Node, React and Next.js setup, and for what
publishing a public key actually costs you.

## Commands

| | |
|---|---|
| `pnpm test` | all three packages |
| `pnpm typecheck` / `pnpm lint` | |
| `pnpm --filter @stuffs-logger/sdk build` | SDK bundles + size report |

`docs/FOLLOW-UPS.md` records deferred decisions and known gaps.
