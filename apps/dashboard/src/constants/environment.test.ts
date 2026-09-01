import { describe, expect, it, vi } from "vitest";

import {
  assertAuthNotSkippedInProduction,
  isAuthSkippedIn,
} from "./environment";

/**
 * The guard, not the constants. `SKIP_AUTH` in a deployed environment turns
 * every visitor into an active INTERNAL_ADMIN, so the case that matters is the
 * one that must never boot.
 */
describe("isAuthSkippedIn", () => {
  it.each(["SKIP_AUTH", "NEXT_PUBLIC_SKIP_AUTH"])(
    "reports skipped when %s is true",
    (name) => {
      expect(isAuthSkippedIn({ [name]: "true" })).toBe(true);
    },
  );

  it("matches the package's case-insensitive comparison", () => {
    expect(isAuthSkippedIn({ SKIP_AUTH: "TRUE" })).toBe(true);
  });

  it.each(["false", "1", "yes", ""])("does not treat %o as true", (value) => {
    expect(isAuthSkippedIn({ SKIP_AUTH: value })).toBe(false);
  });

  it("reports not skipped when neither variable is set", () => {
    expect(isAuthSkippedIn({})).toBe(false);
  });
});

describe("assertAuthNotSkippedInProduction", () => {
  it.each(["SKIP_AUTH", "NEXT_PUBLIC_SKIP_AUTH"])(
    "throws when %s is set in production",
    (name) => {
      expect(() =>
        assertAuthNotSkippedInProduction({
          NODE_ENV: "production",
          [name]: "true",
        }),
      ).toThrow(/must never be set in production/);
    },
  );

  it("allows production with auth switched on", () => {
    expect(() =>
      assertAuthNotSkippedInProduction({ NODE_ENV: "production" }),
    ).not.toThrow();
  });

  it("allows local development to skip auth", () => {
    expect(() =>
      assertAuthNotSkippedInProduction({
        NODE_ENV: "development",
        SKIP_AUTH: "true",
      }),
    ).not.toThrow();
  });

  it("allows a test run to skip auth", () => {
    expect(() =>
      assertAuthNotSkippedInProduction({ NODE_ENV: "test", SKIP_AUTH: "true" }),
    ).not.toThrow();
  });

  it("names both variables so the fix is unambiguous", () => {
    try {
      assertAuthNotSkippedInProduction({
        NODE_ENV: "production",
        SKIP_AUTH: "true",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("SKIP_AUTH");
      expect(message).toContain("NEXT_PUBLIC_SKIP_AUTH");
    }
  });
});

describe("module boot", () => {
  it("refuses to load in a production environment with auth skipped", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousSkip = process.env.SKIP_AUTH;

    // NODE_ENV is read-only in the Next types but writable at runtime, which
    // is exactly the state a mis-copied .env would produce.
    Object.assign(process.env, { NODE_ENV: "production", SKIP_AUTH: "true" });
    vi.resetModules();

    await expect(import("./environment")).rejects.toThrow(
      /must never be set in production/,
    );

    Object.assign(process.env, {
      NODE_ENV: previousNodeEnv,
      SKIP_AUTH: previousSkip,
    });
    if (previousSkip === undefined) delete process.env.SKIP_AUTH;
    vi.resetModules();
  });
});
