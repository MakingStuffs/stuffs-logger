/**
 * The one and only seam between the SDK and `@jf-logger/core`.
 *
 * The core's barrel (`@jf-logger/core`) re-exports its zod-backed ingest
 * schemas, and zod is NOT tree-shakeable out of that barrel — measured with
 * esbuild, a bundle that imports only `MAX_EVENTS_PER_BATCH` from the barrel
 * still weighs 87 KB gzipped because zod's top-level schema construction is
 * not statically provable as side-effect free. Every RUNTIME value therefore
 * comes from the core's leaf modules via the `@jf-logger/core/*` path mapping
 * in this package's tsconfig; that mapping exists only because the core's
 * `exports` map publishes the barrel alone. TYPES are safe to take from the
 * barrel: `export type` is erased before a bundler ever sees it.
 *
 * Keeping the seam in one module means the "never import the barrel at
 * runtime" rule is enforceable by reading a single file rather than by
 * auditing every import in the package.
 */

export {
  INGEST_KEY_HEADER,
  INGEST_PATH,
  MAX_BODY_BYTES,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_DEPTH,
  MAX_ERROR_NAME_LENGTH,
  MAX_ERROR_STACK_LENGTH,
  MAX_EVENTS_PER_BATCH,
  MAX_MESSAGE_LENGTH,
  MAX_SHORT_FIELD_LENGTH,
  MAX_URL_LENGTH,
  MAX_USER_AGENT_LENGTH,
  PUBLIC_KEY_PREFIX,
  SECRET_KEY_PREFIX,
} from "@jf-logger/core/constants";

export { LOG_LEVELS, levelRank } from "@jf-logger/core/taxonomy";

/**
 * Redaction is ONE control with two ends, so it is one implementation. The
 * client redacts so a secret never enters its buffers; the server redacts
 * because it cannot trust that the client did. A second key list here would
 * mean a key added to the server's list silently never reaching the browser.
 */
export {
  createKeyRedactor,
  DEFAULT_REDACTION_KEYS,
} from "@jf-logger/core/redaction";

export type { KeyRedactor } from "@jf-logger/core/redaction";

export { jsonByteLength } from "@jf-logger/core/json";

export { parseIngestKey } from "@jf-logger/core/keys";

export type { JsonValue } from "@jf-logger/core/json";
export type { LoggerKind, LogLevel, LogSource } from "@jf-logger/core/taxonomy";

export type {
  IngestBatch,
  LogErrorPayload,
  LogEventPayload,
  SdkInfo,
} from "@jf-logger/core";
