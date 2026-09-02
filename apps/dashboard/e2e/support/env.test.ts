import { describe, expect, it } from "vitest";

import {
  DEFAULT_BASE_URL,
  DEFAULT_PORT,
  E2E_DATABASE_URL_MISSING_MESSAGE,
  isDisposableDatabase,
  NON_DISPOSABLE_DATABASE_MESSAGE,
  PRODUCTION_DATABASE_MESSAGE,
  resolveDatabaseTarget,
  resolveE2eTarget,
  resolveSmokeTarget,
  seedAllowedOrigins,
  SMOKE_BASE_URL_MISSING_MESSAGE,
} from "./env";

describe("resolveE2eTarget", () => {
  it("manages its own server when no base URL is supplied", () => {
    expect(resolveE2eTarget({})).toEqual({
      baseUrl: DEFAULT_BASE_URL,
      managesServer: true,
      port: DEFAULT_PORT,
    });
  });

  it("defers to an already-running server when one is named", () => {
    expect(resolveE2eTarget({ E2E_BASE_URL: "http://127.0.0.1:4000" })).toEqual(
      {
        baseUrl: "http://127.0.0.1:4000",
        managesServer: false,
        port: undefined,
      },
    );
  });

  it("moves the base URL and the port together when E2E_PORT is set", () => {
    expect(resolveE2eTarget({ E2E_PORT: "3100" })).toEqual({
      baseUrl: "http://127.0.0.1:3100",
      managesServer: true,
      port: 3100,
    });
  });

  it("ignores E2E_PORT when the server is someone else's", () => {
    // Nothing is being started, so there is no port to choose - honouring it
    // here would build a base URL that points at nothing.
    expect(
      resolveE2eTarget({ E2E_BASE_URL: "https://logs.test", E2E_PORT: "3100" }),
    ).toEqual({
      baseUrl: "https://logs.test",
      managesServer: false,
      port: undefined,
    });
  });

  it("refuses a port it cannot use rather than quietly falling back", () => {
    expect(() => resolveE2eTarget({ E2E_PORT: "not-a-port" })).toThrow(
      /E2E_PORT must be a port number/,
    );
    expect(() => resolveE2eTarget({ E2E_PORT: "0" })).toThrow(/E2E_PORT/);
    expect(() => resolveE2eTarget({ E2E_PORT: "70000" })).toThrow(/E2E_PORT/);
  });

  it("ignores a blank base URL rather than pointing at nothing", () => {
    expect(resolveE2eTarget({ E2E_BASE_URL: "   " }).managesServer).toBe(true);
  });

  it("drops a trailing slash so hrefs are not double-slashed", () => {
    expect(resolveE2eTarget({ E2E_BASE_URL: "https://logs.test/" })).toEqual({
      baseUrl: "https://logs.test",
      managesServer: false,
      port: undefined,
    });
  });
});

describe("resolveSmokeTarget", () => {
  it("uses the supplied smoke URL", () => {
    expect(resolveSmokeTarget({ SMOKE_BASE_URL: "https://logs.test" })).toEqual(
      { ok: true, baseUrl: "https://logs.test" },
    );
  });

  it("refuses to guess, even when an e2e base URL is available", () => {
    const result = resolveSmokeTarget({
      E2E_BASE_URL: "http://127.0.0.1:3000",
    });

    expect(result).toEqual({
      ok: false,
      message: SMOKE_BASE_URL_MISSING_MESSAGE,
    });
  });

  it("names the variable to set in its message", () => {
    expect(SMOKE_BASE_URL_MISSING_MESSAGE).toContain("SMOKE_BASE_URL");
  });
});

/** A disposable target, so each test below states only what it is about. */
const DISPOSABLE_URL = "postgresql://postgres:hunter2@127.0.0.1:5432/app_e2e";

