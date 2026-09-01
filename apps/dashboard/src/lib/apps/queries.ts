import type { Prisma } from "@prisma/client";
import type { SalientSession } from "@journey-further/salient-auth/server";
import { z } from "zod";

import { assertInternalViewer } from "@/lib/access";
import { prisma } from "@/lib/db";
import type { ApplicationSummary, IngestKeySummary } from "@/lib/logs/dto";

/**
 * Application and ingest-key reads.
 *
 * Same rules as `lib/logs/queries.ts`: every read is gated on
 * `assertInternalViewer`, the session is passed in, the query shape is a
 * constant, and rows are projected before they are returned.
 *
 * The application list is not public information inside the product — it names
 * every client whose app reports to jf-logger — so it carries the same gate as
 * the logs themselves. Per-application entitlement for client-scoped users is
 * a deliberate future extension; see the note in `lib/logs/queries.ts`.
 */

/** Columns an application listing exposes. */
const APPLICATION_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  createdAt: true,
} as const satisfies Prisma.ApplicationSelect;

/**
 * Columns an ingest key listing exposes.
 *
 * `secretHash` is deliberately ABSENT. It is the stored form of a live
 * credential, it has no use in any UI, and the surest way for it never to
 * reach a response is for no selector in this codebase to name it.
 */
const INGEST_KEY_SELECT = {
  id: true,
  applicationId: true,
  name: true,
  type: true,
  publicKey: true,
  allowedOrigins: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
} as const satisfies Prisma.IngestKeySelect;

type ApplicationRow = Prisma.ApplicationGetPayload<{
  select: typeof APPLICATION_SELECT;
}>;
type IngestKeyRow = Prisma.IngestKeyGetPayload<{
  select: typeof INGEST_KEY_SELECT;
}>;

/** URL-safe slug: the only shape a route param may take. */
export const applicationSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9-]*$/,
    "Slug must be lowercase alphanumeric with hyphens",
  );

function toApplicationSummary(row: ApplicationRow): ApplicationSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

function toIngestKeySummary(row: IngestKeyRow): IngestKeySummary {
  return {
    id: row.id,
    applicationId: row.applicationId,
    name: row.name,
    type: row.type,
    publicKey: row.publicKey,
    allowedOrigins: row.allowedOrigins,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Every application, for the app switcher and the overview.
 *
 * @param session - The resolved session of the user asking.
 * @returns Applications ordered by name.
 */
export async function listApplications(
  session: SalientSession,
): Promise<ApplicationSummary[]> {
  assertInternalViewer(session);

  const rows = await prisma.application.findMany({
    select: APPLICATION_SELECT,
    orderBy: { name: "asc" },
  });

  return rows.map(toApplicationSummary);
}

/**
 * One application by its slug.
 *
 * @param session - The resolved session of the user asking.
 * @param slug - The slug from the URL, untrusted.
 * @returns The application, or `null` when the slug is unknown OR malformed —
 *   the two are indistinguishable to the caller on purpose.
 */
export async function getApplicationBySlug(
  session: SalientSession,
  slug: string,
): Promise<ApplicationSummary | null> {
  assertInternalViewer(session);

  const parsed = applicationSlugSchema.safeParse(slug);
  if (!parsed.success) return null;

  const row = await prisma.application.findUnique({
    where: { slug: parsed.data },
    select: APPLICATION_SELECT,
  });

  return row === null ? null : toApplicationSummary(row);
}

/**
 * The ingest keys belonging to an application.
 *
 * INTERNAL ONLY. Ingest keys are write credentials, so listing them is gated
 * more tightly than reading logs.
 *
 * @param session - The resolved session of the user asking.
 * @param applicationId - The application whose keys to list.
 * @returns Keys ordered newest first, never including a secret hash.
 * @throws {ApiError} `FORBIDDEN` when the caller is not internal.
 */
export async function listIngestKeys(
  session: SalientSession,
  applicationId: string,
): Promise<IngestKeySummary[]> {
  assertInternalViewer(session);

  const rows = await prisma.ingestKey.findMany({
    where: { applicationId },
    select: INGEST_KEY_SELECT,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(toIngestKeySummary);
}
