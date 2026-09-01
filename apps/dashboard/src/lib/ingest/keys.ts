import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  parseIngestKey,
  PUBLIC_KEY_PREFIX,
  SECRET_KEY_PREFIX,
  type LogSource,
} from "@jf-logger/core";

/**
 * Ingest key verification — the authentication boundary of the public ingest
 * endpoint.
 *
 * Written against an injected {@link IngestKeyStore} rather than reaching for
 * Prisma directly, so every branch below (revoked, wrong origin, wrong secret,
 * malformed) is exercised by a real unit test instead of a mocked module.
 */

/** The two key designs, mirroring the `IngestKeyType` enum in the schema. */
export type IngestKeyType = "PUBLIC" | "SECRET";

/** The columns verification reads. Deliberately not the whole row. */
export interface IngestKeyRecord {
  id: string;
  applicationId: string;
  type: IngestKeyType;
  /** PUBLIC rows only: the literal key value. */
  publicKey: string | null;
  /** SECRET rows only: the non-secret lookup handle. */
  keyId: string | null;
  /** SECRET rows only: SHA-256 hex digest of the secret segment. */
  secretHash: string | null;
  /** PUBLIC rows only: exact origins the key may be used from. */
  allowedOrigins: string[];
  revokedAt: Date | null;
}

/** The two indexed lookups verification needs. */
export interface IngestKeyStore {
  /** Looks up a PUBLIC key by its literal value. */
  findPublicKey(key: string): Promise<IngestKeyRecord | null>;
  /** Looks up a SECRET key by its non-secret handle. */
  findSecretKeyByKeyId(keyId: string): Promise<IngestKeyRecord | null>;
}

/** The identity a valid key resolves to. Never carries the credential itself. */
export interface VerifiedIngestKey {
  id: string;
  applicationId: string;
  type: IngestKeyType;
  /**
   * The exact allowed origin this request matched, for the CORS echo. `null`
   * for secret keys, which carry no origin restriction.
   */
  matchedOrigin: string | null;
}

/**
 * Why a key was refused.
 *
 * Only two reasons, and `invalid_key` deliberately covers unknown, malformed,
 * revoked and wrong-secret alike: distinguishing them would turn the endpoint
 * into an oracle for which keys exist. `origin_not_allowed` is separate only
 * because a developer misconfiguring their allowlist is the overwhelmingly
 * common case and needs to be diagnosable — and it is reachable only by a
 * caller who already holds a live key.
 */
export type IngestKeyDenialReason = "invalid_key" | "origin_not_allowed";

/** The outcome of verifying a presented key. */
export type IngestKeyVerification =
  | { ok: true; key: VerifiedIngestKey }
  | { ok: false; reason: IngestKeyDenialReason };

const DENY_INVALID = { ok: false, reason: "invalid_key" } as const;
const DENY_ORIGIN = { ok: false, reason: "origin_not_allowed" } as const;

/** Length of a SHA-256 digest in hex characters. */
const SHA256_HEX_LENGTH = 64;

/**
 * A digest to compare against when no row was found, so the "unknown handle"
 * path costs the same as the "wrong secret" path and the two cannot be told
 * apart by timing.
 */
const DUMMY_DIGEST = createHash("sha256")
  .update("jf-logger-absent-key")
  .digest("hex");

/**
 * The SHA-256 hex digest of a key's secret segment.
 *
 * The only representation of a secret key that is ever persisted. Plain
 * SHA-256 rather than a password KDF on purpose: the input is 256 bits of
 * server-generated randomness, not a human-chosen password, so there is no
 * search space for a slow hash to protect.
 *
 * @param secret - The `<secret>` segment of a `jfl_sec_…` key.
 * @returns The lowercase hex digest.
 */
export function hashIngestSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests, false for anything malformed. */
function digestsMatch(presentedHex: string, storedHex: string | null): boolean {
  if (storedHex === null || storedHex.length !== SHA256_HEX_LENGTH)
    return false;
  if (!/^[0-9a-f]+$/.test(storedHex)) return false;

  const presented = Buffer.from(presentedHex, "hex");
  const stored = Buffer.from(storedHex, "hex");
  if (presented.length !== stored.length) return false;

  return timingSafeEqual(presented, stored);
}

/**
 * Verifies a presented ingest key against the store.
 *
 * @param presented - The raw `x-jf-key` header value, untrusted.
 * @param options - The request `Origin` (required for public keys) and the
 *   store to look the key up in.
 * @returns The verified identity, or a flat denial reason.
 */
