import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  decodeLogCursor,
  encodeLogCursor,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  parseLogFilters,
  SEARCH_DEFAULT_WINDOW_MS,
} from "./filters";

const NOW = new Date("2026-10-22T12:00:00.000Z");
const CURSOR_TS = new Date("2026-10-16T11:49:09.531Z");
const CURSOR = `${CURSOR_TS.toISOString()}_c0000000000000000003d0905`;

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

    describe("default time window", () => {
      it("bounds an unbounded search to the last day and says so", () => {
        const result = parseLogFilters({ search: "timeout" }, { now: NOW });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.filters.from?.toISOString()).toBe(
          new Date(NOW.getTime() - SEARCH_DEFAULT_WINDOW_MS).toISOString(),
        );
        expect(result.filters.fromDefaulted).toBe(true);
      });

      it("leaves a caller-supplied lower bound alone", () => {
        const result = parseLogFilters(
          { search: "timeout", from: "2026-01-01T00:00:00.000Z" },
          { now: NOW },
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.filters.from?.toISOString()).toBe(
          "2026-01-01T00:00:00.000Z",
        );
        expect(result.filters.fromDefaulted).toBeUndefined();
      });

      it("does not bound a view that is not searching", () => {
        const result = parseLogFilters({ level: "error" }, { now: NOW });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.filters.from).toBeUndefined();
        expect(result.filters.fromDefaulted).toBeUndefined();
      });

      it("switches the window off when the URL says window=all", () => {
        const result = parseLogFilters(
          { search: "timeout", window: "all" },
          { now: NOW },
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.filters.from).toBeUndefined();
        expect(result.filters.fromDefaulted).toBeUndefined();
        expect(result.filters.window).toBe("all");
      });

      it("refuses a window value outside the closed vocabulary", () => {
        const result = parseLogFilters(
          { search: "timeout", window: "forever" },
          { now: NOW },
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.issues.map((issue) => issue.path)).toContain("window");
      });

      it("anchors the window to an upper bound in the past, so from never passes to", () => {
        const to = new Date("2026-09-01T00:00:00.000Z");
        const result = parseLogFilters(
          { search: "timeout", to: to.toISOString() },
          { now: NOW },
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.filters.from?.toISOString()).toBe(
          new Date(to.getTime() - SEARCH_DEFAULT_WINDOW_MS).toISOString(),
        );
        expect(result.filters.fromDefaulted).toBe(true);
      });

      it("anchors the window to now when the upper bound is in the future", () => {
        const to = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
        const result = parseLogFilters(
          { search: "timeout", to: to.toISOString() },
          { now: NOW },
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.filters.from?.toISOString()).toBe(
          new Date(NOW.getTime() - SEARCH_DEFAULT_WINDOW_MS).toISOString(),
        );
      });

      describe("with the real clock", () => {
        beforeEach(() => {
          vi.useFakeTimers();
          vi.setSystemTime(NOW);
        });
        afterEach(() => vi.useRealTimers());

        it("defaults `now` to the current instant", () => {
          const result = parseLogFilters({ search: "timeout" });

          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.filters.from?.toISOString()).toBe(
            new Date(NOW.getTime() - SEARCH_DEFAULT_WINDOW_MS).toISOString(),
          );
        });
      });
    });
  });

  describe("cursor", () => {
    it("accepts a keyset cursor and keeps it as the opaque string the URL carries", () => {
      const result = parseLogFilters({ cursor: CURSOR });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.filters.cursor).toBe(CURSOR);
    });

    it("refuses a bare id — the pre-keyset cursor format", () => {
      expect(parseLogFilters({ cursor: "c0000000000000000003d0905" }).ok).toBe(
        false,
      );
    });

    it("refuses a cursor whose instant does not parse", () => {
      expect(parseLogFilters({ cursor: "banana_event-1" }).ok).toBe(false);
      expect(parseLogFilters({ cursor: "2026-10-16_event-1" }).ok).toBe(false);
      expect(
        parseLogFilters({ cursor: "2026-13-45T99:00:00.000Z_event-1" }).ok,
      ).toBe(false);
    });

    it("refuses a cursor with no id after the separator", () => {
      expect(
        parseLogFilters({ cursor: `${CURSOR_TS.toISOString()}_` }).ok,
      ).toBe(false);
    });

    it("reports the offending field", () => {
      const result = parseLogFilters({ cursor: "nonsense" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0]?.path).toBe("cursor");
    });
  });

  describe("identifiers", () => {
    it("refuses an over-long application id", () => {
      expect(parseLogFilters({ applicationId: "a".repeat(65) }).ok).toBe(false);
    });

    it("refuses an over-long cursor", () => {
      expect(
        parseLogFilters({
          cursor: `${CURSOR_TS.toISOString()}_${"c".repeat(40)}`,
        }).ok,
      ).toBe(false);
    });

    it("reports the offending field", () => {
      const result = parseLogFilters({ limit: "9999" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0]?.path).toBe("limit");
    });
  });
});

describe("log cursor codec", () => {
  it("round-trips an instant and an id", () => {
    const encoded = encodeLogCursor({ ts: CURSOR_TS, id: "event-9" });

    expect(encoded).toBe(`${CURSOR_TS.toISOString()}_event-9`);
    expect(decodeLogCursor(encoded)).toEqual({ ts: CURSOR_TS, id: "event-9" });
  });

  it("keeps millisecond precision, which the timestamp column stores", () => {
    const ts = new Date("2026-10-16T11:49:09.007Z");

    expect(decodeLogCursor(encodeLogCursor({ ts, id: "e" }))?.ts).toEqual(ts);
  });

  it("splits on the first separator so an id containing one survives", () => {
    const decoded = decodeLogCursor(`${CURSOR_TS.toISOString()}_a_b`);

    expect(decoded?.id).toBe("a_b");
  });

  it("returns null rather than throwing for anything malformed", () => {
    expect(decodeLogCursor("")).toBeNull();
    expect(decodeLogCursor("event-1")).toBeNull();
    expect(decodeLogCursor("_event-1")).toBeNull();
    expect(decodeLogCursor(`${CURSOR_TS.toISOString()}_`)).toBeNull();
    expect(decodeLogCursor("2026-10-16T11:49:09Z_event-1")).toBeNull();
  });
});
