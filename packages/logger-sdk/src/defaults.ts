import type { LogLevel } from "./contract";

/**
 * The SDK's own defaults and internal bounds.
 *
 * Anything that is part of the WIRE CONTRACT (batch size ceilings, field
 * lengths, body limits) belongs in `@stuffs-logger/core` and is re-exported by
 * `./contract` — it must be identical on both sides of the network. The values
 * here are client-side policy: how eagerly to flush, how much to buffer, how
 * hard to retry.
 */

/** Reported to the server as the producing SDK. Mirrors `package.json`. */
export const SDK_NAME = "@stuffs-logger/sdk";

/** Mirrors the `version` field of this package's `package.json`. */
export const SDK_VERSION = "0.1.0";

/** Idle cadence at which a partial batch is sent. */
export const DEFAULT_FLUSH_INTERVAL_MS = 5000;

/** Queue length that triggers an early flush. */
export const DEFAULT_BATCH_SIZE = 20;

/** Events buffered before the oldest start being dropped. */
export const DEFAULT_MAX_QUEUE_SIZE = 1000;

/** Used when nothing better can be detected. */
export const DEFAULT_ENVIRONMENT = "production";

/** Everything is kept unless the caller narrows it. */
export const DEFAULT_MIN_LEVEL: LogLevel = "trace";

/** Keep every event unless the caller samples. */
export const DEFAULT_SAMPLE_RATE = 1;

/** Substituted for the part of a value that did not fit inside the budget. */
export const TRUNCATION_MARKER = "[truncated]";

/** Substituted for a value already seen on the path to itself. */
export const CIRCULAR_MARKER = "[circular]";

/**
 * Browsers cap the combined body size of all in-flight `keepalive` requests at
 * 64 KiB and fail the request outright above it — well below the server's
 * `MAX_BODY_BYTES`. Unload flushes are trimmed to this instead.
 */
export const MAX_KEEPALIVE_BODY_BYTES = 65536;

/** Consecutive send failures after which a batch is dropped rather than retried. */
export const MAX_SEND_ATTEMPTS = 3;

/** First retry delay; doubles per consecutive failure. */
export const MIN_RETRY_DELAY_MS = 1000;

/** Ceiling on the retry backoff, so a long outage never becomes a spin. */
export const MAX_RETRY_DELAY_MS = 60000;

/**
 * Node budget for normalizing one `context` value.
 *
 * The byte budget alone is not enough: a wide, shallow object of tiny keys can
 * cost a lot of walking before it reaches the byte limit, and this runs on the
 * caller's hot path.
 */
export const MAX_CONTEXT_NODES = 512;

/** Where the browser session id is persisted. */
export const SESSION_STORAGE_KEY = "stuffs-logger.session-id";

/** Stands in for an event whose message normalized to nothing. */
export const EMPTY_MESSAGE_PLACEHOLDER = "(empty)";
