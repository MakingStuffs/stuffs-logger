import { DEVICE_TYPES, LOG_LEVELS, LOG_SOURCES } from "@stuffs/logger-core";
import type { DeviceType, LogLevel, LogSource } from "@stuffs/logger-core";
import { z } from "zod";

/**
 * Validation of the dashboard's log filters.
 *
 * The frontend passes URL search params straight in, so every value here is
 * attacker-controlled: anyone can type anything into the address bar and send
 * the link to a colleague. The schema is therefore CLOSED — it names every
 * accepted field, coerces and bounds the numeric ones, and rejects unknown
 * keys rather than letting an unrecognised param look like an applied filter.
 *
 * Nothing here ever produces a query shape. It produces scalars and
 * fixed-vocabulary literals; `queries.ts` alone decides what to do with them.
 */

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants";

/** Re-exported so existing server-side importers keep working. */
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };

/** Maximum length of the free-text search term. */
export const MAX_SEARCH_LENGTH = 200;

/**
 * How far back a free-text search looks when the caller gives no `from`.
 *
 * A search is a sequential `ILIKE` over whatever the other predicates have
 * narrowed to, and without a time window nothing narrows it at all. Measured
 * on a 5M-row table: a term that matches NOTHING walks the entire
 * `(timestamp, id)` index and every heap page behind it, 780 ms — and a term
 * that matches nothing is exactly the one a user retries. The same term over
 * the last 24 hours (~160k rows at the schema's stated ingest rate) is a
 * bounded range scan. A caller who wants further back says so with `from`,
 * or with `window=all` (the "All time" link) to search everything retained.
 */
export const SEARCH_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The one explicit alternative to the default search window. A closed
 * vocabulary of one, so that "no window at all" is a value a URL can carry and
 * the validator can refuse anything else.
 */
export const SEARCH_WINDOWS = ["all"] as const;

/** An explicit search window choice. */
export type SearchWindow = (typeof SEARCH_WINDOWS)[number];

/** Maximum length of an id, slug, environment or cursor value. */
const MAX_ID_LENGTH = 64;

/** Maximum distinct values accepted for one multi-value filter. */
const MAX_MULTI_VALUES = 20;

/** The separator between the two halves of a keyset cursor. */
const CURSOR_SEPARATOR = "_";

/** Exactly what `Date.prototype.toISOString` produces, and nothing looser. */
const CURSOR_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Where a page of the stream ends: the ordering key of its last row.
 *
 * The stream is ordered by `(timestamp DESC, id DESC)`, so the next page is
 * every row strictly before this pair. Carrying BOTH halves is what lets the
 * data layer page by keyset — a bound the `(timestamp, id)` index seeks to
 * directly — instead of looking the cursor row up and applying an OR-expanded
 * filter whose cost grows with how deep the page is (232 ms a million rows
 * in, measured, against 0.02 ms for the seek).
 */
export interface LogCursor {
  /** The last row's `timestamp`, to the millisecond the column stores. */
  ts: Date;
  /** The last row's `id`, the tie-break within a millisecond. */
  id: string;
}

/**
 * Serialises a cursor into the opaque token a URL carries.
 *
 * `<ISO instant>_<id>`. The instant is fixed-width and contains no
 * underscore, so the FIRST separator always splits the two halves, whatever
 * an id contains.
 *
 * @param cursor - The ordering key of the last row on a page.
 * @returns The token, at most 25 characters longer than the id.
 * @example
 * encodeLogCursor({ ts: new Date("2026-10-16T11:49:09.531Z"), id: "c01" });
 * // "2026-10-16T11:49:09.531Z_c01"
 */
export function encodeLogCursor(cursor: LogCursor): string {
  return `${cursor.ts.toISOString()}${CURSOR_SEPARATOR}${cursor.id}`;
}

/**
 * Parses a cursor token back into its halves.
 *
 * @param raw - The token, untrusted.
 * @returns The cursor, or `null` for anything that is not exactly what
 *   {@link encodeLogCursor} produces — including the pre-keyset format of a
 *   bare id, which carries no instant to seek to.
 * @example
 * decodeLogCursor("2026-10-16T11:49:09.531Z_c01");
 * // { ts: Date(2026-10-16T11:49:09.531Z), id: "c01" }
 */
export function decodeLogCursor(raw: string): LogCursor | null {
  const separator = raw.indexOf(CURSOR_SEPARATOR);
  if (separator === -1) return null;

  const instant = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (id.length === 0) return null;
  if (!CURSOR_INSTANT_PATTERN.test(instant)) return null;

  const ts = new Date(instant);
  // The pattern admits "2026-13-45T…"; the Date does not. And a Date that
  // parses but renders differently (a 31st in a 30-day month rolls over) is
  // not the instant the token claimed.
  if (Number.isNaN(ts.getTime()) || ts.toISOString() !== instant) return null;

  return { ts, id };
}

/**
 * Splits a search param that may arrive as a string, a repeated key, or a
 * comma-separated list.
 *
 * `?level=error&level=fatal`, `?level=error,fatal` and `?level=error` all mean
 * the same thing to a user, so all three are normalised here rather than in
 * three places in the UI.
 */
const rawMultiValue = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((input) => {
    if (input === undefined) return undefined;
    const flat = (Array.isArray(input) ? input : [input])
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return flat.length === 0 ? undefined : [...new Set(flat)];
  });

