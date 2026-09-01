import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import type { IngestKeyRecord, IngestKeyStore } from "./keys";
import type { ApplicationUsageStore } from "./quota";

/**
 * The Prisma-backed {@link IngestKeyStore}.
 *
 * A fixed selector, declared as a constant next to the queries that use it, so
 * verification can only ever read these columns. Nothing here is client
 * controlled: both lookups take a value already parsed into a known key shape.
 */
const VERIFY_SELECT = {
  id: true,
  applicationId: true,
  type: true,
  publicKey: true,
  keyId: true,
  secretHash: true,
  allowedOrigins: true,
  revokedAt: true,
} as const satisfies Prisma.IngestKeySelect;

export const prismaIngestKeyStore: IngestKeyStore = {
  async findPublicKey(key: string): Promise<IngestKeyRecord | null> {
    return prisma.ingestKey.findUnique({
      where: { publicKey: key },
      select: VERIFY_SELECT,
    });
  },

  async findSecretKeyByKeyId(keyId: string): Promise<IngestKeyRecord | null> {
    return prisma.ingestKey.findUnique({
      where: { keyId },
      select: VERIFY_SELECT,
    });
  },
};

/**
 * Every origin registered by a live public key.
 *
 * Used ONLY by the CORS preflight, which cannot see the `x-slg-key` header —
 * browsers do not send custom headers on an `OPTIONS` preflight, so the exact
 * key cannot be identified at that point. The union of live allowlists keeps
 * the preflight consistent with the allowlist the POST will actually be judged
 * against, and grants nothing on its own: the POST still verifies the key and
 * re-checks the origin against that key's own list.
 *
 * The whole set is read at once, and `lib/ingest/origin-registry` holds it for
 * a TTL, so an anonymous preflight never costs a query no matter what `Origin`
 * it carries. Only the allowlist column is selected — the same rows carry key
 * material, and none of it is wanted here.
 *
 * @returns The registered origins, with duplicates left in; the caller builds
 *   a set from them.
 */
export async function listRegisteredOrigins(): Promise<string[]> {
  const keys = await prisma.ingestKey.findMany({
    where: { type: "PUBLIC", revokedAt: null },
    select: { allowedOrigins: true },
  });

  return keys.flatMap((key) => key.allowedOrigins);
}

/**
 * Inserts a batch of validated rows.
 *
 * `skipDuplicates` is off: rows carry generated ids, so there is nothing to
 * collide on, and silently swallowing a constraint failure would hide a real
 * schema problem.
 *
 * @param rows - Rows produced by `normaliseBatch`.
 * @returns How many rows were written.
 */
export async function insertLogEvents(
  rows: Prisma.LogEventCreateManyInput[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const result = await prisma.logEvent.createMany({ data: rows });
  return result.count;
}

/**
 * The Prisma-backed {@link ApplicationUsageStore}.
 *
 * One `upsert` with atomic `increment` operations: the row is created on the
 * day's first batch and advanced by every batch after it, in a single
 * statement, so two instances writing concurrently are both counted. A
 * read-then-write would lose one of them, and a ceiling that undercounts under
 * load is a ceiling that fails exactly when it matters.
 *
 * `byteCount` is a BigInt column - a busy day passes two billion bytes long
 * before it passes two billion events - and is narrowed to a number for the
 * comparison, which is safe well past any plausible daily quota.
 */
export const prismaApplicationUsageStore: ApplicationUsageStore = {
  async increment({ applicationId, day, delta }) {
    const row = await prisma.applicationUsage.upsert({
      where: { applicationId_day: { applicationId, day } },
      create: {
        applicationId,
        day,
        eventCount: delta.events,
        byteCount: BigInt(delta.bytes),
      },
      update: {
        eventCount: { increment: delta.events },
        byteCount: { increment: BigInt(delta.bytes) },
      },
      select: { eventCount: true, byteCount: true },
    });

    return { eventCount: row.eventCount, byteCount: Number(row.byteCount) };
  },
};

/**
 * Stamps a key's `lastUsedAt`.
 *
 * Failure is swallowed on purpose: this is a usage signal, and losing one
 * write must never turn an otherwise accepted batch into a 500.
 *
 * @param keyId - The verified key's row id.
 * @param at - The timestamp to record.
 */
export async function stampKeyLastUsed(keyId: string, at: Date): Promise<void> {
  try {
    await prisma.ingestKey.update({
      where: { id: keyId },
      data: { lastUsedAt: at },
    });
  } catch (error) {
    console.warn(
      `[ingest] could not stamp lastUsedAt for key ${keyId}:`,
      error,
    );
  }
}