export async function verifyIngestKey(
  presented: string | null,
  options: { origin: string | null; store: IngestKeyStore },
): Promise<IngestKeyVerification> {
  if (presented === null) return DENY_INVALID;

  // Parsed before any query: a malformed value must not cost a database round
  // trip, or the endpoint becomes a free amplifier for junk traffic.
  const parsed = parseIngestKey(presented);
  if (parsed === null) return DENY_INVALID;

  if (parsed.kind === "public") {
    const row = await options.store.findPublicKey(parsed.key);
    if (row === null || row.type !== "PUBLIC") return DENY_INVALID;
    if (row.revokedAt !== null) return DENY_INVALID;

    // Exact string equality against the stored list. No wildcards, no suffix
    // matching, no URL normalisation: `https://app.example.test.evil.test`
    // must not satisfy an entry for `https://app.example.test`.
    const { origin } = options;
    if (origin === null || !row.allowedOrigins.includes(origin))
      return DENY_ORIGIN;

    return {
      ok: true,
      key: {
        id: row.id,
        applicationId: row.applicationId,
        type: "PUBLIC",
        matchedOrigin: origin,
      },
    };
  }

  const row = await options.store.findSecretKeyByKeyId(parsed.keyId);
  const presentedDigest = hashIngestSecret(parsed.secret);

  // Compared even when no row was found, against a fixed dummy digest, so an
  // absent handle and a wrong secret take the same path and the same time.
  const stored =
    row !== null && row.type === "SECRET" ? row.secretHash : DUMMY_DIGEST;
  const matches = digestsMatch(presentedDigest, stored);

  if (row === null || row.type !== "SECRET") return DENY_INVALID;
  if (!matches) return DENY_INVALID;
  if (row.revokedAt !== null) return DENY_INVALID;

  return {
    ok: true,
    key: {
      id: row.id,
      applicationId: row.applicationId,
      type: "SECRET",
      matchedOrigin: null,
    },
  };
}

/**
 * Whether a key of this class may authenticate a batch from this source.
 *
 * A PUBLIC key is safe to ship in browser JS precisely BECAUSE its only
 * protection is the origin allowlist — and an `Origin` header is something
 * only a browser is obliged to send truthfully. A server-side process can set
 * any origin it likes, so honouring a public key for a `node` batch would make
 * the allowlist decorative. Node callers must therefore hold a secret key.
 *
 * @param type - The verified key's class.
 * @param source - The `source` declared by the batch.
 * @returns Whether the combination is permitted.
 */
export function keyClassAllowsSource(
  type: IngestKeyType,
  source: LogSource,
): boolean {
  if (type === "SECRET") return true;
  return source === "browser";
}

/** Bytes of randomness in a generated key segment. */
const KEY_RANDOM_BYTES = 24;
/** Bytes of randomness in a secret key's non-secret lookup handle. */
const KEY_ID_BYTES = 9;

/** A freshly minted key: the row to persist, plus the one-time plaintext. */
export interface GeneratedIngestKey {
  /** The full key value. Shown to the operator ONCE and never stored for SECRET keys. */
  plaintext: string;
  /** PUBLIC only: the literal value to persist. */
  publicKey: string | null;
  /** SECRET only: the non-secret lookup handle to persist. */
  keyId: string | null;
  /** SECRET only: the digest to persist. */
  secretHash: string | null;
}

/**
 * Mints a new ingest key of the given class.
 *
 * @param type - Which key design to generate.
 * @returns The plaintext to show once, and the columns to persist. For a
 *   SECRET key the plaintext is unrecoverable afterwards by construction.
 */
export function generateIngestKey(type: IngestKeyType): GeneratedIngestKey {
  if (type === "PUBLIC") {
    const key = `${PUBLIC_KEY_PREFIX}${randomBytes(KEY_RANDOM_BYTES).toString("base64url")}`;
    return { plaintext: key, publicKey: key, keyId: null, secretHash: null };
  }

  const keyId = randomBytes(KEY_ID_BYTES).toString("hex");
  const secret = randomBytes(KEY_RANDOM_BYTES).toString("base64url");

  return {
    plaintext: `${SECRET_KEY_PREFIX}${keyId}_${secret}`,
    publicKey: null,
    keyId,
    secretHash: hashIngestSecret(secret),
  };
}
