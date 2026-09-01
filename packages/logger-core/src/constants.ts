/**
 * The hard limits of the ingest wire contract.
 *
 * These live in `@jf-logger/core` so the SDK and the server enforce the SAME
 * numbers. If the SDK trimmed at one bound and the server rejected at another,
 * every batch on the seam between them would be silently dropped.
 */

/** Maximum events accepted in a single batch. */
export const MAX_EVENTS_PER_BATCH = 100;

/** Maximum characters in an event `message`. */
export const MAX_MESSAGE_LENGTH = 8192;

/** Maximum size of an event `context` once serialised to JSON, in bytes. */
export const MAX_CONTEXT_BYTES = 32768;

/** Maximum size of the whole request body, in bytes. */
export const MAX_BODY_BYTES = 262144;

/** Maximum nesting depth of an event `context` object. */
export const MAX_CONTEXT_DEPTH = 8;

/** Maximum characters in the free-text `environment`, `release` and `sessionId` fields. */
export const MAX_SHORT_FIELD_LENGTH = 64;

/** Maximum characters in an event `url`. */
export const MAX_URL_LENGTH = 2048;

/** Maximum characters in an event `userAgent`. */
export const MAX_USER_AGENT_LENGTH = 1024;

/** Maximum characters in `error.name`. */
export const MAX_ERROR_NAME_LENGTH = 256;

/** Maximum characters in `error.stack`. */
export const MAX_ERROR_STACK_LENGTH = 16384;

/**
 * How far into the future a client-supplied timestamp may sit before it is
 * treated as a broken clock and clamped to the server's `receivedAt`.
 */
export const MAX_CLOCK_SKEW_FUTURE_MS = 24 * 60 * 60 * 1000;

/**
 * How far into the past a client-supplied timestamp may sit before it is
 * clamped. Matches the retention window: an event older than the window would
 * be deleted by the next retention run anyway, so accepting it is pointless.
 */
export const MAX_CLOCK_SKEW_PAST_MS = 30 * 24 * 60 * 60 * 1000;

/** The path the SDK POSTs batches to. */
export const INGEST_PATH = "/api/v1/ingest";

/** The header carrying the ingest key. */
export const INGEST_KEY_HEADER = "x-jf-key";

/** Prefix of a browser-safe, origin-gated ingest key. */
export const PUBLIC_KEY_PREFIX = "jfl_pub_";

/** Prefix of a server-side ingest key, formatted `jfl_sec_<keyId>_<secret>`. */
export const SECRET_KEY_PREFIX = "jfl_sec_";
