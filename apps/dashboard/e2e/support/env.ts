/**
 * Every environment variable the end-to-end and smoke runs read, resolved once
 * and in one place.
 *
 * Kept as PURE functions over an injected environment rather than reaching for
 * `process.env` at each call site, for the same reason
 * `src/constants/environment.ts` does it: the rules below decide whether
 * Playwright manages a server and which database gets written to, and both
 * answers must be testable without arranging a real environment. The unit
 * tests alongside this file are what pin them.
 */

/** A subset of `process.env`, so every rule below is testable without one. */
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/**
 * The port a run-managed dashboard listens on, when nothing says otherwise.
 *
 * Overridable with `E2E_PORT` because 3000 is the busiest port on a
 * developer's machine — another project's dev server holding it must not be
 * the reason the suite cannot run.
 */
export const DEFAULT_PORT = 3000;

/**
 * Where the locally-managed dashboard is served.
 *
 * `127.0.0.1` rather than `localhost`, deliberately: on a dual-stack machine
 * `localhost` resolves to `::1` first, `next start` binds IPv4, and the two
 * disagree just often enough to look like a flaky test. The SDK's endpoint
 * resolver allows cleartext `http:` on both, so nothing is lost.
 */
export const DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

/** Where the suite points, and who is responsible for the server. */
export interface E2eTarget {
  /** The origin every spec navigates relative to. */
  baseUrl: string;
  /**
   * Whether Playwright must start the dashboard itself.
   *
   * False whenever `E2E_BASE_URL` was supplied, because naming a target is how
   * a caller says "the server is already there" — a CI job that started one,
   * or a long-lived local `next start`. Starting a second one on the same port
   * would fail, and starting one on a different port would test the wrong
   * thing.
   */
  managesServer: boolean;
  /**
   * The port to start the dashboard on. `undefined` when the server is
   * someone else's responsibility and there is nothing to start.
   */
  port: number | undefined;
}

/**
 * Resolves the target of the main e2e projects.
 *
 * @param env - The environment to read.
 * @returns The base URL, and whether Playwright owns the server's lifecycle.
 * @example
 * resolveE2eTarget({}); // { baseUrl: "http://127.0.0.1:3000", managesServer: true }
 */
export function resolveE2eTarget(env: EnvironmentSource): E2eTarget {
  const supplied = env.E2E_BASE_URL?.trim();

  if (supplied !== undefined && supplied.length > 0) {
    return {
      baseUrl: stripTrailingSlash(supplied),
      managesServer: false,
      port: undefined,
    };
  }

  const port = resolvePort(env.E2E_PORT);

  return { baseUrl: `http://127.0.0.1:${port}`, managesServer: true, port };
}

/** The highest port number a TCP listener can take. */
const MAX_PORT = 65535;

/**
 * Reads `E2E_PORT`.
 *
 * THROWS rather than falling back on a value it cannot understand: silently
 * using 3000 after being told to use something else is precisely the failure
 * this option exists to avoid.
 *
 * @param value - The raw `E2E_PORT`, if set.
 * @returns The port to bind.
 * @throws {Error} When the value is not a usable port number.
 */
function resolvePort(value: string | undefined): number {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return DEFAULT_PORT;

  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(
      `E2E_PORT must be a port number between 1 and ${MAX_PORT}, not "${trimmed}".`,
    );
  }

  return port;
}

/** The message shown when the smoke suite has no target. */
export const SMOKE_BASE_URL_MISSING_MESSAGE =
  "SMOKE_BASE_URL is not set. The smoke suite runs against a DEPLOYED " +
  "environment and has no safe default, because pointing it at the wrong " +
  "origin would report a healthy deployment that was never checked. Set it " +
  "to the origin you want checked, e.g.\n\n" +
  "  SMOKE_BASE_URL=https://logger.example.com pnpm test:smoke\n";

/** A resolved smoke target, or the reason there is not one. */
export type SmokeTarget =
  | { readonly ok: true; readonly baseUrl: string }
  | { readonly ok: false; readonly message: string };

/**
 * Resolves the target of the smoke suite.
 *
 * REQUIRED, with no fallback to the local default. The smoke suite is the one
 * that runs against production, so "which origin" is the single fact it must
 * never guess: a silent fallback would turn a mis-set pipeline variable into a
 * green run that proved nothing about the deployment.
 *
 * @param env - The environment to read.
 * @returns The base URL, or a message naming exactly what to set.
 * @example
 * resolveSmokeTarget({ SMOKE_BASE_URL: "https://logs.example.com" });
 */
