import { describe, expect, it } from "vitest";

import { isSuppressed, runSuppressed } from "./suppression";

describe("runSuppressed", () => {
  it("suppresses only for the duration of the operation", () => {
    expect(isSuppressed()).toBe(false);

    runSuppressed(() => {
      expect(isSuppressed()).toBe(true);
    });

    expect(isSuppressed()).toBe(false);
  });

  it("stays suppressed through nested SDK work", () => {
    runSuppressed(() => {
      runSuppressed(() => undefined);
      expect(isSuppressed()).toBe(true);
    });

    expect(isSuppressed()).toBe(false);
  });

  it("lifts suppression even when the operation throws", () => {
    expect(() => {
      runSuppressed(() => {
        throw new Error("boom");
      });
    }).toThrow("boom");

    expect(isSuppressed()).toBe(false);
  });

  it("returns the operation's value", () => {
    expect(runSuppressed(() => 42)).toBe(42);
  });
});
