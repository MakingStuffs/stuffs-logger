import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import type { IngestKeyRecord, IngestKeyStore } from "./keys";

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
 * Whether any live public key permits this origin.
 *
 * Used ONLY by the CORS preflight, which cannot see the `x-jf-key` header —
 * browsers do not send custom headers on an `OPTIONS` preflight, so the exact
 * key cannot be identified at that point. Answering from the union of live
 * allowlists keeps the preflight consistent with the allowlist the POST will
 * actually be judged against, and grants nothing on its own: the POST still
 * verifies the key and re-checks the origin against that key's own list.
 *
 * @param origin - The `Origin` header from the preflight, untrusted.
 * @returns Whether to echo the origin back as allowed.
 */
export async function isOriginRegistered(origin: string): Promise<boolean> {
  const match = await prisma.ingestKey.findFirst({
    where: {
      type: "PUBLIC",
      revokedAt: null,
      allowedOrigins: { has: origin },
    },
    select: { id: true },
  });

  return match !== null;
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
