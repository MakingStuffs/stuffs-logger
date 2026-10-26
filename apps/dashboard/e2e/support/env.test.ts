import { describe, expect, it } from "vitest";

import {
  DEFAULT_BASE_URL,
  DEFAULT_PORT,
  E2E_DATABASE_URL_MISSING_MESSAGE,
  isDisposableDatabase,
  isLoopbackDatabase,
  NON_DISPOSABLE_DATABASE_MESSAGE,
  PRODUCTION_DATABASE_MESSAGE,
  PRODUCTION_LIKE_DATABASE_MESSAGE,
  REMOTE_DATABASE_MESSAGE,
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

  // THE DENY-LIST BEATS THE ALLOW-LIST. Each of these contains `e2e` or
  // `test` as a whole word and would pass the allow pattern on its own.
  it.each([
    [
      "production-test",
      "postgresql://postgres:hunter2@127.0.0.1:5432/production-test",
    ],
    [
      "prod_e2e_replica",
      "postgresql://postgres:hunter2@127.0.0.1:5432/prod_e2e_replica",
    ],
    ["live-e2e", "postgresql://postgres:hunter2@127.0.0.1:5432/live-e2e"],
  ])("refuses a production-like name even on loopback: %s", (_name, url) => {
    expect(resolveDatabaseTarget({ E2E_DATABASE_URL: url })).toEqual({
      ok: false,
      message: PRODUCTION_LIKE_DATABASE_MESSAGE,
    });
  });

  it("refuses a database on another host, even with a disposable name", () => {
    expect(
      resolveDatabaseTarget({
        E2E_DATABASE_URL:
          "postgresql://postgres:hunter2@db.internal:5432/app_e2e",
      }),
    ).toEqual({ ok: false, message: REMOTE_DATABASE_MESSAGE });
  });

  it("honours Prisma's ?host= override when deciding where the bytes go", () => {
    // The authority says loopback; the override says otherwise, and the
    // override is what Prisma connects to.
    expect(
      resolveDatabaseTarget({
        E2E_DATABASE_URL: "postgresql://u@127.0.0.1/e2e?host=prod-db.internal",
      }),
    ).toEqual({ ok: false, message: REMOTE_DATABASE_MESSAGE });
  });

  it("holds the MIGRATE target to the host rule too", () => {
    expect(
      resolveDatabaseTarget({
        E2E_DATABASE_URL: DISPOSABLE_URL,
        E2E_DIRECT_DATABASE_URL:
          "postgresql://postgres:hunter2@db.internal:5432/app_e2e",
      }),
    ).toEqual({ ok: false, message: REMOTE_DATABASE_MESSAGE });
  });

  it("allows a remote host when E2E_ALLOW_REMOTE_DATABASE=1 says it is disposable", () => {
    const remote = "postgresql://postgres:hunter2@db.internal:5432/app_e2e";

    expect(
      resolveDatabaseTarget({
        E2E_DATABASE_URL: remote,
        E2E_ALLOW_REMOTE_DATABASE: "1",
      }),
    ).toEqual({ ok: true, url: remote, directUrl: remote });
  });

  it.each(["0", "false", "", "yes", " "])(
    "does not treat E2E_ALLOW_REMOTE_DATABASE=%j as the opt-in",
    (value) => {
      expect(
        resolveDatabaseTarget({
          E2E_DATABASE_URL:
            "postgresql://postgres:hunter2@db.internal:5432/app_e2e",
          E2E_ALLOW_REMOTE_DATABASE: value,
        }),
      ).toEqual({ ok: false, message: REMOTE_DATABASE_MESSAGE });
    },
  );

  it("does not let the remote opt-in relax either name rule", () => {
    expect(
      resolveDatabaseTarget({
        E2E_DATABASE_URL:
          "postgresql://postgres:hunter2@db.internal:5432/stuffs_logger",
        E2E_ALLOW_REMOTE_DATABASE: "1",
      }),
    ).toEqual({ ok: false, message: NON_DISPOSABLE_DATABASE_MESSAGE });

    expect(
      resolveDatabaseTarget({
        E2E_DATABASE_URL:
          "postgresql://postgres:hunter2@db.internal:5432/prod_e2e_replica",
        E2E_ALLOW_REMOTE_DATABASE: "1",
      }),
    ).toEqual({ ok: false, message: PRODUCTION_LIKE_DATABASE_MESSAGE });
  });

  it.each([
    [
      "a non-disposable name",
      "postgresql://postgres:hunter2@db.internal:5432/stuffs_logger",
    ],
    [
      "a production-like name",
      "postgresql://postgres:hunter2@db.internal:5432/prod_e2e_replica",
    ],
    ["a remote host", "postgresql://postgres:hunter2@db.internal:5432/app_e2e"],
    [
      "a ?host= override",
      "postgresql://postgres:hunter2@127.0.0.1/e2e?host=prod-db.internal",
    ],
  ])("never echoes the connection string it refused for %s", (_why, url) => {
    // Every refusal is attached to a failing step in the HTML report and
    // printed in CI logs, and a Postgres URL carries a password and a host.
    const result = resolveDatabaseTarget({ E2E_DATABASE_URL: url });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.message).not.toContain("hunter2");
    expect(result.message).not.toContain("db.internal");
    expect(result.message).not.toContain("prod-db");
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
    // `prod` and `live` only as parts of longer words, so the deny pattern
    // does not fire on them.
    "postgresql://h/product_e2e",
    "postgresql://h/delivery-test",
  ])("accepts %s", (url) => {
    expect(isDisposableDatabase(url)).toBe(true);
  });

  it.each([
    "postgresql://h/stuffs_logger",
    "postgresql://h/production",
    // `test` is in there, but only as part of a longer word.
    "postgresql://h/latest",
    "postgresql://h/protests",
    // The allow pattern matches; the deny pattern matches first.
    "postgresql://h/production-test",
    "postgresql://h/prod_e2e_replica",
    "postgresql://h/live-e2e",
    "postgresql://h/e2e_LIVE",
    // Nothing to read: fails closed rather than guessing.
    "postgresql://h/",
    "postgresql://h",
    "not-a-url",
    "",
  ])("refuses %s", (url) => {
    expect(isDisposableDatabase(url)).toBe(false);
  });
});

describe("isLoopbackDatabase", () => {
  it.each([
    "postgresql://postgres:hunter2@127.0.0.1:5432/app_e2e",
    "postgresql://postgres:hunter2@localhost:5432/app_e2e",
    "postgresql://postgres:hunter2@LOCALHOST/app_e2e",
    "postgresql://postgres:hunter2@[::1]:5432/app_e2e",
    // The override wins, and here it points back at this machine.
    "postgresql://u@db.internal/app_e2e?host=127.0.0.1",
    "postgresql://u@db.internal/app_e2e?host=::1",
  ])("accepts %s", (url) => {
    expect(isLoopbackDatabase(url)).toBe(true);
  });

  it.each([
    "postgresql://postgres:hunter2@db.internal:5432/app_e2e",
    "postgresql://postgres:hunter2@10.0.0.5:5432/app_e2e",
    // The authority is loopback; the override is not.
    "postgresql://u@127.0.0.1/e2e?host=prod-db.internal",
    // A socket path is not one of the three loopback spellings.
    "postgresql://u@localhost/e2e?host=/var/run/postgresql",
    // No host at all: fails closed.
    "postgresql:///e2e",
    "not-a-url",
    "",
  ])("refuses %s", (url) => {
    expect(isLoopbackDatabase(url)).toBe(false);
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
