import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The two crypto primitives every machine credential in this app is compared
 * with.
 *
 * There is exactly one hash function and exactly one comparison here so the
 * ingest keys (`lib/ingest/keys.ts`) and the machine API tokens
 * (`lib/auth/api-token.ts`) cannot drift apart on algorithm, on encoding, or
 * on whether the final comparison is constant time.
 *
 * PLAIN SHA-256, NOT A PASSWORD KDF, deliberately: every input hashed here is
 * server-generated randomness (192 bits or more), not a human-chosen password.
 * There is no search space for a slow hash to protect, and a work factor would
 * be paid on every verification of a credential that is presented on a
 * schedule. Human passwords are hashed by Better Auth (scrypt) and never reach
 * this module.
 *
 * Server-only (`node:crypto`).
 */

/** Length of a SHA-256 digest in hex characters. */
export const SHA256_HEX_LENGTH = 64;

/** A stored digest is lowercase hex and nothing else. */
const HEX_DIGEST_PATTERN = /^[0-9a-f]+$/;

/**
 * The SHA-256 hex digest of a value.
 *
 * @param value - The literal bytes to digest. Never trimmed or case-folded:
 *   the digest is over exactly what was issued.
 * @returns The 64-character lowercase hex digest.
 * @example
 * sha256Hex("slg_sec_abc"); // "…64 hex characters…"
 */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Returns false for anything malformed rather than throwing: a stored value
 * that is not a digest is a corrupt row, and a corrupt row must refuse the
 * credential rather than take the request down.
 *
 * @param presentedHex - The digest computed from what the caller presented.
 * @param storedHex - The digest read from the database, or null.
 * @returns Whether the two are equal.
 */
export function digestsMatch(
  presentedHex: string,
  storedHex: string | null,
): boolean {
  if (storedHex === null || storedHex.length !== SHA256_HEX_LENGTH)
    return false;
  if (!HEX_DIGEST_PATTERN.test(storedHex)) return false;

  const presented = Buffer.from(presentedHex, "hex");
  const stored = Buffer.from(storedHex, "hex");
  if (presented.length !== stored.length) return false;

  return timingSafeEqual(presented, stored);
}
