import { describe, expect, it, vi } from "vitest";

import {
  assertAuthNotSkippedInProduction,
  assertProductionAuthEnvironment,
  isAuthSkippedIn,
  MIN_BETTER_AUTH_SECRET_LENGTH,
} from "./environment";

/**
 * The guards, not the constants. `SKIP_AUTH` in a deployed environment turns
 * every visitor into an active INTERNAL_ADMIN, so the case that matters is the
 * one that must never boot; and a production server whose auth origin is
 * derived from request headers is one whose trusted origins a caller picks,
 * so the case that matters there is the one that must never SERVE.
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

describe("assertProductionAuthEnvironment", () => {
  const SECRET = "s".repeat(MIN_BETTER_AUTH_SECRET_LENGTH);

  /** A production environment with nothing wrong, for the cases to vary. */
  function production(
    overrides: Record<string, string | undefined> = {},
  ): Record<string, string | undefined> {
    return {
      NODE_ENV: "production",
      BETTER_AUTH_URL: "https://logger.example.com",
      BETTER_AUTH_SECRET: SECRET,
      ...overrides,
    };
  }

  it("accepts a complete production environment", () => {
    expect(() => assertProductionAuthEnvironment(production())).not.toThrow();
  });

  it("accepts an origin written with a trailing slash", () => {
    expect(() =>
      assertProductionAuthEnvironment(
        production({ BETTER_AUTH_URL: "https://logger.example.com/" }),
      ),
    ).not.toThrow();
  });

  it.each([undefined, ""])(
    "throws when BETTER_AUTH_URL is %o in production",
    (value) => {
      expect(() =>
        assertProductionAuthEnvironment(production({ BETTER_AUTH_URL: value })),
      ).toThrow(/BETTER_AUTH_URL must be set/);
    },
  );

  it.each(["logger.example.com", "https://[", "not a url"])(
    "throws when BETTER_AUTH_URL is %o, which is not a URL",
    (value) => {
      expect(() =>
        assertProductionAuthEnvironment(production({ BETTER_AUTH_URL: value })),
      ).toThrow(/BETTER_AUTH_URL/);
    },
  );

  it("throws when BETTER_AUTH_URL is not https", () => {
    expect(() =>
      assertProductionAuthEnvironment(
        production({ BETTER_AUTH_URL: "http://logger.example.com" }),
      ),
    ).toThrow(/https/);
  });

  it.each([
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://[::1]:3000",
  ])("tolerates cleartext only on the loopback host %s", (value) => {
    // `next start` is a production build, and both a local run and the e2e
    // harness serve it over cleartext loopback.
    expect(() =>
      assertProductionAuthEnvironment(production({ BETTER_AUTH_URL: value })),
    ).not.toThrow();
  });

  it.each([
    ["a path", "https://logger.example.com/app"],
    ["a query", "https://logger.example.com/?x=1"],
    ["a fragment", "https://logger.example.com/#top"],
    ["credentials", "https://user:secret@logger.example.com"],
  ])("throws when BETTER_AUTH_URL carries %s", (_name, value) => {
    expect(() =>
      assertProductionAuthEnvironment(production({ BETTER_AUTH_URL: value })),
    ).toThrow(/BETTER_AUTH_URL/);
  });

  it.each([undefined, "", "s".repeat(MIN_BETTER_AUTH_SECRET_LENGTH - 1)])(
    "throws when BETTER_AUTH_SECRET is %o",
    (value) => {
      expect(() =>
        assertProductionAuthEnvironment(
          production({ BETTER_AUTH_SECRET: value }),
        ),
      ).toThrow(/BETTER_AUTH_SECRET/);
    },
  );

  it("never echoes the secret in the error", () => {
    const short = "hunter2";

    try {
      assertProductionAuthEnvironment(
        production({ BETTER_AUTH_SECRET: short }),
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(short);
    }
  });

  it.each(["development", "test", undefined])(
    "does nothing when NODE_ENV is %o",
    (nodeEnv) => {
      expect(() =>
        assertProductionAuthEnvironment({ NODE_ENV: nodeEnv }),
      ).not.toThrow();
    },
  );
});

describe("module boot", () => {
  it("does not require the production auth environment merely to load", async () => {
    // `next build` imports every route module with `NODE_ENV=production` and
    // no runtime environment. The auth-environment check therefore runs at
    // server START (`src/instrumentation.ts`), never at module load.
    const previousNodeEnv = process.env.NODE_ENV;
    const previousUrl = process.env.BETTER_AUTH_URL;
    const previousSecret = process.env.BETTER_AUTH_SECRET;

    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.BETTER_AUTH_URL;
    delete process.env.BETTER_AUTH_SECRET;
    vi.resetModules();

    await expect(import("./environment")).resolves.toBeDefined();

    Object.assign(process.env, {
      NODE_ENV: previousNodeEnv,
      BETTER_AUTH_URL: previousUrl,
      BETTER_AUTH_SECRET: previousSecret,
    });
    if (previousUrl === undefined) delete process.env.BETTER_AUTH_URL;
    if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    vi.resetModules();
  });

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
