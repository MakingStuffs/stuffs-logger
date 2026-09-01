# `@jf-logger/sdk`

The jf-logger client. One call sets it up, it runs the same way in Node, React,
Next.js and a plain `<script>` tag, and it will not throw into your code no
matter what goes wrong.

- **Drop-in.** `captureConsole()` forwards every `console.*` call to the logger
  and still prints it. No call sites change.
- **Cheap.** Logging queues an event and returns. Batching, serialisation and
  the network all happen off the hot path, on an idle callback.
- **Bounded.** A fixed-length queue, drop-oldest on overflow, capped retry
  backoff. An offline tab never grows.
- **Safe.** Secret-shaped values are redacted before an event is queued, a
  `jfl_sec_` key is refused outright in the browser, and no cookies are ever
  sent to the ingest endpoint.
- **Small.** No runtime dependencies. Measured with `pnpm --filter @jf-logger/sdk size`:
  5.40 KB gzipped for `createLogger` alone, 6.17 KB for the whole browser entry
  point, 6.39 KB for the drop-in `<script>` build.

---

## Install

```sh
pnpm add @jf-logger/sdk
```

## Keys

| Key         | Where it may be used | Why                                                                    |
| ----------- | -------------------- | ---------------------------------------------------------------------- |
| `jfl_pub_…` | Browsers only        | Gated on the request `Origin`, so it is safe to publish in page source |
| `jfl_sec_…` | Servers only         | Grants ingest without an origin check — never ship one to a browser    |

The SDK enforces this itself: a secret key configured in the browser, or a
public key configured in Node, produces an inert logger and an `onError`
diagnostic rather than a request. Ingest would refuse both anyway; failing on
the client means you find out while you are building, not in production.

---

## Node

```ts
import {
  createLogger,
  captureConsole,
  captureErrors,
} from "@jf-logger/sdk/node";

const logger = createLogger({
  apiKey: process.env.JF_LOGGER_API_KEY, // jfl_sec_…
  endpoint: process.env.JF_LOGGER_ENDPOINT, // https://logs.example.com
  environment: process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
});

captureConsole(logger); // every console.* call is now also a log event
captureErrors(logger); // uncaught exceptions and unhandled rejections

logger.info("worker started", { queue: "emails" });
```

Both `apiKey` and `endpoint` fall back to `JF_LOGGER_API_KEY` and
`JF_LOGGER_ENDPOINT`, so with those set in the environment `createLogger()` on
its own is enough.

In a short-lived script, flush before you finish:

```ts
await logger.close();
```

---

## React (Vite, CRA, any bundler)

Create the logger once, at module scope, and export it.

```ts
// src/lib/logger.ts
import { createLogger, captureConsole, captureErrors } from "@jf-logger/sdk";

export const logger = createLogger({
  apiKey: import.meta.env.VITE_JF_LOGGER_KEY, // jfl_pub_…
  environment: import.meta.env.MODE,
});

captureConsole(logger);
captureErrors(logger);
```

```tsx
// src/main.tsx
import "./lib/logger";
```

```tsx
// anywhere
import { logger } from "~/lib/logger";

function Checkout() {
  const onSubmit = async () => {
    try {
      await pay();
    } catch (error) {
      logger.error("payment failed", { error, basketId });
    }
  };
}
```

`endpoint` defaults to the current origin, so if the dashboard is served from
the same host you can leave it out.

---

## Next.js

The logger works in server components, route handlers, Server Actions and
client components. Use two modules so the browser never sees the secret key.

```ts
// lib/logger.server.ts
import "server-only";
import { createLogger, captureErrors } from "@jf-logger/sdk/node";

export const logger = createLogger({
  apiKey: process.env.JF_LOGGER_API_KEY, // jfl_sec_… — server env var, not NEXT_PUBLIC_
  endpoint: process.env.JF_LOGGER_ENDPOINT,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
});

captureErrors(logger);
```

```ts
// lib/logger.client.ts
"use client";
import {
  createLogger,
  captureConsole,
  captureErrors,
} from "@jf-logger/sdk/browser";

export const logger = createLogger({
  apiKey: process.env.NEXT_PUBLIC_JF_LOGGER_KEY, // jfl_pub_… — safe to publish
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV,
});

captureConsole(logger);
captureErrors(logger);
```

```tsx
// app/providers.tsx
"use client";
import "~/lib/logger.client";

export function Providers({ children }: { children: React.ReactNode }) {
  return children;
}
```

```ts
// app/api/checkout/route.ts
import { logger } from "~/lib/logger.server";

export async function POST(request: Request) {
  logger.info("checkout requested", { path: new URL(request.url).pathname });
  // …
}
```

> Never put a `jfl_sec_` key behind a `NEXT_PUBLIC_` variable. Anything
> `NEXT_PUBLIC_` is compiled into the browser bundle.

---

## A plain HTML page

No build step, no module system. The bundle configures itself from its own
`<script>` tag and starts capturing immediately.

```html
<script
  src="https://unpkg.com/@jf-logger/sdk/dist/jf-logger.global.js"
  data-jf-key="jfl_pub_…"
  data-jf-endpoint="https://logs.example.com"
  data-jf-environment="production"
></script>
```

That is the whole setup: `console.log`/`warn`/`error`, `window.onerror` and
unhandled promise rejections are all captured from that point on.

Prefer to configure it yourself? Drop the `data-*` attributes and call `init`:

```html
<script src="https://unpkg.com/@jf-logger/sdk/dist/jf-logger.global.js"></script>
<script>
  JFLogger.init({
    apiKey: "jfl_pub_…",
    endpoint: "https://logs.example.com",
    environment: "production",
  });

  JFLogger.info("page ready", { template: "product" });
</script>
```

