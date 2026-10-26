import { describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SIZE } from "@/lib/logs/constants";
import { parseLogFilters } from "@/lib/logs/filters";
import type { LogFilters } from "@/lib/logs/filters";

import {
  applicationLogsHref,
  buildLogsHref,
  firstPageHref,
  hasActiveFilters,
  hasSecondaryFilter,
  nextPageHref,
  normaliseSearchParams,
  timeRangeHref,
} from "./search-params";

function makeFilters(overrides: Partial<LogFilters> = {}): LogFilters {
  return { limit: DEFAULT_PAGE_SIZE, ...overrides };
}

describe("normaliseSearchParams", () => {
  it("drops an empty value, so an untouched form field is not a filter", () => {
    expect(normaliseSearchParams({ search: "" })).toEqual({});
  });

  it("drops a whitespace-only value", () => {
    expect(normaliseSearchParams({ search: "   " })).toEqual({});
  });

  it("keeps a real value", () => {
    expect(normaliseSearchParams({ search: "timeout" })).toEqual({
      search: "timeout",
    });
  });

  it("drops empty entries from a repeated param", () => {
    expect(normaliseSearchParams({ level: ["error", "", "fatal"] })).toEqual({
      level: ["error", "fatal"],
    });
  });

  it("drops a repeated param that is entirely empty", () => {
    expect(normaliseSearchParams({ level: ["", ""] })).toEqual({});
  });

  it("keeps an unrecognised key so the user is told about the typo", () => {
    expect(normaliseSearchParams({ levl: "error" })).toEqual({
      levl: "error",
    });
  });

  it("lets a blank native form submission validate cleanly", () => {
    const submitted = {
      applicationSlug: "",
      search: "",
      from: "",
      to: "",
      limit: String(DEFAULT_PAGE_SIZE),
    };

    const parsed = parseLogFilters(normaliseSearchParams(submitted));

    expect(parsed).toEqual({ ok: true, filters: { limit: DEFAULT_PAGE_SIZE } });
  });
});

describe("buildLogsHref", () => {
  it("returns the bare path when nothing is filtered", () => {
    expect(buildLogsHref({})).toBe("/logs");
  });

  it("emits a repeated param for each value of a multi-value filter", () => {
    expect(buildLogsHref({ level: ["error", "fatal"] })).toBe(
      "/logs?level=error&level=fatal",
    );
  });

  it("emits dates as absolute instants, not local strings", () => {
    expect(buildLogsHref({ from: new Date("2026-01-15T09:00:00.000Z") })).toBe(
      "/logs?from=2026-01-15T09%3A00%3A00.000Z",
    );
  });

  it("omits the default page size", () => {
    expect(buildLogsHref({ limit: DEFAULT_PAGE_SIZE })).toBe("/logs");
  });

  it("includes a non-default page size", () => {
    expect(buildLogsHref({ limit: 200 })).toBe("/logs?limit=200");
  });

  it("orders params consistently so equal views share a URL", () => {
    expect(buildLogsHref({ search: "boom", applicationSlug: "checkout" })).toBe(
      buildLogsHref({ applicationSlug: "checkout", search: "boom" }),
    );
  });

  it("produces a URL the closed filter schema accepts", () => {
    const filters = makeFilters({
      applicationSlug: "checkout",
      level: ["error", "fatal"],
      source: ["browser"],
      deviceType: ["mobile"],
      environment: ["production"],
      from: new Date("2026-01-15T09:00:00.000Z"),
      to: new Date("2026-01-16T09:00:00.000Z"),
      search: "timeout",
      cursor: "2026-01-15T09:00:00.000Z_event-1",
      limit: 200,
    });

    const url = new URL(buildLogsHref(filters), "https://logs.test");
    const raw: Record<string, string | string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key);
      raw[key] = values.length > 1 ? values : (values[0] ?? "");
    }

    expect(parseLogFilters(raw)).toEqual({ ok: true, filters });
  });

  it("omits a lower bound the validator defaulted, so a search link does not pin it", () => {
    const href = buildLogsHref({
      search: "boom",
      from: new Date("2026-01-15T09:00:00.000Z"),
      fromDefaulted: true,
    });

    expect(href).toBe("/logs?search=boom");
  });

  it("keeps a lower bound the caller chose", () => {
    const href = buildLogsHref({
      search: "boom",
      from: new Date("2026-01-15T09:00:00.000Z"),
    });

    expect(href).toBe("/logs?from=2026-01-15T09%3A00%3A00.000Z&search=boom");
  });
});

