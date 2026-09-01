import { digestsMatch, sha256Hex } from "@/lib/crypto/digest";
import { prisma } from "@/lib/db";

/**
 * Request-time verification of a machine API token — the counterpart to
 * `getSession` for callers that are not people.
 *
 * The credential is a bearer token, so this module is the whole trust
 * boundary. Four rules shape it:
 *
 * 1. FAIL CLOSED AND FAIL SILENT. Unknown, malformed and revoked tokens all
 *    produce the SAME `{ ok: false, reason: "invalid" }`. Saying which check
 *    failed turns the endpoint into an oracle for which tokens exist.
 * 2. THE RAW TOKEN IS NEVER STORED, LOGGED OR RETURNED. It is hashed once and
 *    compared against the stored digest, using the same
 *    `lib/crypto/digest.ts` helpers the ingest keys use.
 * 3. UNKNOWN AND WRONG COST THE SAME. A missing row is still compared, against
 *    a fixed dummy digest, so the two paths cannot be told apart by timing —
 *    exactly as `verifyIngestKey` does.
 * 4. THE THROTTLE IS CLAIMED HERE, ATOMICALLY. A minimum interval cannot be
 *    enforced by the caller: a read-then-decide guard lets N concurrent
 *    presentations all observe the same `lastUsedAt` and all proceed. It is
 *    one conditional `UPDATE` whose affected-row count IS the decision, and a
 *    refused request never advances the window — otherwise a stream of
 *    rejected attempts could starve the legitimate job forever.
 *
 * There is no application binding any more: this app is not a catalogue of
 * other apps, and a token minted here is a token for here.
 *
 * Server-only: reads the database.
 */

/** The identity a valid token resolves to. Never carries the credential. */
export interface VerifiedApiToken {
  /** `ApiToken.id`, for attributing what the request goes on to do. */
  tokenId: string;
  /** The operator's label for the token, for logs and attribution. */
  name: string;
}

/**
 * Why a verification was refused.
 *
 * - `invalid` — unknown, malformed or revoked. ONE flat reason on purpose.
 * - `rate_limited` — the credential is GOOD but was presented again inside
 *   `minIntervalMs`. Only ever returned after every credential check passed,
 *   so a caller can safely answer `429` here and `401` for `invalid`.
 */
export type ApiTokenDenialReason = "invalid" | "rate_limited";

/** The outcome of a verification. */
export type ApiTokenVerification =
  | { ok: true; token: VerifiedApiToken }
  | { ok: false; reason: ApiTokenDenialReason };

/** What {@link verifyApiToken} needs besides the credential. */
export interface VerifyApiTokenOptions {
  /**
   * Minimum milliseconds between two SUCCESSFUL verifications of the same
   * token. Omit for no throttle. A value that is not a positive finite number
   * refuses every credential: a misconfigured gate fails closed, never open.
   */
  minIntervalMs?: number;
}

/** The columns a verification reads. `tokenHash` never leaves this module. */
const VERIFY_SELECT = {
  id: true,
  name: true,
  tokenHash: true,
  revokedAt: true,
} as const;

/**
 * A digest to compare against when no row was found, so the "unknown token"
 * path costs the same as the "wrong token" path.
 */
const DUMMY_DIGEST = sha256Hex("stuffs-logger-absent-api-token");

const DENY_INVALID = { ok: false, reason: "invalid" } as const;

/**
 * Hashes a raw API token into the digest stored in `api_tokens.tokenHash`.
 *
 * The ONE hash on this surface, so issuing a token and verifying it can never
 * disagree about algorithm or encoding.
 *
 * @param rawToken - The token exactly as issued or presented.
 * @returns The 64-character lowercase hex SHA-256 digest.
 * @example
 * const tokenHash = hashApiToken(rawToken);
 */
export function hashApiToken(rawToken: string): string {
  return sha256Hex(rawToken);
}

