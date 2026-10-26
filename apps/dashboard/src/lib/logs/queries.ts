import { ERROR_LEVELS } from "@stuffs-logger/core";
import type { Prisma } from "@prisma/client";

import { assertActiveViewer } from "@/lib/access";
import { ApiError } from "@/lib/api/errors";
import type { AppSession } from "@/lib/auth/types";
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
import { decodeLogCursor, encodeLogCursor } from "./filters";
import type { LogCursor, LogFilters } from "./filters";
import { projectListContext, projectListStack } from "./projection";

/**
 * The dashboard's only interface to log data.
 *
 * Four rules hold for everything in this file:
 *
 *  0. Every read is gated on `assertActiveViewer`. One session sees every
 *     application's logs, and log lines carry whatever an application happened
 *     to log — so the gate is "a live account", and every account in this
 *     product belongs to this company's staff.
 *
 *     PER-APPLICATION ENTITLEMENT — letting an account read only some
 *     applications' logs — is a deliberate FUTURE extension, not an oversight.
 *     It needs a mapping from a user to an Application that does not exist
 *     yet; until it does, "a live staff account" is the honest boundary, and
 *     `Application` is the tenant column that extension will filter on.
 *  1. The caller passes an already-resolved session. No helper here resolves
 *     one — see `lib/access.ts` for why.
 *  2. Queries are built from validated scalars only. No caller anywhere can
 *     supply a `where`, `select`, `include` or ordering; those are constants
 *     declared next to the query. Where Prisma's builder cannot express the
 *     shape an index needs, the SQL is a TAGGED TEMPLATE: every interpolation
 *     is a bound parameter, and nothing is ever concatenated into statement
 *     text.
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

/** Ceiling on distinct environments the filter dropdown is offered. */
const MAX_ENVIRONMENTS = 100;

/**
 * Builds the `where` clause from validated filters.
 *
 * Every branch maps a checked scalar or fixed-vocabulary literal onto a named
 * column. Nothing from the caller is spread in. There is deliberately no
 * `applicationSlug` branch: a slug is resolved to an id BEFORE this runs (see
 * `resolveApplicationScope`), so the stream never joins `applications`.
 */
function buildWhere(filters: LogFilters): Prisma.LogEventWhereInput {
  const where: Prisma.LogEventWhereInput = {};

  if (filters.applicationId !== undefined)
    where.applicationId = filters.applicationId;

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
    // acceptable because a search always arrives with a time window: the
    // validator supplies one (`SEARCH_DEFAULT_WINDOW_MS`) when the caller did
    // not. See the index rationale in schema.prisma.
    where.message = { contains: filters.search, mode: "insensitive" };
  }

  return where;
}

/**
 * The page bound: every row strictly before the cursor in
 * `(timestamp DESC, id DESC)` order.
 *
 * Spelled as `timestamp <= ts AND (timestamp < ts OR id < id)` because
 * Prisma's builder has no row-value comparison. The planner seeks the
 * `(timestamp, id)` index to `ts` and applies the OR as a filter that removes
 * at most the rows sharing the cursor's millisecond — 0.02 ms a million rows
 * deep, measured, where Prisma's own `cursor`/`skip` (a lookup of the cursor
 * row plus an OR-expanded filter) took 232 ms at the same depth.
 */
function keysetBound(cursor: LogCursor): Prisma.LogEventWhereInput[] {
  return [
    { timestamp: { lte: cursor.ts } },
    { OR: [{ timestamp: { lt: cursor.ts } }, { id: { lt: cursor.id } }] },
  ];
}

/**
 * The cursor as a bound, or `undefined` on the first page.
 *
 * `parseLogFilters` has already refused a malformed token, so the throw is
 * unreachable through the page. It stays because this module's contract is
 * "validated scalars only": a caller that skipped the validator gets a
 * refusal, not a bound built from whatever it passed.
 */
function parseCursor(raw: string | undefined): LogCursor | undefined {
  if (raw === undefined) return undefined;

  const cursor = decodeLogCursor(raw);
  if (cursor === null) {
    throw new ApiError("INVALID_INPUT", "The page cursor is malformed.", {
      logContext: "cursor reached the data layer without validating",
    });
  }

  return cursor;
}

