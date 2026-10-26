import { describe, expect, it } from "vitest";

import {
  EMPTY_VALUE,
  MAX_CONTEXT_CHARS,
  formatContext,
  formatCount,
  formatErrorRate,
  formatStack,
  formatUtcTimestamp,
  formatUtcTimestampLong,
  toDateTimeLocalValue,
} from "./format";

describe("formatUtcTimestamp", () => {
  it("formats an instant in UTC regardless of the runtime's timezone", () => {
    expect(formatUtcTimestamp("2026-01-15T09:31:04.123Z")).toBe(
      "15 Jan 09:31:04",
    );
  });

  it("formats the same instant identically whatever offset it is written in", () => {
    expect(formatUtcTimestamp("2026-01-15T10:31:04+01:00")).toBe(
      formatUtcTimestamp("2026-01-15T09:31:04Z"),
    );
  });

  it("returns a placeholder for an unparseable value", () => {
    expect(formatUtcTimestamp("not a date")).toBe(EMPTY_VALUE);
  });

  it("accepts an already-parsed Date, so a row can parse its timestamp once", () => {
    expect(formatUtcTimestamp(new Date("2026-01-15T09:31:04.123Z"))).toBe(
      "15 Jan 09:31:04",
    );
  });

  it("returns a placeholder for an invalid Date", () => {
    expect(formatUtcTimestamp(new Date("not a date"))).toBe(EMPTY_VALUE);
  });
});

describe("formatUtcTimestampLong", () => {
  it("includes the year, milliseconds and the zone", () => {
    expect(formatUtcTimestampLong("2026-01-15T09:31:04.007Z")).toBe(
      "15 Jan 2026 09:31:04.007 UTC",
    );
  });

  it("formats a Date identically to its ISO string", () => {
    const iso = "2026-01-15T09:31:04.007Z";

    expect(formatUtcTimestampLong(new Date(iso))).toBe(
      formatUtcTimestampLong(iso),
    );
  });

  it("returns a placeholder for an invalid Date", () => {
    expect(formatUtcTimestampLong(new Date("not a date"))).toBe(EMPTY_VALUE);
  });
});

describe("toDateTimeLocalValue", () => {
  it("produces a value a datetime-local input accepts", () => {
    expect(toDateTimeLocalValue(new Date("2026-01-15T09:31:04.000Z"))).toBe(
      "2026-01-15T09:31",
    );
  });

  it("is empty when no bound is set", () => {
    expect(toDateTimeLocalValue(undefined)).toBe("");
  });
});

describe("formatCount", () => {
  it("separates thousands", () => {
    expect(formatCount(12405)).toBe("12,405");
  });

  it("renders zero", () => {
    expect(formatCount(0)).toBe("0");
  });
});

describe("formatErrorRate", () => {
  it("expresses errors as a share of all events", () => {
    expect(formatErrorRate(5, 100)).toBe("5.0%");
  });

  it("is zero when nothing was logged, rather than dividing by zero", () => {
    expect(formatErrorRate(0, 0)).toBe("0%");
  });
});

describe("formatContext", () => {
  it("pretty-prints an object", () => {
    expect(formatContext({ orderId: "abc" })).toBe('{\n  "orderId": "abc"\n}');
  });

  it("renders a null context as JSON null rather than throwing", () => {
    expect(formatContext(null)).toBe("null");
  });

  it("truncates a context that would swamp the page", () => {
    const huge = { value: "x".repeat(MAX_CONTEXT_CHARS * 2) };

    const formatted = formatContext(huge);

    expect(formatted.length).toBeLessThan(MAX_CONTEXT_CHARS + 100);
    expect(formatted).toContain("truncated for display");
  });

  it("does not throw on a value JSON cannot serialise", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(formatContext(cyclic)).toBe("Context could not be displayed.");
  });
});

describe("formatStack", () => {
  it("leaves an ordinary trace alone", () => {
    expect(formatStack("Error: boom\n  at thing")).toBe(
      "Error: boom\n  at thing",
    );
  });

  it("truncates a trace long enough to lock up layout", () => {
    const formatted = formatStack("y".repeat(MAX_CONTEXT_CHARS * 2));

    expect(formatted).toContain("truncated for display");
  });
});
