# `@stuffs/logger`

[![npm](https://img.shields.io/npm/v/@stuffs/logger)](https://www.npmjs.com/package/@stuffs/logger)
[![Node](https://img.shields.io/node/v/@stuffs/logger)](https://nodejs.org)
[![Licence](https://img.shields.io/npm/l/@stuffs/logger)](./LICENSE)

The stuffs-logger client. One call sets it up, it runs the same way in Node, React,
Next.js and a plain `<script>` tag, and it will not throw into your code no
matter what goes wrong.

- **Drop-in.** `captureConsole()` forwards every `console.*` call to the logger
  and still prints it. No call sites change.
- **Cheap.** Logging queues an event and returns. Batching, serialization and
  the network all happen off the hot path, on an idle callback.
- **Bounded.** A fixed-length queue, drop-oldest on overflow, capped retry
  backoff. An offline tab never grows.
- **Safe.** Secret-shaped context keys and url parameters are redacted before
  an event is queued, a `slg_sec_` key is refused outright in the browser, a
  cleartext `http:` endpoint is refused off `localhost`, and no cookies are
  ever sent to the ingest endpoint.
- **Small.** No third-party code in the bundle: **6.83 KB** gzipped for
  `createLogger` alone, **7.55 KB** for the whole browser entry point, **7.81 KB**
  for the drop-in `<script>` build. Every build re-measures and records those
  three figures in `dist/size.json`, which ships in the package — so you can
  check them rather than take this paragraph's word for it.

---

## Install

```sh
pnpm add @stuffs/logger
```

You need a dashboard to send to, and an ingest key from it. See
[the project README](https://github.com/MakingStuffs/stuffs-logger#readme) for
running one.

### About that dependency

`package.json` lists exactly one: `@stuffs/logger-core`, the shared wire
contract. Its **code** is inlined at build time, so nothing from it reaches
your bundle — but the emitted type declarations still refer to it, so the
dependency is real for TypeScript consumers and cannot be dropped.

The honest consequence: installing this package also installs `zod`
transitively, through the core. It is never imported at runtime and never
appears in any of the bundles above — but it is in your `node_modules` and your
lockfile, and calling that "zero dependencies" would be a lie.

## Keys

| Key         | Where it may be used | Why                                                                 |
| ----------- | -------------------- | ------------------------------------------------------------------- |
| `slg_pub_…` | Browsers only        | Origin-checked at ingest, so it is meant to live in page source     |
| `slg_sec_…` | Servers only         | Grants ingest without an origin check — never ship one to a browser |

The SDK enforces this itself: a secret key configured in the browser, or a
public key configured in Node, produces an inert logger and an `onError`
diagnostic rather than a request. Ingest would refuse both anyway; failing on
the client means you find out while you are building, not in production.

### What publishing a public key actually costs you

The origin allowlist constrains **real browsers**, and only those. A page
served from an origin you have not allowed cannot POST with your public key,
because the browser sets `Origin` and will not let the page lie about it.
Nothing outside a browser is under that constraint: `source` is a field in the
request body, so a script, a bot or a `curl` invocation can declare
`source: "browser"`, send whatever `Origin` it likes, and be accepted.

So read a published public key as exactly what it is: **a write credential for
one application's log stream, which anyone who can read your page source can
replay.** What it is not bounds the damage — it grants no read access to
anything, it cannot write into any other application, and everything it writes
is counted against that application's daily event and byte quota, after which
ingest refuses the key until the day rolls over. The realistic worst case is
junk in one log stream and a quota spent early.

That is an accepted trade for "drop a script tag on a static site", and it is
the same trade every browser telemetry SDK makes. If it is not one you want to
make for a particular application, do not put a key in the page at all: proxy
ingest through your own server, authenticate the caller however you already
authenticate them, and hold a `slg_sec_` key there.

**There is no `app` option, deliberately.** Which application a batch belongs
to is derived server-side from the verified key. Letting a caller name its own
application would let anyone holding one key write events into another
application; the key is the identity, so the SDK never states it.

The endpoint must be `https:` unless its host is `localhost`, `127.0.0.1` or
`[::1]`. An `http:` endpoint anywhere else is refused with an `onError`
diagnostic, because the key is sent as a request header on every batch.
Anything else in the endpoint URL — embedded `user:password@` credentials, a
query string, a fragment — is discarded; the credentials are reported through
`onError` as well, since ingest would never have read them and `fetch` refuses
a URL that carries them.

---

## Node

```ts
import {
  captureConsole,
  captureErrors,
  createLogger,
} from "@stuffs/logger/node";

const logger = createLogger({
  apiKey: process.env.STUFFS_LOGGER_API_KEY, // slg_sec_…
  endpoint: process.env.STUFFS_LOGGER_ENDPOINT, // https://logs.example.com
  environment: process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
});

captureConsole(logger); // every console.* call is now also a log event
captureErrors(logger); // uncaught exceptions and unhandled rejections

logger.info("worker started", { queue: "emails" });
```

Both `apiKey` and `endpoint` fall back to `STUFFS_LOGGER_API_KEY` and
`STUFFS_LOGGER_ENDPOINT`, so with those set in the environment `createLogger()` on
its own is enough.

`captureErrors` observes; it never changes what the process does with a
failure. It installs a single `uncaughtExceptionMonitor` listener — the hook
Node provides for exactly this, which fires alongside the default handling and
cannot suppress it — and no `uncaughtException` or `unhandledRejection`
listener at all, so the default crash and whatever `--unhandled-rejections`
mode you run with are untouched. An exception and a rejection Node is raising
as one both arrive through that monitor and are recorded as `fatal`, under the
`uncaughtException` and `unhandledrejection` kinds respectively. A rejection
that Node is _not_ raising (`--unhandled-rejections=warn` or `none`) is not
seen, because nothing fatal happened.

In a short-lived script, flush before you finish:

```ts
await logger.close();
```

---

## React (Vite, CRA, any bundler)

Create the logger once, at module scope, and export it.

```ts
// src/lib/logger.ts
import { captureConsole, captureErrors, createLogger } from "@stuffs/logger";

export const logger = createLogger({
  apiKey: import.meta.env.VITE_STUFFS_LOGGER_KEY, // slg_pub_…
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
import { captureErrors, createLogger } from "@stuffs/logger/node";

export const logger = createLogger({
  apiKey: process.env.STUFFS_LOGGER_API_KEY, // slg_sec_… — server env var, not NEXT_PUBLIC_
  endpoint: process.env.STUFFS_LOGGER_ENDPOINT,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
});

captureErrors(logger);
```

```ts
// lib/logger.client.ts
"use client";
import {
  captureConsole,
  captureErrors,
  createLogger,
} from "@stuffs/logger/browser";

export const logger = createLogger({
  apiKey: process.env.NEXT_PUBLIC_STUFFS_LOGGER_KEY, // slg_pub_… — see "Keys" above
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

> Never put a `slg_sec_` key behind a `NEXT_PUBLIC_` variable. Anything
> `NEXT_PUBLIC_` is compiled into the browser bundle.

---

## A plain HTML page

No build step, no module system. The bundle configures itself from its own
`<script>` tag and starts capturing immediately.

```html
<script
  src="https://unpkg.com/@stuffs/logger/dist/stuffs-logger.global.js"
  data-slg-key="slg_pub_…"
  data-slg-endpoint="https://logs.example.com"
  data-slg-environment="production"
></script>
```

That is the whole setup: `console.log`/`warn`/`error`, `window.onerror` and
unhandled promise rejections are all captured from that point on.

Pin a version (`@stuffs/logger@1.2.3/dist/…`) or serve the file from your
own origin rather than tracking whatever the CDN's latest happens to be — the
tag above executes with your page's privileges, so whoever controls that URL
controls your page. Once there are published versions to pin, add an
`integrity` hash and `crossorigin="anonymous"` next to the pinned version;
nothing is published yet, so there is no real hash to quote here.

Prefer to configure it yourself? Drop the `data-*` attributes and call `init`.
Pin or self-host this URL as well; it is the same tag, with the same
privileges:

```html
<script src="https://unpkg.com/@stuffs/logger/dist/stuffs-logger.global.js"></script>
<script>
  StuffsLogger.init({
    apiKey: "slg_pub_…",
    endpoint: "https://logs.example.com",
    environment: "production",
  });

  StuffsLogger.info("page ready", { template: "product" });
</script>
```

`window.StuffsLogger` exposes `init`, `getLogger`, `createLogger`,
`captureConsole`, `captureErrors`, `flush`, `version` and the level shortcuts
`trace`/`debug`/`info`/`log`/`warn`/`error`/`fatal`. The shortcuts are safe to
call before `init` — they simply do nothing.

---

## Options

Everything except the key has a working default.

| Option            | Default                                                      | Notes                                                               |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `apiKey`          | `STUFFS_LOGGER_API_KEY` (Node)                               | `slg_pub_…` in browsers, `slg_sec_…` in Node                        |
| `endpoint`        | Current origin (browser), `STUFFS_LOGGER_ENDPOINT` (Node)    | Origin or full ingest URL; both work                                |
| `environment`     | `STUFFS_LOGGER_ENVIRONMENT`, `NODE_ENV`, else `"production"` | ≤ 64 characters                                                     |
| `release`         | `STUFFS_LOGGER_RELEASE`                                      | ≤ 64 characters                                                     |
| `minLevel`        | `"trace"`                                                    | Events below it are discarded before any work is done               |
| `sampleRate`      | `1`                                                          | `0`–`1`                                                             |
| `sampleRates`     | —                                                            | Per-level overrides, e.g. `{ debug: 0.1 }`                          |
| `batchSize`       | `20`                                                         | Queue length that triggers an early flush                           |
| `flushIntervalMs` | `5000`                                                       | Idle flush cadence                                                  |
| `maxQueueSize`    | `1000`                                                       | Hard memory bound; the oldest events are dropped. Capped at 100 000 |
| `context`         | —                                                            | Static context merged into every event                              |
| `autoContext`     | `true`                                                       | url/userAgent/viewport in the browser; hostname/pid/version in Node |
| `sessionId`       | Persisted in `sessionStorage` (browser)                      | Supply your own to correlate with something you already have        |
| `redaction`       | Enabled, built-in key list                                   | `{ enabled, keys, additionalKeys, replacement }`                    |
| `enabled`         | `true`                                                       | `false` builds an inert logger, useful in tests                     |
| `onError`         | —                                                            | Called when the SDK swallows one of its own failures                |
| `transport`       | HTTP                                                         | Inject your own to route batches through a proxy                    |

### Redaction

Any key whose name contains a secret-shaped fragment — `password`, `token`,
`secret`, `authorization`, `cookie`, `apiKey`, `credential`, `session` and
about twenty more — has its value replaced with `"[redacted]"` before the event
is queued. Matching ignores case and punctuation, so `API_KEY`, `api-key`,
`apiKey` and `x-api-key` are all covered.

An object passed _as_ the message — `console.error({ password })`,
`logger.info(request)` — is walked by the same rules before it is stringified,
so its secret-shaped keys are redacted too.

The same matching runs over the captured `url`: query and fragment parameters
whose NAME looks secret are replaced, and credentials embedded in the authority
(`https://user:password@host`) are stripped. In a url a further set of names is
matched exactly, because OAuth and OIDC callbacks carry their credentials under
names too generic to put on the context-key list: `code`, `state`, `nonce`,
`key`, `sig`, `signature`, `verifier`, `challenge`, `id_token`, `access_token`,
`refresh_token` and `session_state`. A password-reset link or an OAuth callback
is therefore stored without its token.

```
https://app.example.com/reset?token=abc123&step=2
https://app.example.com/reset?token=[redacted]&step=2
```

**Path segments are never redacted.** Only parameter names are matched, so a
secret carried in the path itself (`/reset/abc123`) is stored as written —
there is no name to recognise it by.

**What redaction does not cover.** `message` strings, `error.message` and
`error.stack` are sent as written. A token interpolated into a log message is
shipped and stored: scanning free text for secrets costs a pass over every
character on your hot path and its false positives silently corrupt the text
you are reading the log to understand. Keep credentials out of message strings.

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
    // `context` is e.g. "logger.config", "transport.send", "transport.rejected"
    reportToSomethingElse(error, context);
  },
});
```

`logger.stats` exposes `queued`, `dropped`, `sent` and `failed`. `sent` counts
the events the server reports it accepted, not the events that were posted: a
batch ingest took in but partly refused is reported through `onError` as
`transport.rejected`, and the refused events are not counted as sent.

---

## Behaviour worth knowing

**Delivery on navigation.** The queue is flushed on `pagehide` and when the
document becomes hidden, using `fetch(…, { keepalive: true })`. It is _not_
`navigator.sendBeacon`: a beacon cannot set custom headers, and ingest
authenticates on `x-slg-key`, so a beacon would always arrive unauthenticated.
Browsers cap the combined body of in-flight keepalive requests at 64 KB, so the
unload path sends exactly one request, trimmed to fit, and the remainder stays
queued for the next page view. An unload flush never waits behind an ordinary
flush that is already in the air — that is precisely the case a slow network
produces, and waiting would lose the batch.

**Body limits.** Batches are measured in UTF-8 bytes, not UTF-16 code units, so
a batch of CJK — three bytes per code unit — is split into as many requests as
it needs rather than being sent over the limit and refused. Splitting costs a
request; being refused would cost the events.

**Failure.** A failed send is retried with exponential backoff capped at 60
seconds, keeping the events queued. A server `Retry-After` can lengthen that
wait but never shorten it. After three consecutive failures the SDK probes with
a single event at a time instead of a full batch, so a long outage costs one
small request a minute rather than a spin. A `401`/`403` disables the logger
outright — the key will not start working. A redirect is never followed: the
ingest endpoint does not redirect, and following one would hand the key header
to whichever origin the redirect named.

**Never throwing.** Every public method is wrapped. A rejecting transport, a
circular context, an object whose getter throws, a missing global, a broken
`onError` hook: all are swallowed and, at most, reported through `onError`.

**No feedback loop.** `captureConsole` plus an SDK that logged its own failures
to `console.error` would be an unbounded loop. Everything the SDK runs on its
own behalf — including your `onError` hook — executes with capture suppressed,
so it cannot re-enter the pipeline.

---

## Entry points

Three, exactly as the package's `exports` map declares them:

| Import                   | Build                                                               |
| ------------------------ | ------------------------------------------------------------------- |
| `@stuffs/logger`         | Isomorphic; a bundler's `browser` condition picks the browser build |
| `@stuffs/logger/browser` | DOM only                                                            |
| `@stuffs/logger/node`    | Node only                                                           |

ESM and CJS are both published for all three, with matching `.d.ts` and
`.d.cts`. You only need `/browser` explicitly if your bundler ignores export
conditions.

The `<script>` build is deliberately _not_ an import path. It is the minified
IIFE at `dist/stuffs-logger.global.js` — on a CDN,
`https://unpkg.com/@stuffs/logger/dist/stuffs-logger.global.js`, which is
also what bare `https://unpkg.com/@stuffs/logger` resolves to — and it only
does its job when loaded by a `<script>` tag: it assigns `window.StuffsLogger`
as a side effect and exports nothing, so importing it from a bundled module
would define no bindings and, under tree-shaking, might not run at all. Use the
module entry points from a bundler and the script URL from HTML.

Requires Node **≥ 22** for the Node entry point; the browser builds target
ES2022.

---

## Source and issues

Developed in the [stuffs-logger monorepo](https://github.com/MakingStuffs/stuffs-logger),
alongside the dashboard that receives these events. Bugs and questions:
[github.com/MakingStuffs/stuffs-logger/issues](https://github.com/MakingStuffs/stuffs-logger/issues).

The wire contract's limits — batch size, field lengths, body size — live in
`@stuffs/logger-core` and are imported by both ends, never restated, so the
client and the server cannot disagree about them.

MIT licensed.