`window.JFLogger` exposes `init`, `getLogger`, `createLogger`,
`captureConsole`, `captureErrors`, `flush`, `version` and the level shortcuts
`trace`/`debug`/`info`/`log`/`warn`/`error`/`fatal`. The shortcuts are safe to
call before `init` — they simply do nothing.

---

## Options

Everything except the key has a working default.

| Option            | Default                                                  | Notes                                                               |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `apiKey`          | `JF_LOGGER_API_KEY` (Node)                               | `jfl_pub_…` in browsers, `jfl_sec_…` in Node                        |
| `endpoint`        | Current origin (browser), `JF_LOGGER_ENDPOINT` (Node)    | Origin or full ingest URL; both work                                |
| `environment`     | `JF_LOGGER_ENVIRONMENT`, `NODE_ENV`, else `"production"` | ≤ 64 characters                                                     |
| `release`         | `JF_LOGGER_RELEASE`                                      | ≤ 64 characters                                                     |
| `minLevel`        | `"trace"`                                                | Events below it are discarded before any work is done               |
| `sampleRate`      | `1`                                                      | `0`–`1`                                                             |
| `sampleRates`     | —                                                        | Per-level overrides, e.g. `{ debug: 0.1 }`                          |
| `batchSize`       | `20`                                                     | Queue length that triggers an early flush                           |
| `flushIntervalMs` | `5000`                                                   | Idle flush cadence                                                  |
| `maxQueueSize`    | `1000`                                                   | Hard memory bound; the oldest events are dropped                    |
| `context`         | —                                                        | Static context merged into every event                              |
| `autoContext`     | `true`                                                   | url/userAgent/viewport in the browser; hostname/pid/version in Node |
| `sessionId`       | Persisted in `sessionStorage` (browser)                  | Supply your own to correlate with something you already have        |
| `redaction`       | Enabled, built-in key list                               | `{ enabled, keys, additionalKeys, replacement }`                    |
| `enabled`         | `true`                                                   | `false` builds an inert logger, useful in tests                     |
| `onError`         | —                                                        | Called when the SDK swallows one of its own failures                |
| `transport`       | HTTP                                                     | Inject your own to route batches through a proxy                    |

### Redaction

Any key whose name contains a secret-shaped fragment — `password`, `token`,
`secret`, `authorization`, `cookie`, `apiKey`, `credential`, `session` and
about twenty more — has its value replaced with `"[redacted]"` before the event
is queued. Matching ignores case and punctuation, so `API_KEY`, `api-key`,
`apiKey` and `x-api-key` are all covered.

```ts
createLogger({
  apiKey,
  redaction: {
    additionalKeys: ["customerReference", /^x-internal-/i],
    replacement: "***",
  },
});
```

### Diagnostics

The SDK never throws and never writes to the console on its own. If you want to
see what it is doing:

```ts
createLogger({
  apiKey,
  onError: (error, context) => {
    // `context` is e.g. "logger.config", "transport.send"
    reportToSomethingElse(error, context);
  },
});
```

`logger.stats` exposes `queued`, `dropped`, `sent` and `failed`.

---

## Behaviour worth knowing

**Delivery on navigation.** The queue is flushed on `pagehide` and when the
document becomes hidden, using `fetch(…, { keepalive: true })`. It is _not_
`navigator.sendBeacon`: a beacon cannot set custom headers, and ingest
authenticates on `x-jf-key`, so a beacon would always arrive unauthenticated.
Keepalive requests are capped by the browser at 64 KB, so an unload batch is
trimmed to fit and the remainder stays queued.

**Failure.** A failed send is retried with exponential backoff capped at 60
seconds, keeping the events queued. After three consecutive failures the SDK
probes with a single event at a time instead of a full batch, so a long outage
costs one small request a minute rather than a spin. A `401`/`403` disables the
logger outright — the key will not start working.

**Never throwing.** Every public method is wrapped. A rejecting transport, a
circular context, an object whose getter throws, a missing global, a broken
`onError` hook: all are swallowed and, at most, reported through `onError`.

**No feedback loop.** `captureConsole` plus an SDK that logged its own failures
to `console.error` would be an unbounded loop. Everything the SDK runs on its
own behalf — including your `onError` hook — executes with capture suppressed,
so it cannot re-enter the pipeline.

---

## Entry points

| Import                     | Build                                 |
| -------------------------- | ------------------------------------- |
| `@jf-logger/sdk`           | Isomorphic; picks its runtime at load |
| `@jf-logger/sdk/browser`   | DOM only                              |
| `@jf-logger/sdk/node`      | Node only                             |
| `dist/jf-logger.global.js` | IIFE exposing `window.JFLogger`       |

Browser bundlers are steered to the browser build automatically by the
`browser` condition in `exports`; you only need `/browser` explicitly if your
bundler ignores conditions.

---

## Development

```sh
pnpm --filter @jf-logger/sdk test       # vitest, node + jsdom
pnpm --filter @jf-logger/sdk typecheck
pnpm --filter @jf-logger/sdk lint
pnpm --filter @jf-logger/sdk build      # ESM + CJS + .d.ts + the IIFE
pnpm --filter @jf-logger/sdk size       # rebuilds the IIFE and prints its gzipped size
```

The wire contract's limits — batch size, field lengths, body size — live in
`@jf-logger/core` and are imported, never restated, so the client and the
server can never disagree about them. `src/contract.ts` is the only module
allowed to import from the core: the core's barrel pulls zod in, which does not
tree-shake, so every runtime import there reaches the core's leaf modules
through the `@jf-logger/core/*` path mapping in `tsconfig.json`.