export function resolveSmokeTarget(env: EnvironmentSource): SmokeTarget {
  const supplied = env.SMOKE_BASE_URL?.trim();

  if (supplied === undefined || supplied.length === 0) {
    return { ok: false, message: SMOKE_BASE_URL_MISSING_MESSAGE };
  }

  return { ok: true, baseUrl: stripTrailingSlash(supplied) };
}

/** The message shown when the e2e database has not been named. */
export const E2E_DATABASE_URL_MISSING_MESSAGE =
  "E2E_DATABASE_URL is not set. The e2e suite runs against a REAL Postgres " +
  "that it migrates, seeds and truncates, so it has no default and it does " +
  "NOT fall back to DATABASE_URL — naming the database in its own variable " +
  "is how you say which one is disposable. Bring one up and name it:\n\n" +
  "  docker run --rm -d --name stuffs-logger-e2e -p 5432:5432 \\\n" +
  "    -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=stuffs_logger_e2e postgres:17\n" +
  "  export E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/stuffs_logger_e2e\n\n" +
  "See docs/CI-CD.md for the full local setup.\n";

/**
 * What a database has to be called before this harness will write to it.
 *
 * `e2e` or `test` as a WHOLE word, delimited by a non-alphanumeric character
 * or by an end of the name — so `stuffs_logger_e2e`, `logger-test` and `test`
 * all qualify while `stuffs_logger`, `latest` and `protest` do not.
 *
 * A name pattern is a crude check and it is meant to be: its whole job is to
 * refuse the one mistake that costs the most, which is pointing the suite at
 * something that is not a scratch database. Everything the seeder does to the
 * target is destructive — `prisma migrate deploy` against its schema, a
 * force-created ADMIN account whose password is a literal in this repository,
 * a freshly minted ingest key, and `deleteMany` over the seeded application's
 * log history. None of that is survivable on a real deployment, and none of it
 * can be undone.
 */
export const DISPOSABLE_DATABASE_NAME_PATTERN =
  /(?:^|[^a-z0-9])(?:e2e|test)(?:[^a-z0-9]|$)/i;

/** The message shown when the named database does not look disposable. */
export const NON_DISPOSABLE_DATABASE_MESSAGE =
  "Refusing to run against a database that does not look disposable.\n\n" +
  "The e2e harness MIGRATES, SEEDS AND TRUNCATES whatever it is pointed at: " +
  "it force-creates an ADMIN account whose password is a public literal in " +
  "this repository, mints an ingest key, and deletes the seeded " +
  "application's log history. So the database name must contain `e2e` or " +
  "`test` as a whole word — e.g. `stuffs_logger_e2e`.\n\n" +
  "If the target really is a scratch database, rename it (or `createdb " +
  "stuffs_logger_e2e`) rather than relaxing this check.\n";

/** The message shown when the harness is asked to run in production. */
export const PRODUCTION_DATABASE_MESSAGE =
  "Refusing to run the e2e harness with NODE_ENV=production.\n\n" +
  "It seeds fixture accounts with publicly known passwords and deletes log " +
  "rows. There is no production environment in which that is the intent.\n";

/** A resolved pair of connection strings, or the reason there is not one. */
export type DatabaseTarget =
  | {
      readonly ok: true;
      /** The pooled connection the seeder and the dashboard use. */
      readonly url: string;
      /**
       * The unpooled connection `prisma migrate deploy` uses. The same value
       * as `url` unless `E2E_DIRECT_DATABASE_URL` says otherwise.
       */
      readonly directUrl: string;
    }
  | { readonly ok: false; readonly message: string };

/**
 * Resolves the database the e2e run migrates, seeds and truncates.
 *
 * AN EXPLICIT OPT-IN, TWICE OVER. `E2E_DATABASE_URL` is required and there is
 * deliberately no fallback to the ambient `DATABASE_URL`: that variable is
 * exported as a matter of course in containers, in CI, by direnv and on a
 * server, so accepting it means an operator who runs `pnpm test:e2e` in the
 * wrong shell installs an ADMIN account with a repository-readable password
 * into a real deployment — the exact account `disableSignUp: true` exists to
 * make impossible — and deletes that deployment's seeded log history on the
 * way. And because a variable named `E2E_…` can still be pointed at the wrong
 * thing, the database it names must also LOOK disposable.
 *
 * NEITHER MESSAGE EVER ECHOES A CONNECTION STRING. They are attached to a
 * failing step in the HTML report and printed in CI logs, and a Postgres URL
 * carries a password; only the database name is quoted back.
 *
 * @param env - The environment to read.
 * @returns Both connection strings, or a message explaining the refusal.
 * @example
 * resolveDatabaseTarget({ E2E_DATABASE_URL: "postgresql://h/app_e2e" });
 * // { ok: true, url: "postgresql://h/app_e2e", directUrl: "postgresql://h/app_e2e" }
 */
