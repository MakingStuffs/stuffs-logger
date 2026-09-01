import { PUBLIC_KEY_PREFIX, SECRET_KEY_PREFIX } from "./constants";

/**
 * Parsing of the ingest key wire format.
 *
 * Pure and dependency-free so the SDK can reject an obviously malformed key at
 * configuration time and the server can parse the presented one — both against
 * exactly one definition of the format. No hashing or comparison happens here;
 * that is server-only and lives with the database lookup.
 */

/** Characters permitted in a key's random segments (base64url alphabet). */
const KEY_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Characters permitted in the non-secret lookup handle of a secret key. */
const KEY_ID_PATTERN = /^[A-Za-z0-9-]+$/;

/** Bounds on a key's random segment, wide enough to survive a format change. */
const MIN_SEGMENT_LENGTH = 16;
const MAX_SEGMENT_LENGTH = 128;

/** Bounds on the non-secret lookup handle. */
const MIN_KEY_ID_LENGTH = 8;
const MAX_KEY_ID_LENGTH = 64;

/** Total length bound, checked first so a huge header is rejected cheaply. */
const MAX_KEY_LENGTH = 256;

/**
 * A successfully parsed ingest key.
 *
 * A discriminated union rather than a bag of optional fields: a public key has
 * no `keyId`, a secret key has no standalone literal value, and neither state
 * should be representable on the other.
 */
export type ParsedIngestKey =
  | {
      /** The key class a browser uses; ingest gates it on the request `Origin`. */
      kind: "public";
      /** The full literal key, which is what the database stores and looks up. */
      key: string;
    }
  | {
      /** Server-side key; no origin restriction. */
      kind: "secret";
      /** The non-secret lookup handle — safe to index, log and query on. */
      keyId: string;
      /** The secret segment. Only ever compared against a stored hash. */
      secret: string;
    };

function isValidSegment(value: string): boolean {
  return (
    value.length >= MIN_SEGMENT_LENGTH &&
    value.length <= MAX_SEGMENT_LENGTH &&
    KEY_SEGMENT_PATTERN.test(value)
  );
}

/**
 * Parses a presented ingest key.
 *
 * @param raw - The raw `x-jf-key` header value, untrusted.
 * @returns The parsed key, or `null` when the value is not a well-formed key
 *   of either type. A malformed key is indistinguishable from an unknown one
 *   to the caller by design — both answer 401.
 * @example
 * parseIngestKey("jfl_sec_abc12345_s3cr3t…"); // { kind: "secret", keyId, secret }
 */
export function parseIngestKey(raw: string): ParsedIngestKey | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_KEY_LENGTH) return null;

  if (raw.startsWith(PUBLIC_KEY_PREFIX)) {
    const random = raw.slice(PUBLIC_KEY_PREFIX.length);
    if (!isValidSegment(random)) return null;
    return { kind: "public", key: raw };
  }

  if (raw.startsWith(SECRET_KEY_PREFIX)) {
    const rest = raw.slice(SECRET_KEY_PREFIX.length);
    const separator = rest.indexOf("_");
    if (separator === -1) return null;

    const keyId = rest.slice(0, separator);
    const secret = rest.slice(separator + 1);

    const hasValidKeyId =
      keyId.length >= MIN_KEY_ID_LENGTH &&
      keyId.length <= MAX_KEY_ID_LENGTH &&
      KEY_ID_PATTERN.test(keyId);

    if (!hasValidKeyId || !isValidSegment(secret)) return null;
    return { kind: "secret", keyId, secret };
  }

  return null;
}
