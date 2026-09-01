import { ERROR_LEVELS } from "@jf-logger/core";
import type { Prisma } from "@prisma/client";
import type { SalientSession } from "@journey-further/salient-auth/server";

import { assertInternalViewer } from "@/lib/access";
import { prisma } from "@/lib/db";

import type {
  LogEventDetail,
  LogEventListItem,
  LogEventPage,
  ApplicationActivity,
} from "./dto";
import {
  DEVICE_FROM_DB,
  DEVICE_TO_DB,
  LEVEL_FROM_DB,
  LEVEL_TO_DB,
  LOGGER_FROM_DB,
  SOURCE_FROM_DB,
  SOURCE_TO_DB,
} from "./enums";
import type { LogFilters } from "./filters";
import { projectListContext, projectListStack } from "./projection";

/**
 * The dashboard's only interface to log data.
 *
 * Four rules hold for everything in this file:
 *
 *  0. Every read is gated on `assertInternalViewer`. jf-logger is an internal
 *     engineering tool: one session can see every application's logs, and log
 *     lines carry whatever a customer application happened to log, so the read
 *     gate is the same one that guards key management rather than a looser
 *     "any active user" check.
 *
 *     PER-APPLICATION ENTITLEMENT — letting a client-scoped user read only
 *     their own application's logs — is a deliberate FUTURE extension, not an
 *     oversight. It needs a mapping from a Salient account to an Application
 *     that does not exist yet; until it does, the honest boundary is "internal
 *     staff only", and `Application` is the tenant column that extension will
 *     filter on.
 *  1. The caller passes an already-resolved session. No helper here resolves
 *     one — see `lib/access.ts` for why.
 *  2. Queries are built from validated scalars only. No caller anywhere can
 *     supply a `where`, `select`, `include` or ordering; those are constants
 *     declared next to the query.
 *  3. Rows are projected into DTOs before they are returned, so a column that
 *     was not deliberately exposed cannot reach a React tree.
 */

/** Columns the log stream exposes. Fixed, and the only selector `list` uses. */
const LIST_SELECT = {
  id: true,
  applicationId: true,
  timestamp: true,
  receivedAt: true,
  level: true,
  message: true,
  logger: true,
  environment: true,
  release: true,
  source: true,
  sessionId: true,
  url: true,
  deviceType: true,
  os: true,
  browser: true,
  errorName: true,
  // Read, not discarded: see `./projection` for why the heavy columns are
  // returned to the list rather than reduced to a boolean and thrown away.
  context: true,
  errorStack: true,
  application: { select: { slug: true, name: true } },
} as const satisfies Prisma.LogEventSelect;

/** The list columns plus the ones only a single row needs. */
const DETAIL_SELECT = {
  ...LIST_SELECT,
  userAgent: true,
  errorMessage: true,
} as const satisfies Prisma.LogEventSelect;

type ListRow = Prisma.LogEventGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.LogEventGetPayload<{ select: typeof DETAIL_SELECT }>;

/**
 * Builds the `where` clause from validated filters.
 *
 * Every branch maps a checked scalar or fixed-vocabulary literal onto a named
 * column. Nothing from the caller is spread in.
 */
function buildWhere(filters: LogFilters): Prisma.LogEventWhereInput {
  const where: Prisma.LogEventWhereInput = {};

  if (filters.applicationId !== undefined)
    where.applicationId = filters.applicationId;
  if (filters.applicationSlug !== undefined) {
    where.application = { slug: filters.applicationSlug };
  }

  if (filters.level !== undefined) {
    where.level = { in: filters.level.map((level) => LEVEL_TO_DB[level]) };
  }
  if (filters.source !== undefined) {
    where.source = { in: filters.source.map((source) => SOURCE_TO_DB[source]) };
  }
  if (filters.deviceType !== undefined) {
    where.deviceType = {
      in: filters.deviceType.map((device) => DEVICE_TO_DB[device]),
    };
  }
  if (filters.environment !== undefined)
    where.environment = { in: filters.environment };

  if (filters.from !== undefined || filters.to !== undefined) {
    where.timestamp = {
      ...(filters.from === undefined ? {} : { gte: filters.from }),
      ...(filters.to === undefined ? {} : { lte: filters.to }),
    };
  }

  if (filters.search !== undefined) {
    // Parameterised by Prisma — the term is never interpolated into SQL. It is
    // an unanchored, case-insensitive match, which is a sequential scan over
    // whatever the application+time indexes have already narrowed to. That is
    // acceptable because a search is always issued alongside those filters;
    // see the index rationale in schema.prisma.
    where.message = { contains: filters.search, mode: "insensitive" };
  }

  return where;
}

/**
 * Projects a row onto the list DTO, bounding the heavy fields.
 *
 * @param row - The selected row.
 * @param bound - Whether to apply the list budgets. The detail projection
 *   passes `false`: one row is exactly the case the budgets exist to defer to.
 */