/**
 * Pins the filters to an application id when they name a slug.
 *
 * A slug used to reach the stream as a relation filter — `LEFT JOIN
 * applications … WHERE slug = $1` — which the planner answers by walking the
 * whole `(timestamp, id)` index newest-first and joining each row until it
 * has a page. For an application with no recent rows that is a scan of the
 * entire table: 1.7 s at 5M rows, on every refresh of an idle application's
 * page. One lookup on the (tiny, uniquely indexed) `applications` table
 * instead, and the stream query hits the `applicationId`-leading indexes it
 * was designed for.
 *
 * @returns The filters with `applicationId` set, or `null` when no row can
 *   match: an unknown slug, or an id and a slug naming different
 *   applications (the two were ANDed before, and still are).
 */
async function resolveApplicationScope(
  filters: LogFilters,
): Promise<LogFilters | null> {
  if (filters.applicationSlug === undefined) return filters;

  const application = await prisma.application.findUnique({
    where: { slug: filters.applicationSlug },
    select: { id: true },
  });
  if (application === null) return null;
  if (
    filters.applicationId !== undefined &&
    filters.applicationId !== application.id
  ) {
    return null;
  }

  return { ...filters, applicationId: application.id };
}

function emptyPage(): LogEventPage {
  return { items: [], hasMore: false, nextCursor: null };
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
 * Paged by KEYSET: the cursor carries the last row's `(timestamp, id)` and
 * the next page is everything strictly before it, so the cost of a page does
 * not depend on how many pages precede it.
 *
 * @param session - The resolved session of the user asking.
 * @param filters - Filters already validated by `parseLogFilters`.
 * @returns A page of projected rows plus the cursor for the next one.
 * @example
 * const page = await listLogEvents(session, filters);
 */
export async function listLogEvents(
  session: AppSession,
  filters: LogFilters,
): Promise<LogEventPage> {
  assertActiveViewer(session);

  const cursor = parseCursor(filters.cursor);

  const scoped = await resolveApplicationScope(filters);
  if (scoped === null) return emptyPage();

  const rows = await prisma.logEvent.findMany({
    where:
      cursor === undefined
        ? buildWhere(scoped)
        : { AND: [buildWhere(scoped), ...keysetBound(cursor)] },
    select: LIST_SELECT,
    // Matches the (applicationId, timestamp DESC) indexes. `id` is the
    // tie-break so the ordering is total: without it, rows sharing a
    // millisecond could be returned twice or skipped across page boundaries.
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    // One extra row, to detect a next page without a second count query.
    take: filters.limit + 1,
  });

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => toListItem(row, true)),
    hasMore,
    nextCursor:
      hasMore && last !== undefined
        ? encodeLogCursor({ ts: last.timestamp, id: last.id })
        : null,
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
  session: AppSession,
  id: string,
): Promise<LogEventDetail | null> {
  assertActiveViewer(session);

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

/** One row of the activity aggregate, as the statement names its columns. */
interface ActivityRow {
  applicationId: string;
  eventCount: number;
  errorCount: number;
}

/**
 * Per-application event and error counts over a window.
 *
 * ONE grouped aggregate — not two, and not one per application. The two
 * `groupBy` calls this replaces each walked a full index range for the
 * window, ~350 ms together at 5M rows; `COUNT(*) FILTER (…)` folds the error
 * count into the same pass.
 *
 * THE WINDOW IS ON `receivedAt`, THE SERVER CLOCK. It has an index of its own
 * (the retention sweep's), so the window is a single range scan — under
 * 30 ms measured — where the client `timestamp` has only
 * `applicationId`-leading indexes and had to be walked once per application
 * (~350 ms for the pair). It also says exactly
 * what the overview says: events RECEIVED in the last 24 hours.
 *
 * That is a different clock from the explorer's, which filters on the client
 * `timestamp`, and the two can disagree by a bounded amount: ingest clamps a
 * client timestamp to no more than `MAX_CLOCK_SKEW_PAST_MS` (30 days) behind
 * and `MAX_CLOCK_SKEW_FUTURE_MS` (24 hours) ahead of `receivedAt`, and in
 * practice to the seconds a batch waits before it is flushed. So an overview
 * count and a `from=now-24h` explorer page differ by the events whose client
 * clock put them on the other side of the boundary, and by nothing else.
 *
 * @param session - The resolved session of the user asking.
 * @param window - The inclusive window, on the SERVER receipt time.
 * @returns One row per application that received events in the window,
 *   busiest first.
 */
export async function getApplicationActivity(
  session: AppSession,
  window: ActivityWindow,
): Promise<ApplicationActivity[]> {
  assertActiveViewer(session);

  // Bound as a text[] parameter and cast to the enum array server-side, so the
  // taxonomy stays the single source of what counts as an error.
  const errorLevels = ERROR_LEVELS.map((level) => LEVEL_TO_DB[level]);

  const [rows, applications] = await Promise.all([
    prisma.$queryRaw<ActivityRow[]>`
      SELECT "applicationId",
             COUNT(*)::int AS "eventCount",
             COUNT(*) FILTER (WHERE "level" = ANY (${errorLevels}::"LogLevel"[]))::int AS "errorCount"
      FROM "log_events"
      WHERE "receivedAt" >= ${window.from} AND "receivedAt" <= ${window.to}
      GROUP BY "applicationId"
    `,
    prisma.application.findMany({
      select: { id: true, slug: true, name: true },
    }),
  ]);

  const metaByApplication = new Map(applications.map((row) => [row.id, row]));

  return rows
    .map((row) => {
      const meta = metaByApplication.get(row.applicationId);
      return {
        applicationId: row.applicationId,
        applicationSlug: meta?.slug ?? "unknown",
        applicationName: meta?.name ?? "Unknown application",
        eventCount: row.eventCount,
        errorCount: row.errorCount,
      };
    })
    .sort((left, right) => right.eventCount - left.eventCount);
}

/** One row of the environment walk. */
interface EnvironmentRow {
  environment: string;
}

/**
 * The distinct environments seen for an application, for the filter dropdown.
 *
 * A LOOSE INDEX SCAN, hand-written because Prisma has no way to ask for one.
 * `distinct` on this Prisma version runs in the engine: the SQL it emits is
 * `SELECT id, environment FROM log_events [WHERE …] ORDER BY id` — no
 * DISTINCT, no LIMIT — and every row crosses the wire before it is
 * de-duplicated. That was 4.3 s over the whole table, on EVERY load of the
 * explorer. (`nativeDistinct` emits `DISTINCT ON` and measured slower still,
 * 5.9 s: it sorts the table.)
 *
 * The recursive CTE instead asks the `(applicationId, environment, timestamp)`
 * index for the smallest environment, then repeatedly for "the next one
 * greater than the last": one index probe per distinct value, ~0.1 ms
 * whatever the row count, and the LIMIT stops the recursion rather than
 * trimming its output. For all applications the same walk runs once per row
 * of the (tiny) `applications` table.
 *
 * @param session - The resolved session of the user asking.
 * @param applicationId - The application to scope to, or undefined for all.
 * @returns Sorted, distinct environment names.
 */
export async function listEnvironments(
  session: AppSession,
  applicationId?: string,
): Promise<string[]> {
  assertActiveViewer(session);

  const rows =
    applicationId === undefined
      ? await prisma.$queryRaw<EnvironmentRow[]>`
          SELECT DISTINCT e."environment"
          FROM "applications" a
          CROSS JOIN LATERAL (
            WITH RECURSIVE envs AS (
              (SELECT "environment" FROM "log_events"
               WHERE "applicationId" = a."id"
               ORDER BY "environment" LIMIT 1)
              UNION ALL
              SELECT (SELECT "environment" FROM "log_events"
                      WHERE "applicationId" = a."id" AND "environment" > x."environment"
                      ORDER BY "environment" LIMIT 1)
              FROM envs x WHERE x."environment" IS NOT NULL
            )
            SELECT "environment" FROM envs
            WHERE "environment" IS NOT NULL
            LIMIT ${MAX_ENVIRONMENTS}
          ) e
          LIMIT ${MAX_ENVIRONMENTS}
        `
      : await prisma.$queryRaw<EnvironmentRow[]>`
          WITH RECURSIVE envs AS (
            (SELECT "environment" FROM "log_events"
             WHERE "applicationId" = ${applicationId}
             ORDER BY "environment" LIMIT 1)
            UNION ALL
            SELECT (SELECT "environment" FROM "log_events"
                    WHERE "applicationId" = ${applicationId} AND "environment" > e."environment"
                    ORDER BY "environment" LIMIT 1)
            FROM envs e WHERE e."environment" IS NOT NULL
          )
          SELECT "environment" FROM envs
          WHERE "environment" IS NOT NULL
          LIMIT ${MAX_ENVIRONMENTS}
        `;

  return rows
    .map((row) => row.environment)
    .sort((left, right) => left.localeCompare(right));
}
