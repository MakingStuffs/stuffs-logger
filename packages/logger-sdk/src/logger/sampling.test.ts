import { describe, expect, it } from "vitest";

import { resolveSampleRate, shouldSample } from "./sampling";

describe("resolveSampleRate", () => {
  it("prefers the per-level rate over the logger-wide one", () => {
    expect(resolveSampleRate("debug", 0.5, { debug: 0.1 })).toBe(0.1);
  });

  it("falls back to the logger-wide rate", () => {
    expect(resolveSampleRate("error", 0.25, { debug: 0.1 })).toBe(0.25);
  });

  it("keeps everything when nothing is configured", () => {
    expect(resolveSampleRate("info", undefined, undefined)).toBe(1);
  });

  it("clamps rates outside 0-1", () => {
    expect(resolveSampleRate("info", 5, undefined)).toBe(1);
    expect(resolveSampleRate("info", -1, undefined)).toBe(0);
  });

  it("ignores a non-finite rate rather than dropping everything", () => {
    expect(resolveSampleRate("info", Number.NaN, undefined)).toBe(1);
  });
});

describe("shouldSample", () => {
  it("keeps every event at a rate of 1 without consuming randomness", () => {
    const random = (): number => {
      throw new Error("randomness must not be needed at a rate of 1");
    };

    expect(shouldSample(1, random)).toBe(true);
  });

  it("drops every event at a rate of 0", () => {
    expect(shouldSample(0, () => 0)).toBe(false);
  });

  it("keeps an event when the draw falls under the rate", () => {
    expect(shouldSample(0.5, () => 0.49)).toBe(true);
    expect(shouldSample(0.5, () => 0.5)).toBe(false);
  });
});