function toListItem(row: ListRow, bound: boolean): LogEventListItem {
  const context = bound
    ? projectListContext(row.context)
    : { context: row.context ?? null, truncated: false };
  const stack = bound
    ? projectListStack(row.errorStack)
    : { errorStack: row.errorStack, truncated: false };

  return {
    id: row.id,
    applicationId: row.applicationId,
    applicationSlug: row.application.slug,
    applicationName: row.application.name,
    timestamp: row.timestamp.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    level: LEVEL_FROM_DB[row.level],
    message: row.message,
    logger: LOGGER_FROM_DB[row.logger],
    environment: row.environment,
    release: row.release,
    source: SOURCE_FROM_DB[row.source],
    sessionId: row.sessionId,
    url: row.url,
    deviceType: row.deviceType === null ? null : DEVICE_FROM_DB[row.deviceType],
    os: row.os,
    browser: row.browser,
    errorName: row.errorName,
    hasContext: row.context !== null && row.context !== undefined,
    context: context.context,
    contextTruncated: context.truncated,
    errorStack: stack.errorStack,
    errorStackTruncated: stack.truncated,
  };
}

/**
 * One page of log events, newest first.
 *
 * @param session - The resolved session of the user asking.
 * @param filters - Filters already validated by `parseLogFilters`.
 * @returns A page of projected rows plus the cursor for the next one.
 * @example
 * const page = await listLogEvents(session, filters);
 */
export async function listLogEvents(
  session: SalientSession,
  filters: LogFilters,
): Promise<LogEventPage> {
  assertInternalViewer(session);

  const rows = await prisma.logEvent.findMany({
    where: buildWhere(filters),
    select: LIST_SELECT,
    // Matches the (applicationId, timestamp DESC) indexes. `id` is the
    // tie-break so the ordering is total: without it, rows sharing a
    // millisecond could be returned twice or skipped across page boundaries.
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    // One extra row, to detect a next page without a second count query.
    take: filters.limit + 1,
    ...(filters.cursor === undefined
      ? {}
      : { cursor: { id: filters.cursor }, skip: 1 }),
  });

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;

  const items = page.map((row) => toListItem(row, true));

  return {
    items,
    hasMore,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}

/**
 * A single log event in full.
 *
 * @param session - The resolved session of the user asking.
 * @param id - The event id from the URL, untrusted.
 * @returns The projected row, or `null` when it does not exist.
 */
export async function getLogEvent(
  session: SalientSession,
  id: string,
): Promise<LogEventDetail | null> {
  assertInternalViewer(session);

  const row: DetailRow | null = await prisma.logEvent.findUnique({
    where: { id },
    select: DETAIL_SELECT,
  });

  if (row === null) return null;

  return {
    ...toListItem(row, false),
    userAgent: row.userAgent,
    errorMessage: row.errorMessage,
  };
}

/** The window an overview is computed over. */
export interface ActivityWindow {
  from: Date;
  to: Date;
}

/**
 * Per-application event and error counts over a window.
 *
 * Two grouped aggregates rather than one query per application: the number of
 * applications grows, and a per-application loop would turn the overview into
 * N round trips.
 *
 * @param session - The resolved session of the user asking.
 * @param window - The inclusive time window, on the CLIENT timestamp so the
 *   numbers agree with what the filtered stream shows for the same range.
 * @returns One row per application that has events in the window.
 */
export async function getApplicationActivity(
  session: SalientSession,
  window: ActivityWindow,
): Promise<ApplicationActivity[]> {
  assertInternalViewer(session);

  const timestamp = { gte: window.from, lte: window.to };
  const errorLevels = ERROR_LEVELS.map((level) => LEVEL_TO_DB[level]);

  const [totals, errors, applications] = await Promise.all([
    prisma.logEvent.groupBy({
      by: ["applicationId"],
      where: { timestamp },
      _count: { _all: true },
    }),
    prisma.logEvent.groupBy({
      by: ["applicationId"],
      where: { timestamp, level: { in: errorLevels } },
      _count: { _all: true },
    }),
    prisma.application.findMany({
      select: { id: true, slug: true, name: true },
    }),
  ]);

  const errorsByApplication = new Map(
    errors.map((row) => [row.applicationId, row._count._all]),
  );
  const metaByApplication = new Map(applications.map((row) => [row.id, row]));

  return totals
    .map((row) => {
      const meta = metaByApplication.get(row.applicationId);
      return {
        applicationId: row.applicationId,
        applicationSlug: meta?.slug ?? "unknown",
        applicationName: meta?.name ?? "Unknown application",
        eventCount: row._count._all,
        errorCount: errorsByApplication.get(row.applicationId) ?? 0,
      };
    })
    .sort((left, right) => right.eventCount - left.eventCount);
}

/**
 * The distinct environments seen for an application, for the filter dropdown.
 *
 * @param session - The resolved session of the user asking.
 * @param applicationId - The application to scope to, or undefined for all.
 * @returns Sorted, distinct environment names.
 */
export async function listEnvironments(
  session: SalientSession,
  applicationId?: string,
): Promise<string[]> {
  assertInternalViewer(session);

  const rows = await prisma.logEvent.findMany({
    where: applicationId === undefined ? {} : { applicationId },
    select: { environment: true },
    distinct: ["environment"],
    take: 100,
  });

  return rows
    .map((row) => row.environment)
    .sort((left, right) => left.localeCompare(right));
}
