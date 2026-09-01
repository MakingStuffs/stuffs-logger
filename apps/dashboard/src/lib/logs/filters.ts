import { DEVICE_TYPES, LOG_LEVELS, LOG_SOURCES } from "@stuffs-logger/core";
import type { DeviceType, LogLevel, LogSource } from "@stuffs-logger/core";
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

/** Default page size when the caller does not ask for one. */
export const DEFAULT_PAGE_SIZE = 50;

/** Hard ceiling on page size, whatever the caller asks for. */
export const MAX_PAGE_SIZE = 200;

/** Maximum length of the free-text search term. */
export const MAX_SEARCH_LENGTH = 200;

/** Maximum length of an id, slug or environment filter value. */
const MAX_ID_LENGTH = 64;

/** Maximum distinct values accepted for one multi-value filter. */
const MAX_MULTI_VALUES = 20;

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
    cursor: idSchema.optional(),
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
  to?: Date;
  search?: string;
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

/**
 * Validates raw search params into a filter set.
 *
 * Never throws: a bad URL is an expected input on a shareable dashboard, not
 * an exceptional one, so the caller renders the issues rather than a 500.
 *
 * @param input - Raw search params, entirely untrusted.
 * @returns The validated filters, or the issues that rejected them.
 * @example
 * const parsed = parseLogFilters(await searchParams);
 * if (!parsed.ok) return <FilterErrors issues={parsed.issues} />;
 */
export function parseLogFilters(input: RawSearchParams): LogFilterParseResult {
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

  return { ok: true, filters: parsed.data };
}