/** A multi-value filter constrained to a closed vocabulary. */
function multiEnum<TValue extends string>(
  values: readonly [TValue, ...TValue[]],
): z.ZodType<TValue[] | undefined, unknown> {
  return rawMultiValue.pipe(
    z.array(z.enum(values)).min(1).max(MAX_MULTI_VALUES).optional(),
  );
}

/** A multi-value filter over free text, bounded in length and count. */
const multiText = rawMultiValue.pipe(
  z
    .array(z.string().min(1).max(MAX_ID_LENGTH))
    .min(1)
    .max(MAX_MULTI_VALUES)
    .optional(),
);

/**
 * An ISO-8601 instant.
 *
 * Rejected rather than coerced when unparseable: `new Date("banana")` yields
 * an Invalid Date that Prisma would turn into an opaque driver error much
 * further from the mistake.
 */
const instantSchema = z.iso
  .datetime({ offset: true, local: true })
  .transform((value) => new Date(value))
  .refine((date) => !Number.isNaN(date.getTime()), { message: "Invalid date" });

const idSchema = z.string().trim().min(1).max(MAX_ID_LENGTH);

/**
 * A keyset cursor token, kept as the string the URL carries.
 *
 * Refused unless it decodes: a bound built from a malformed token would seek
 * the index to nowhere in particular, and a bare id — the old format — has
 * nothing to seek to at all.
 */
const cursorSchema = idSchema.refine((raw) => decodeLogCursor(raw) !== null, {
  message: "Malformed cursor",
});

/** The filter set the log stream accepts. */
export const logFilterSchema = z
  .strictObject({
    applicationId: idSchema.optional(),
    applicationSlug: idSchema.optional(),
    level: multiEnum(LOG_LEVELS),
    source: multiEnum(LOG_SOURCES),
    deviceType: multiEnum(DEVICE_TYPES),
    environment: multiText,
    from: instantSchema.optional(),
    to: instantSchema.optional(),
    search: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).optional(),
    window: z.enum(SEARCH_WINDOWS).optional(),
    cursor: cursorSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
  })
  .refine(
    (filters) =>
      filters.from === undefined ||
      filters.to === undefined ||
      filters.from <= filters.to,
    { message: "`from` must not be after `to`", path: ["from"] },
  );

/** A validated filter set, ready to hand to the data-access layer. */
export interface LogFilters {
  applicationId?: string;
  applicationSlug?: string;
  level?: LogLevel[];
  source?: LogSource[];
  deviceType?: DeviceType[];
  environment?: string[];
  from?: Date;
  /**
   * Set when `from` was supplied by the parser, not the caller: a free-text
   * search with no lower bound is bounded to the last
   * {@link SEARCH_DEFAULT_WINDOW_MS}, and the page can say so. Never a URL
   * param — `buildLogsHref` omits a defaulted `from`, so a link does not pin
   * the window to the minute someone happened to search.
   */
  fromDefaulted?: true;
  to?: Date;
  search?: string;
  /**
   * `"all"` switches the default search window OFF: the caller has said, in
   * the URL, that they want the search to run over everything retained. Only
   * the "All time" quick-range link emits it, and only while a search is
   * active, because that is the one control whose whole meaning the default
   * would otherwise quietly override.
   */
  window?: SearchWindow;
  /**
   * An opaque keyset token from {@link encodeLogCursor}, verified to decode.
   * The data layer decodes it; nothing else should.
   */
  cursor?: string;
  limit: number;
}

/** One field-level complaint about a rejected filter set. */
export interface FilterIssue {
  path: string;
  message: string;
}

/** The outcome of validating search params. */
export type LogFilterParseResult =
  { ok: true; filters: LogFilters } | { ok: false; issues: FilterIssue[] };

/** What Next hands a page as `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** What {@link parseLogFilters} needs besides the params. */
export interface ParseLogFiltersOptions {
  /**
   * The instant "now" means, for the default search window. The clock,
   * unless a test pins it.
   */
  now?: Date;
}

/**
 * Bounds a search that has no lower bound to the default window.
 *
 * Applied AFTER validation rather than inside the schema, so the
 * `from <= to` refinement judges what the caller actually sent, and so a
 * schema that validates can never also invent data. The window ends at `to`
 * when that is in the past — a default that started after the caller's own
 * upper bound would silently match nothing — and at `now` otherwise.
 */
function applySearchWindow(filters: LogFilters, now: Date): LogFilters {
  if (
    filters.search === undefined ||
    filters.from !== undefined ||
    filters.window === "all"
  ) {
    return filters;
  }

  const end = filters.to === undefined || filters.to > now ? now : filters.to;

  return {
    ...filters,
    from: new Date(end.getTime() - SEARCH_DEFAULT_WINDOW_MS),
    fromDefaulted: true,
  };
}

/**
 * Validates raw search params into a filter set.
 *
 * Never throws: a bad URL is an expected input on a shareable dashboard, not
 * an exceptional one, so the caller renders the issues rather than a 500.
 *
 * @param input - Raw search params, entirely untrusted.
 * @param options - See {@link ParseLogFiltersOptions}.
 * @returns The validated filters, or the issues that rejected them.
 * @example
 * const parsed = parseLogFilters(await searchParams);
 * if (!parsed.ok) return <FilterErrors issues={parsed.issues} />;
 */
export function parseLogFilters(
  input: RawSearchParams,
  options: ParseLogFiltersOptions = {},
): LogFilterParseResult {
  const parsed = logFilterSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  return {
    ok: true,
    filters: applySearchWindow(parsed.data, options.now ?? new Date()),
  };
}