/**
 * Atomically claims the right to use a token now, stamping `lastUsedAt`.
 *
 * The eligibility test and the stamp are ONE statement by design: a
 * read-then-write version, even inside a transaction, lets two concurrent
 * verifications both read the old `lastUsedAt`, both decide the interval has
 * passed, and both run the job the interval exists to serialise. Here the
 * row lock decides — whichever `UPDATE` matches first moves the window, and
 * the other matches zero rows.
 *
 * @param tokenId - The row to claim.
 * @param now - The stamp to write, and the reference for the cutoff.
 * @param minIntervalMs - The throttle, or undefined for none.
 * @returns Whether this call won the claim.
 */
async function claimToken(
  tokenId: string,
  now: Date,
  minIntervalMs: number | undefined,
): Promise<boolean> {
  // `updateMany` even without a throttle, so "the row vanished under us" is a
  // count of zero rather than a thrown P2025 on an anonymous request path.
  // `revokedAt: null` is repeated here because revocation can land between the
  // read and the claim.
  const where =
    minIntervalMs === undefined
      ? { id: tokenId, revokedAt: null }
      : {
          id: tokenId,
          revokedAt: null,
          OR: [
            { lastUsedAt: null },
            { lastUsedAt: { lt: new Date(now.getTime() - minIntervalMs) } },
          ],
        };

  const { count } = await prisma.apiToken.updateMany({
    where,
    data: { lastUsedAt: now },
  });

  return count > 0;
}

/** Whether a configured throttle is usable at all. */
function isUsableInterval(minIntervalMs: number | undefined): boolean {
  if (minIntervalMs === undefined) return true;

  return Number.isFinite(minIntervalMs) && minIntervalMs > 0;
}

/**
 * Verifies a raw bearer token and, on success, atomically claims the call.
 *
 * Never throws for a REJECTED CREDENTIAL. Infrastructure failures — the
 * database being unreachable — still propagate, as they must: a caller cannot
 * be allowed to read "no" out of an outage.
 *
 * The caller's remaining job is transport only: pull the bearer value off the
 * `Authorization` header and map the outcome onto a status (`401` for
 * `invalid`, `429` for `rate_limited`).
 *
 * @param rawToken - The value after `Authorization: Bearer `. Empty is refused
 *   like any other bad credential, without spending a query.
 * @param options - See {@link VerifyApiTokenOptions}.
 * @returns The resolved identity, or a flat denial reason.
 * @example
 * const result = await verifyApiToken(presented, { minIntervalMs: 3_600_000 });
 * if (!result.ok) return refuse(result.reason);
 */
export async function verifyApiToken(
  rawToken: string,
  options: VerifyApiTokenOptions = {},
): Promise<ApiTokenVerification> {
  // Configuration is checked BEFORE the credential, and refuses rather than
  // throws: a gate whose throttle is nonsense must let nobody through.
  if (!isUsableInterval(options.minIntervalMs)) return DENY_INVALID;

  if (rawToken.length === 0) return DENY_INVALID;

  const tokenHash = hashApiToken(rawToken);

  const row = await prisma.apiToken.findUnique({
    where: { tokenHash },
    select: VERIFY_SELECT,
  });

  // Compared even when no row was found, so the absent and wrong paths take
  // the same time.
  const matches = digestsMatch(tokenHash, row?.tokenHash ?? DUMMY_DIGEST);

  if (row === null || !matches) return DENY_INVALID;
  if (row.revokedAt !== null) return DENY_INVALID;

  // The claim is LAST so a refused credential never touches `lastUsedAt`.
  const claimed = await claimToken(row.id, new Date(), options.minIntervalMs);
  if (!claimed) {
    // With no throttle the only way to match zero rows is the row disappearing
    // or being revoked between the read and the claim. That is a dead
    // credential, not a throttled one — answering 429 there would tell an
    // anonymous caller their token is still good.
    return {
      ok: false,
      reason: options.minIntervalMs === undefined ? "invalid" : "rate_limited",
    };
  }

  return { ok: true, token: { tokenId: row.id, name: row.name } };
}
