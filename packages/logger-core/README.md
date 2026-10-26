# @stuffs-logger/core

The wire contract shared by [`@stuffs-logger/sdk`](https://www.npmjs.com/package/@stuffs-logger/sdk)
and the stuffs-logger dashboard: the ingest schemas, the hard limits both ends
enforce, the log taxonomy, and the key redaction both ends apply.

It exists so the limits the client trims at and the limits the server rejects at
can never drift apart. Everything in it is pure and runtime-agnostic — no Node
built-ins, no DOM, no database.

Most applications do not need to install this directly; the SDK depends on it.

## Install

```bash
pnpm add @stuffs-logger/core
```

## Entry points

The barrel re-exports everything, including the zod-backed ingest schemas —
which means importing it costs you zod:

```ts
import { parseIngestBatch, MAX_EVENTS_PER_BATCH } from "@stuffs-logger/core";
```

Every module is also published on its own subpath, so code that only needs the
limits or the taxonomy pays nothing for zod. This is the trade the SDK makes
internally:

```ts
import { MAX_EVENTS_PER_BATCH } from "@stuffs-logger/core/constants";
import { LOG_LEVELS, levelRank } from "@stuffs-logger/core/taxonomy";
import { createKeyRedactor } from "@stuffs-logger/core/redaction";
```

`./constants`, `./json`, `./keys`, `./redaction`, `./schemas`, `./taxonomy`,
`./text` and `./timestamps` are all available; only `./schemas` (and therefore
the barrel) reaches zod.

## Licence

MIT © MakingStuffs
