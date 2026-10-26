import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { assertActiveViewer, assertAdminViewer } from "@/lib/access";
import type { AppSession } from "@/lib/auth/types";
import { prisma } from "@/lib/db";
import {
  DAILY_BYTE_QUOTA,
  DAILY_EVENT_QUOTA,
  utcDayStart,
} from "@/lib/ingest/quota";
import type { ApplicationSummary, IngestKeySummary } from "@/lib/logs/dto";

import type { ApplicationUsageToday } from "./dto";
import { MAX_APPLICATION_SLUG_LENGTH } from "./limits";
import { APPLICATION_SLUG_PATTERN } from "./slug";

/**
 * Application and ingest-key reads.
 *
 * Same rules as `lib/logs/queries.ts`: every read is gated, the session is
 * passed in, the query shape is a constant, and rows are projected before they
 * are returned.
 *
 * TWO DIFFERENT GATES, deliberately. Reading which applications exist is the
 * same class of thing as reading their logs, so it takes `assertActiveViewer`.
 * Listing INGEST KEYS is not: a key is a live write credential for the public
 * ingest endpoint, so it takes `assertAdminViewer` — the same gate as the
 * actions that mint and revoke them.
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

/** The day's counters, and nothing else from the usage row. */
const APPLICATION_USAGE_SELECT = {
  eventCount: true,
  byteCount: true,
} as const satisfies Prisma.ApplicationUsageSelect;

type ApplicationRow = Prisma.ApplicationGetPayload<{
  select: typeof APPLICATION_SELECT;
}>;
type IngestKeyRow = Prisma.IngestKeyGetPayload<{
  select: typeof INGEST_KEY_SELECT;
}>;

/**
 * URL-safe slug: the only shape a route param may take, and the only shape
 * the create action will store.
 *
 * Built from the pattern in `./slug.ts` so the create dialog's client-side
 * suggestion and this check cannot drift apart.
 */
export const applicationSlugSchema = z
  .string()
  .trim()
  .min(1, "Give the application a slug.")
  .max(MAX_APPLICATION_SLUG_LENGTH)
  .regex(
    APPLICATION_SLUG_PATTERN,
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
  session: AppSession,
): Promise<ApplicationSummary[]> {
  assertActiveViewer(session);

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
  session: AppSession,
  slug: string,
): Promise<ApplicationSummary | null> {
  assertActiveViewer(session);

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
 * ADMIN ONLY. Ingest keys are write credentials, so listing them is gated more
 * tightly than reading logs.
 *
 * @param session - The resolved session of the user asking.
 * @param applicationId - The application whose keys to list.
 * @returns Keys ordered newest first, never including a secret hash.
 * @throws {ApiError} `FORBIDDEN` when the caller is not an administrator.
 */
export async function listIngestKeys(
  session: AppSession,
  applicationId: string,
): Promise<IngestKeySummary[]> {
  assertAdminViewer(session);

  const rows = await prisma.ingestKey.findMany({
    where: { applicationId },
    select: INGEST_KEY_SELECT,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(toIngestKeySummary);
}

/**
 * One application's ingest volume for the current UTC day.
 *
 * A READ, gated like every other application read: the counters say how busy
 * an application is, not how to write to it, so any live account may see
 * them. A day with no row yet is reported as zero rather than as missing —
 * the ingest endpoint creates the row on the first batch, and "nothing sent
 * yet today" is the honest reading of its absence.
 *
 * @param session - The resolved session of the user asking.
 * @param applicationId - The application whose counters to read.
 * @param now - The clock, injected for tests.
 * @returns Today's counters beside the ceilings they are measured against.
 */
export async function getApplicationUsageToday(
  session: AppSession,
  applicationId: string,
  now: Date = new Date(),
): Promise<ApplicationUsageToday> {
  assertActiveViewer(session);

  const day = utcDayStart(now);

  const row = await prisma.applicationUsage.findUnique({
    where: { applicationId_day: { applicationId, day } },
    select: APPLICATION_USAGE_SELECT,
  });

  return {
    day: day.toISOString().slice(0, "YYYY-MM-DD".length),
    eventCount: row?.eventCount ?? 0,
    // Safe as a number: the byte ceiling is 1 GiB, far inside 2^53, and a
    // BigInt could not be serialised to the client component that renders it.
    byteCount: Number(row?.byteCount ?? 0),
    eventQuota: DAILY_EVENT_QUOTA,
    byteQuota: DAILY_BYTE_QUOTA,
  };
}