describe("resolveDatabaseTarget", () => {
  it("accepts a database whose name says it is disposable", () => {
    expect(resolveDatabaseTarget({ E2E_DATABASE_URL: DISPOSABLE_URL })).toEqual(
      {
        ok: true,
        url: DISPOSABLE_URL,
        directUrl: DISPOSABLE_URL,
      },
    );
  });

  it("takes the unpooled migrate connection from E2E_DIRECT_DATABASE_URL", () => {
    const direct = "postgresql://postgres:hunter2@127.0.0.1:5433/app_e2e";

    expect(
      resolveDatabaseTarget({
        E2E_DATABASE_URL: DISPOSABLE_URL,
        E2E_DIRECT_DATABASE_URL: direct,
      }),
    ).toEqual({ ok: true, url: DISPOSABLE_URL, directUrl: direct });
  });

  it("refuses to invent a connection string", () => {
    expect(resolveDatabaseTarget({})).toEqual({
      ok: false,
      message: E2E_DATABASE_URL_MISSING_MESSAGE,
    });
  });

  it("ignores a blank E2E_DATABASE_URL rather than pointing at nothing", () => {
    expect(resolveDatabaseTarget({ E2E_DATABASE_URL: "   " })).toEqual({
      ok: false,
      message: E2E_DATABASE_URL_MISSING_MESSAGE,
    });
  });

  // THE DENIAL TESTS. Each one is a way an operator ends up pointed at a real
  // deployment, and the harness force-creates an ADMIN account with a
  // repository-readable password and deletes log rows in whatever it accepts.
  it("NEVER falls back to an ambient DATABASE_URL", () => {
    // Exported as a matter of course in containers, in CI, by direnv and on a
    // server. Accepting it is how `pnpm test:e2e` in the wrong shell seeds a
    // production database.
    expect(
      resolveDatabaseTarget({
        DATABASE_URL: "postgresql://postgres:hunter2@db.internal:5432/logger",
      }),
    ).toEqual({ ok: false, message: E2E_DATABASE_URL_MISSING_MESSAGE });
  });

  it("refuses a database whose name does not read as an e2e one", () => {
    expect(
      resolveDatabaseTarget({
        E2E_DATABASE_URL:
          "postgresql://postgres:hunter2@db.internal:5432/stuffs_logger",
      }),
    ).toEqual({ ok: false, message: NON_DISPOSABLE_DATABASE_MESSAGE });
  });

  it("refuses a non-disposable MIGRATE target even when the pooled one is fine", () => {
    // `prisma migrate deploy` runs against the direct URL, which makes it the
    // most destructive of the two.
    expect(
      resolveDatabaseTarget({
        E2E_DATABASE_URL: DISPOSABLE_URL,
        E2E_DIRECT_DATABASE_URL:
          "postgresql://postgres:hunter2@db.internal:5432/stuffs_logger",
      }),
    ).toEqual({ ok: false, message: NON_DISPOSABLE_DATABASE_MESSAGE });
  });

  it("refuses under NODE_ENV=production however the database is named", () => {
    expect(
      resolveDatabaseTarget({
        E2E_DATABASE_URL: DISPOSABLE_URL,
        NODE_ENV: "production",
      }),
    ).toEqual({ ok: false, message: PRODUCTION_DATABASE_MESSAGE });
  });

  it("never echoes the connection string it refused", () => {
    // Every refusal is attached to a failing step in the HTML report and
    // printed in CI logs, and a Postgres URL carries a password.
    const result = resolveDatabaseTarget({
      E2E_DATABASE_URL:
        "postgresql://postgres:hunter2@db.internal:5432/stuffs_logger",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.message).not.toContain("hunter2");
    expect(result.message).not.toContain("db.internal");
  });
});

describe("isDisposableDatabase", () => {
  it.each([
    "postgresql://h/stuffs_logger_e2e",
    "postgresql://h/e2e",
    "postgresql://h/logger-test",
    "postgresql://h/test",
    "postgresql://h/E2E_Logger",
    "postgresql://h/stuffs_logger_e2e?schema=public",
  ])("accepts %s", (url) => {
    expect(isDisposableDatabase(url)).toBe(true);
  });

  it.each([
    "postgresql://h/stuffs_logger",
    "postgresql://h/production",
    // `test` is in there, but only as part of a longer word.
    "postgresql://h/latest",
    "postgresql://h/protests",
    // Nothing to read: fails closed rather than guessing.
    "postgresql://h/",
    "postgresql://h",
    "not-a-url",
    "",
  ])("refuses %s", (url) => {
    expect(isDisposableDatabase(url)).toBe(false);
  });
});

describe("seedAllowedOrigins", () => {
  it("allows both loopback spellings of the target origin", () => {
    expect(seedAllowedOrigins("http://127.0.0.1:3000")).toEqual([
      "http://127.0.0.1:3000",
      "http://localhost:3000",
    ]);
  });

  it("pairs localhost with its numeric twin too", () => {
    expect(seedAllowedOrigins("http://localhost:3000")).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);
  });

  it("does not invent twins for a non-loopback host", () => {
    expect(seedAllowedOrigins("https://logs.example.test")).toEqual([
      "https://logs.example.test",
    ]);
  });

  it("appends explicitly configured origins", () => {
    expect(
      seedAllowedOrigins("https://logs.test", "https://a.test, https://b.test"),
    ).toEqual(["https://logs.test", "https://a.test", "https://b.test"]);
  });

  it("de-duplicates an extra origin that is already covered", () => {
    expect(
      seedAllowedOrigins("https://logs.test", "https://logs.test"),
    ).toEqual(["https://logs.test"]);
  });

  it("drops entries that are not URLs rather than seeding a broken allowlist", () => {
    expect(seedAllowedOrigins("https://logs.test", "not-a-url, ,")).toEqual([
      "https://logs.test",
    ]);
  });

  it("returns nothing at all for an unparseable target", () => {
    expect(seedAllowedOrigins("not-a-url")).toEqual([]);
  });
});