describe("page hrefs", () => {
  it("carries the filters onto the next page", () => {
    const href = nextPageHref(makeFilters({ search: "boom" }), "event-9");

    expect(href).toBe("/logs?search=boom&cursor=event-9");
  });

  it("drops the cursor when returning to the newest page", () => {
    const href = firstPageHref(makeFilters({ search: "boom", cursor: "e-9" }));

    expect(href).toBe("/logs?search=boom");
  });

  it("resets paging when the time range changes", () => {
    const href = timeRangeHref(
      makeFilters({ cursor: "event-9" }),
      new Date("2026-01-15T09:00:00.000Z"),
    );

    expect(href).toBe("/logs?from=2026-01-15T09%3A00%3A00.000Z");
  });

  it("clears the lower bound for an all-time range", () => {
    const href = timeRangeHref(
      makeFilters({ from: new Date("2026-01-15T09:00:00.000Z") }),
      undefined,
    );

    expect(href).toBe("/logs");
  });

  it("replaces a defaulted lower bound with the quick-range's explicit one", () => {
    const href = timeRangeHref(
      makeFilters({
        search: "boom",
        from: new Date("2026-01-15T09:00:00.000Z"),
        fromDefaulted: true,
      }),
      new Date("2026-01-14T09:00:00.000Z"),
    );

    expect(href).toBe("/logs?from=2026-01-14T09%3A00%3A00.000Z&search=boom");
  });

  it("says window=all for an all-time range while a search is active, so the default cannot override it", () => {
    const href = timeRangeHref(
      makeFilters({
        search: "boom",
        from: new Date("2026-01-15T09:00:00.000Z"),
        fromDefaulted: true,
      }),
      undefined,
    );

    expect(href).toBe("/logs?search=boom&window=all");
  });

  it("drops window=all again when a bounded range is chosen", () => {
    const href = timeRangeHref(
      makeFilters({ search: "boom", window: "all" }),
      new Date("2026-01-14T09:00:00.000Z"),
    );

    expect(href).toBe("/logs?from=2026-01-14T09%3A00%3A00.000Z&search=boom");
  });

  it("never writes a window into a link that is not searching", () => {
    expect(buildLogsHref({ window: "all" })).toBe("/logs");
    expect(buildLogsHref({ level: ["error"], window: "all" })).toBe(
      "/logs?level=error",
    );
  });

  it("carries window=all onto the next page of a search", () => {
    const href = nextPageHref(
      makeFilters({ search: "boom", window: "all" }),
      "event-9",
    );

    expect(href).toBe("/logs?search=boom&window=all&cursor=event-9");
  });
});

describe("applicationLogsHref", () => {
  it("scopes to one application", () => {
    expect(applicationLogsHref("checkout")).toBe(
      "/logs?applicationSlug=checkout",
    );
  });

  it("scopes to one application's errors", () => {
    expect(applicationLogsHref("checkout", ["error", "fatal"])).toBe(
      "/logs?applicationSlug=checkout&level=error&level=fatal",
    );
  });
});

describe("hasActiveFilters", () => {
  it("is false for an unfiltered view", () => {
    expect(hasActiveFilters(makeFilters())).toBe(false);
  });

  it("is false when only paging is set", () => {
    expect(hasActiveFilters(makeFilters({ cursor: "e-1", limit: 200 }))).toBe(
      false,
    );
  });

  it("is true when a filter narrows the stream", () => {
    expect(hasActiveFilters(makeFilters({ level: ["error"] }))).toBe(true);
  });
});

describe("hasSecondaryFilter", () => {
  it("is false when only the always-visible filters are set", () => {
    expect(
      hasSecondaryFilter(makeFilters({ level: ["error"], search: "boom" })),
    ).toBe(false);
  });

  it.each<[string, Partial<LogFilters>]>([
    ["a source", { source: ["browser"] }],
    ["a device", { deviceType: ["mobile"] }],
    ["an environment", { environment: ["staging"] }],
  ])("is true when %s filter is applied", (_name, overrides) => {
    expect(hasSecondaryFilter(makeFilters(overrides))).toBe(true);
  });
});
