import { describe, expect, it } from "vitest";

import { MAX_CLOCK_SKEW_FUTURE_MS, MAX_CLOCK_SKEW_PAST_MS } from "./constants";
import { clampEventTimestamp } from "./timestamps";

const RECEIVED_AT = new Date("2026-09-01T12:00:00.000Z");

describe("clampEventTimestamp", () => {
  it("keeps a timestamp equal to the receive time", () => {
    const result = clampEventTimestamp(RECEIVED_AT.getTime(), RECEIVED_AT);

    expect(result).toEqual({ timestamp: RECEIVED_AT, wasClamped: false });
  });

  it("keeps a plausible recent timestamp", () => {
    const clientTs = RECEIVED_AT.getTime() - 5_000;
    const result = clampEventTimestamp(clientTs, RECEIVED_AT);

    expect(result.wasClamped).toBe(false);
    expect(result.timestamp.getTime()).toBe(clientTs);
  });

  it("keeps a timestamp exactly at the future boundary", () => {
    const clientTs = RECEIVED_AT.getTime() + MAX_CLOCK_SKEW_FUTURE_MS;

    expect(clampEventTimestamp(clientTs, RECEIVED_AT).wasClamped).toBe(false);
  });

  it("clamps a timestamp beyond the future boundary to the receive time", () => {
    const clientTs = RECEIVED_AT.getTime() + MAX_CLOCK_SKEW_FUTURE_MS + 1;
    const result = clampEventTimestamp(clientTs, RECEIVED_AT);

    expect(result).toEqual({ timestamp: RECEIVED_AT, wasClamped: true });
  });

  it("keeps a timestamp exactly at the past boundary", () => {
    const clientTs = RECEIVED_AT.getTime() - MAX_CLOCK_SKEW_PAST_MS;

    expect(clampEventTimestamp(clientTs, RECEIVED_AT).wasClamped).toBe(false);
  });

  it("clamps a timestamp beyond the past boundary to the receive time", () => {
    const clientTs = RECEIVED_AT.getTime() - MAX_CLOCK_SKEW_PAST_MS - 1;
    const result = clampEventTimestamp(clientTs, RECEIVED_AT);

    expect(result).toEqual({ timestamp: RECEIVED_AT, wasClamped: true });
  });

  it("clamps a wildly future timestamp", () => {
    const tenYears = 10 * 365 * 24 * 60 * 60 * 1000;
    const result = clampEventTimestamp(
      RECEIVED_AT.getTime() + tenYears,
      RECEIVED_AT,
    );

    expect(result).toEqual({ timestamp: RECEIVED_AT, wasClamped: true });
  });

  it("clamps a zero timestamp from an unset clock", () => {
    expect(clampEventTimestamp(0, RECEIVED_AT)).toEqual({
      timestamp: RECEIVED_AT,
      wasClamped: true,
    });
  });

  it("clamps a non-finite timestamp", () => {
    expect(clampEventTimestamp(Number.NaN, RECEIVED_AT).wasClamped).toBe(true);
    expect(
      clampEventTimestamp(Number.POSITIVE_INFINITY, RECEIVED_AT).wasClamped,
    ).toBe(true);
  });
});
