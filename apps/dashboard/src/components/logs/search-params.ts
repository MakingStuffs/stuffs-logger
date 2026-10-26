import type { LogLevel } from "@stuffs/logger-core/taxonomy";

import { DEFAULT_PAGE_SIZE } from "@/lib/logs/constants";
import type { LogFilters, RawSearchParams } from "@/lib/logs/filters";

/**
 * Translation between the log explorer's UI and its URL.
 *
 * Every filter lives in the query string so a view is server-rendered,
 * shareable and back-button-correct. That makes these functions the only place
 * a `/logs` URL is ever assembled, which is what keeps the emitted vocabulary
 * inside the closed set the validator accepts.
 */

/** The explorer's route. */
export const LOGS_PATH = "/logs";

/**
 * Drops blank values from raw search params.
 *
 * A native GET form submits every named control, so an untouched text box
 * arrives as `?search=`. The validator — correctly — rejects an empty string
 * rather than guessing, so a blank value is stripped here, at the page
 * boundary, before it is ever presented as a filter.
 *
 * Unrecognised KEYS are deliberately left alone: they are a genuine mistake in
 * a hand-edited URL and the user is better told than silently ignored.
 *
 * @param raw - Search params exactly as Next hands them to a page.
 * @returns The same params with empty and whitespace-only values removed.
 * @example
 * parseLogFilters(normaliseSearchParams(await searchParams));
 */
export function normaliseSearchParams(raw: RawSearchParams): RawSearchParams {
  const cleaned: RawSearchParams = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      const kept = value.filter((entry) => entry.trim().length > 0);
      if (kept.length > 0) cleaned[key] = kept;
      continue;
    }

    if (value.trim().length === 0) continue;
    cleaned[key] = value;
  }

  return cleaned;
}

/**
 * Builds a `/logs` href from a filter set.
 *
 * Params are appended in a fixed order so the same filters always produce the
 * same URL — shareable links stay stable and equal views stay cacheable. A
 * `limit` equal to the default is omitted rather than spelled out.
 *
 * @param filters - The filters the target view should apply.
 * @returns A root-relative href.
 * @example
 * buildLogsHref({ applicationSlug: "checkout", level: ["error"] });
 * // "/logs?applicationSlug=checkout&level=error"
 */
export function buildLogsHref(filters: Partial<LogFilters>): string {
  const params = new URLSearchParams();

  const appendScalar = (key: string, value: string | undefined): void => {
    if (value !== undefined && value.length > 0) params.append(key, value);
  };
  const appendAll = (key: string, values: readonly string[] = []): void => {
    for (const value of values) params.append(key, value);
  };

  appendScalar("applicationId", filters.applicationId);
  appendScalar("applicationSlug", filters.applicationSlug);
  appendAll("level", filters.level);
  appendAll("source", filters.source);
  appendAll("deviceType", filters.deviceType);
  appendAll("environment", filters.environment);
  // A `from` the validator defaulted (an unbounded search's window) is not
  // the user's choice, so it is not written into links: the next page and the
  // "newest" link re-derive it, and a shared URL is not pinned to the minute
  // someone happened to search. Between pages the window slides with the
  // clock, which only ever trims its oldest edge.
  appendScalar(
    "from",
    filters.fromDefaulted === true ? undefined : filters.from?.toISOString(),
  );
  appendScalar("to", filters.to?.toISOString());
  appendScalar("search", filters.search);
  // Carried only while it means something: an explicit "no window" is a
  // statement about a search, and a link with no search has nothing to say.
  appendScalar(
    "window",
    filters.search === undefined ? undefined : filters.window,
  );
  appendScalar("cursor", filters.cursor);

  if (filters.limit !== undefined && filters.limit !== DEFAULT_PAGE_SIZE) {
    params.append("limit", String(filters.limit));
  }

  const query = params.toString();
  return query.length === 0 ? LOGS_PATH : `${LOGS_PATH}?${query}`;
}

/**
 * The same view, one page further on.
 *
 * @param filters - The filters currently applied.
 * @param cursor - The `nextCursor` the previous page returned.
 * @returns An href for the next page.
 */
export function nextPageHref(filters: LogFilters, cursor: string): string {
  return buildLogsHref({ ...filters, cursor });
}

/**
 * The same filters, back at the newest page.
 *
 * @param filters - The filters currently applied.
 * @returns An href with the cursor dropped.
 */
export function firstPageHref(filters: LogFilters): string {
  return buildLogsHref({ ...filters, cursor: undefined });
}

/**
 * The same filters over a different starting instant.
 *
 * Used by the quick-range links, whose values are absolute instants computed
 * on the server — unlike a `datetime-local` field, they carry a zone and so
 * cannot be read differently by the browser and the server.
 *
 * @param filters - The filters currently applied.
 * @param from - The new lower bound, or `undefined` for all time.
 * @returns An href for the newest page of that range.
 */
export function timeRangeHref(
  filters: LogFilters,
  from: Date | undefined,
): string {
  // A quick-range IS the user's choice of lower bound, so it must not be
  // dropped as a defaulted one would be. "All time" is the same kind of
  // choice in the other direction: with a search active it would otherwise be
  // silently replaced by the default window, so it says `window=all` instead
  // of merely omitting `from`. Any bounded range clears that again.
  return buildLogsHref({
    ...filters,
    from,
    fromDefaulted: undefined,
    window:
      from === undefined && filters.search !== undefined ? "all" : undefined,
    cursor: undefined,
  });
}

/**
 * The log stream for one application.
 *
 * @param applicationSlug - The application to scope to.
 * @param level - Optional severity filter, e.g. the error levels.
 * @returns An href into the explorer.
 */
export function applicationLogsHref(
  applicationSlug: string,
  level?: readonly LogLevel[],
): string {
  return buildLogsHref({
    applicationSlug,
    ...(level === undefined ? {} : { level: [...level] }),
  });
}

/**
 * Whether any filter is narrowing the stream.
 *
 * `limit` and `cursor` are paging, not filtering, so they do not count — an
 * empty second page still means "nothing matched", not "nothing exists".
 *
 * @param filters - The filters currently applied.
 * @returns Whether the view is filtered at all.
 */
export function hasActiveFilters(filters: LogFilters): boolean {
  return (
    filters.applicationId !== undefined ||
    filters.applicationSlug !== undefined ||
    filters.level !== undefined ||
    filters.source !== undefined ||
    filters.deviceType !== undefined ||
    filters.environment !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined ||
    filters.search !== undefined
  );
}

/**
 * Whether a filter from the collapsed "More filters" section is applied.
 *
 * Decides whether that section opens on render — and, because the panel is
 * streamed, whether its skeleton reserves the open height or the closed one.
 *
 * @param filters - The filters currently applied.
 * @returns Whether a source, device or environment filter is set.
 */
export function hasSecondaryFilter(filters: LogFilters): boolean {
  return (
    filters.source !== undefined ||
    filters.deviceType !== undefined ||
    filters.environment !== undefined
  );
}