export function resolveDatabaseTarget(env: EnvironmentSource): DatabaseTarget {
  const url = setValue(env.E2E_DATABASE_URL);

  if (url === undefined) {
    return { ok: false, message: E2E_DATABASE_URL_MISSING_MESSAGE };
  }

  if (env.NODE_ENV === "production") {
    return { ok: false, message: PRODUCTION_DATABASE_MESSAGE };
  }

  // Checked SEPARATELY, because the direct URL is the one `prisma migrate
  // deploy` runs against — the single most destructive thing the harness does.
  const directUrl = setValue(env.E2E_DIRECT_DATABASE_URL) ?? url;

  for (const candidate of [url, directUrl]) {
    if (!isDisposableDatabase(candidate)) {
      return { ok: false, message: NON_DISPOSABLE_DATABASE_MESSAGE };
    }
  }

  return { ok: true, url, directUrl };
}

/**
 * Whether a connection string names a database this harness may destroy.
 *
 * FAILS CLOSED on anything it cannot read: a connection string whose database
 * name cannot be extracted is one whose disposability cannot be established,
 * and "I could not tell" must never resolve to "go ahead".
 *
 * @param connectionString - A Postgres connection URL.
 * @returns True when the database name reads as an e2e-only one.
 */
export function isDisposableDatabase(connectionString: string): boolean {
  const name = databaseNameOf(connectionString);
  if (name === undefined) return false;

  return DISPOSABLE_DATABASE_NAME_PATTERN.test(name);
}

/**
 * The database name inside a Postgres connection URL.
 *
 * @param connectionString - A Postgres connection URL.
 * @returns The name, or `undefined` when there is not one to read.
 */
function databaseNameOf(connectionString: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return undefined;
  }

  // `/stuffs_logger_e2e` -> `stuffs_logger_e2e`. Decoded because a name may be
  // percent-encoded, and a decode that throws is a name that cannot be read.
  try {
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The origins the seeded PUBLIC ingest key is allowed to be used from.
 *
 * A public key is gated on nothing but this list (see
 * `src/lib/ingest/keys.ts`), so the round-trip spec's browser page can only
 * reach ingest if the origin it is served from is on it. Both loopback
 * spellings are included because the dashboard answers on either and a
 * developer may have typed whichever one; they are exact strings, never
 * patterns, matching how the key is verified.
 *
 * @param baseUrl - The origin the suite is pointed at.
 * @param extra - Comma-separated additional origins, from
 *   `E2E_SEED_ALLOWED_ORIGINS`.
 * @returns A de-duplicated list of exact origins.
 * @example
 * seedAllowedOrigins("http://127.0.0.1:3000");
 * // ["http://127.0.0.1:3000", "http://localhost:3000"]
 */
export function seedAllowedOrigins(
  baseUrl: string,
  extra: string | undefined = undefined,
): string[] {
  const origins = new Set<string>();

  const parsed = parseOrigin(baseUrl);
  if (parsed !== undefined) {
    origins.add(parsed.origin);

    // The loopback twin, so a suite pointed at one spelling still ingests from
    // a page a developer opened at the other.
    for (const host of loopbackTwins(parsed.hostname)) {
      origins.add(`${parsed.protocol}//${host}${parsed.portSuffix}`);
    }
  }

  for (const candidate of (extra ?? "").split(",")) {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) continue;

    const extraOrigin = parseOrigin(trimmed);
    if (extraOrigin !== undefined) origins.add(extraOrigin.origin);
  }

  return [...origins];
}

/** The pieces of a URL the origin list is rebuilt from. */
interface ParsedOrigin {
  origin: string;
  protocol: string;
  hostname: string;
  /** `":3000"`, or `""` when the URL uses the scheme's default port. */
  portSuffix: string;
}

function parseOrigin(value: string): ParsedOrigin | undefined {
  try {
    const url = new URL(value);
    return {
      origin: url.origin,
      protocol: url.protocol,
      hostname: url.hostname,
      portSuffix: url.port.length > 0 ? `:${url.port}` : "",
    };
  } catch {
    return undefined;
  }
}

/** The other spellings of the same loopback host. */
function loopbackTwins(hostname: string): readonly string[] {
  if (hostname === "127.0.0.1") return ["localhost"];
  if (hostname === "localhost") return ["127.0.0.1"];

  return [];
}

/** A variable's value with surrounding space removed, or `undefined` when it
 * was unset or blank. Blank is treated as unset throughout: an empty variable
 * is what a mis-set pipeline leaves behind, never a deliberate choice. */
function setValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
