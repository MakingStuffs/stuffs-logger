import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  parseLogFilters,
} from "./filters";

describe("parseLogFilters", () => {
  it("applies the default page size when none is asked for", () => {
    const result = parseLogFilters({});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filters.limit).toBe(DEFAULT_PAGE_SIZE);
  });

  it("accepts a limit at the ceiling", () => {
    const result = parseLogFilters({ limit: String(MAX_PAGE_SIZE) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filters.limit).toBe(MAX_PAGE_SIZE);
  });

  it("refuses a limit above the ceiling rather than silently clamping it", () => {
    expect(parseLogFilters({ limit: String(MAX_PAGE_SIZE + 1) }).ok).toBe(
      false,
    );
    expect(parseLogFilters({ limit: "100000" }).ok).toBe(false);
  });

  it("refuses a zero, negative or fractional limit", () => {
    expect(parseLogFilters({ limit: "0" }).ok).toBe(false);
    expect(parseLogFilters({ limit: "-5" }).ok).toBe(false);
    expect(parseLogFilters({ limit: "2.5" }).ok).toBe(false);
  });

  it("refuses a non-numeric limit", () => {
    expect(parseLogFilters({ limit: "all" }).ok).toBe(false);
  });

  it("refuses an unknown search param rather than ignoring it", () => {
    expect(parseLogFilters({ orderBy: "message" }).ok).toBe(false);
    expect(parseLogFilters({ select: "userAgent" }).ok).toBe(false);
    expect(parseLogFilters({ include: "application" }).ok).toBe(false);
  });

  describe("multi-value filters", () => {
    it("accepts a single level", () => {
      const result = parseLogFilters({ level: "error" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.filters.level).toEqual(["error"]);
    });

    it("accepts a repeated param", () => {
      const result = parseLogFilters({ level: ["error", "fatal"] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.filters.level).toEqual(["error", "fatal"]);
    });

    it("accepts a comma-separated list", () => {
      const result = parseLogFilters({ level: "warn,error" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.filters.level).toEqual(["warn", "error"]);
    });

    it("dedupes repeated values", () => {
      const result = parseLogFilters({ level: "error,error,error" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.filters.level).toEqual(["error"]);
    });

    it("refuses a level outside the taxonomy", () => {
      expect(parseLogFilters({ level: "critical" }).ok).toBe(false);
      expect(parseLogFilters({ level: "error,critical" }).ok).toBe(false);
    });

    it("refuses a source outside the taxonomy", () => {
      expect(parseLogFilters({ source: "deno" }).ok).toBe(false);
    });

    it("refuses a device type outside the taxonomy", () => {
      expect(parseLogFilters({ deviceType: "fridge" }).ok).toBe(false);
    });

    it("refuses more values than the cap allows", () => {
      const many = Array.from({ length: 25 }, (_, index) => `env-${index}`);

      expect(parseLogFilters({ environment: many }).ok).toBe(false);
    });

    it("accepts free-text environments", () => {
      const result = parseLogFilters({ environment: "production,staging" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.filters.environment).toEqual(["production", "staging"]);
    });
  });

  describe("dates", () => {
    it("accepts an ISO instant with an offset", () => {
      const result = parseLogFilters({ from: "2026-09-01T00:00:00.000Z" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.filters.from?.toISOString()).toBe(
        "2026-09-01T00:00:00.000Z",
      );
    });

    it("refuses an unparseable date rather than coercing it", () => {
      expect(parseLogFilters({ from: "banana" }).ok).toBe(false);
      expect(parseLogFilters({ from: "01/09/2026" }).ok).toBe(false);
    });

    it("refuses a range whose start is after its end", () => {
      const result = parseLogFilters({
        from: "2026-09-02T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
      });

      expect(result.ok).toBe(false);
    });

    it("accepts a range whose start equals its end", () => {
      const result = parseLogFilters({
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("free-text search", () => {
    it("accepts a term at the length limit", () => {
      const result = parseLogFilters({ search: "a".repeat(MAX_SEARCH_LENGTH) });

      expect(result.ok).toBe(true);
    });

    it("refuses a term over the length limit", () => {
      const result = parseLogFilters({
        search: "a".repeat(MAX_SEARCH_LENGTH + 1),
      });

      expect(result.ok).toBe(false);
    });

    it("refuses a whitespace-only term", () => {
      expect(parseLogFilters({ search: "   " }).ok).toBe(false);
    });

    it("keeps SQL-looking input as an ordinary term", () => {
      const term = "'; DROP TABLE log_events; --";
      const result = parseLogFilters({ search: term });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.filters.search).toBe(term);
    });
  });

  describe("identifiers", () => {
    it("refuses an over-long application id", () => {
      expect(parseLogFilters({ applicationId: "a".repeat(65) }).ok).toBe(false);
    });

    it("refuses an over-long cursor", () => {
      expect(parseLogFilters({ cursor: "c".repeat(65) }).ok).toBe(false);
    });

    it("reports the offending field", () => {
      const result = parseLogFilters({ limit: "9999" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0]?.path).toBe("limit");
    });
  });
});
