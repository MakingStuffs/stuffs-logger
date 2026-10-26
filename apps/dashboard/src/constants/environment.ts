/**
 * The environment this app reads, resolved once and typed, so no module has to
 * reach for `process.env` and guess.
 *
 * DEPENDENCY-FREE, ON PURPOSE. This module imports nothing, which is what lets
 * the proxy (`src/proxy.ts`) and the server-start hook
 * (`src/instrumentation.ts`) pull it in without dragging Better Auth and the
 * Prisma client into entries that run ahead of every request — and it gets
 * worse, not better, if the proxy is ever moved to the Edge runtime. An import
 * added here lands in those bundles too; keep it that way.
 */

/** Display name, for page titles and the app chrome. */
const APP_DISPLAY_NAME = "Stuffs Logger" as const;

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * The environment variables that switch authentication off.
 *
 * Answered HERE rather than inside `lib/auth/` for the reason in the module
 * note: the question is a two-variable one, and answering it from `lib/auth/`
 * would cost every importer the whole auth graph.
 *
 * `NEXT_PUBLIC_SKIP_AUTH` is accepted alongside the plain name because Next
 * only inlines `NEXT_PUBLIC_*` into client bundles. Both are lowercased and
 * compared to `"true"`, and the test alongside this file pins that.
 */
const SKIP_AUTH_VARIABLES = ["SKIP_AUTH", "NEXT_PUBLIC_SKIP_AUTH"] as const;

/**
 * The shortest `BETTER_AUTH_SECRET` a production deployment may run with.
 * `openssl rand -base64 32`, the documented generator, yields 44 characters;
 * anything under this is a secret somebody typed.
 */
export const MIN_BETTER_AUTH_SECRET_LENGTH = 32;

/**
 * Hosts on which a cleartext `BETTER_AUTH_URL` is tolerated in production.
 *
 * `next start` is a production build, and both a local run and the e2e harness
 * serve one over cleartext loopback. `[::1]` keeps its brackets because that
 * is how the URL parser reports an IPv6 host.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A subset of `process.env`, so the guards below are testable without one. */
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/**
 * Whether auth is skipped, for a given environment.
 *
 * @param env - The environment to read.
 * @returns Whether `getSession` would return the mock session.
 */
export function isAuthSkippedIn(env: EnvironmentSource): boolean {
  return SKIP_AUTH_VARIABLES.some(
    (name) => env[name]?.toLowerCase() === "true",
  );
}

/**
 * Whether auth is skipped in THIS process.
 *
 * The one reader of `process.env` for this question, so no module has to
 * remember which two variable names are involved.
 *
 * @returns Whether `getSession` returns the mock session.
 * @example
 * if (isAuthSkipped()) return { hasAccess: true, session: MOCK_SESSION };
 */
export function isAuthSkipped(): boolean {
  return isAuthSkippedIn(process.env);
}

/**
 * Refuses to boot a production deployment with authentication switched off.
 *
 * `isAuthSkipped()` has no environment guard of its own: with `SKIP_AUTH=true`
 * set anywhere, `getSession` returns {@link MOCK_SESSION} — an active ADMIN —
 * to every visitor. On a deployment that means an unauthenticated dashboard
 * exposing every application's logs, and a mock administrator who can mint and
 * revoke ingest keys. One copied env file is all it takes, so the failure mode
 * is made loud and immediate: the process does not start.
 *
 * @param env - The environment to check.
 * @throws {Error} When auth is skipped in a production build.
 */
export function assertAuthNotSkippedInProduction(env: EnvironmentSource): void {
  if (env.NODE_ENV !== "production") return;
  if (!isAuthSkippedIn(env)) return;

  throw new Error(
    "SKIP_AUTH / NEXT_PUBLIC_SKIP_AUTH must never be set in production: " +
      "it makes every visitor a mock internal admin. Remove both variables " +
      "from this deployment's environment.",
  );
}

/** Refuses a production auth URL that is not this app's own `https` origin. */
function assertProductionAuthUrl(value: string | undefined): void {
  if (value === undefined || value.length === 0) {
    throw new Error(
      "BETTER_AUTH_URL must be set in production to this app's own origin, " +
        "e.g. https://logger.example.com. Without it the auth base URL, the " +
        "trusted origins and the OAuth redirect URI are derived from each " +
        "request's Host header, which a caller chooses.",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `BETTER_AUTH_URL is not a URL: "${value}". Set it to this app's own ` +
        "origin, e.g. https://logger.example.com.",
    );
  }

  const isCleartextLoopback =
    url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
  if (url.protocol !== "https:" && !isCleartextLoopback) {
    throw new Error(
      `BETTER_AUTH_URL must be an https origin, not "${value}": the session ` +
        "cookie is Secure in production and will not be sent over cleartext.",
    );
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(
      "BETTER_AUTH_URL must not carry credentials: it is an origin, not a " +
        "connection string.",
    );
  }

  if (url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new Error(
      `BETTER_AUTH_URL must be an origin with no path, query or fragment, ` +
        `not "${value}". Every /api/auth/* URL is built by appending to it.`,
    );
  }
}

/** Refuses a production signing secret short enough to have been typed. */
function assertProductionAuthSecret(value: string | undefined): void {
  if (value !== undefined && value.length >= MIN_BETTER_AUTH_SECRET_LENGTH) {
    return;
  }

  // The value itself is never echoed: it is the thing a session is signed with.
  throw new Error(
    "BETTER_AUTH_SECRET must be set in production and be at least " +
      `${MIN_BETTER_AUTH_SECRET_LENGTH} characters. Generate one with: ` +
      "openssl rand -base64 32",
  );
}

/**
 * Refuses to SERVE a production deployment whose auth origin is implicit.
 *
 * With `BETTER_AUTH_URL` unset, Better Auth derives its base URL — and from it
 * the trusted origins the CSRF check accepts and the redirect URI it sends to
 * Google — from the request's own `Host` header, which a caller chooses. With
 * a short `BETTER_AUTH_SECRET`, the library refuses only its built-in default
 * and will happily sign sessions with a one-character key.
 *
 * NOT CALLED AT MODULE LOAD, unlike {@link assertAuthNotSkippedInProduction}.
 * `next build` imports every route module with `NODE_ENV=production` and no
 * runtime environment, so a load-time check here would fail every build. It
 * runs from `src/instrumentation.ts` instead, which Next calls once when the
 * server starts and never during a build.
 *
 * @param env - The environment to check.
 * @throws {Error} When a production server would start with an implicit auth
 *   origin or a weak secret.
 */
export function assertProductionAuthEnvironment(env: EnvironmentSource): void {
  if (env.NODE_ENV !== "production") return;

  assertProductionAuthUrl(env.BETTER_AUTH_URL);
  assertProductionAuthSecret(env.BETTER_AUTH_SECRET);
}

assertAuthNotSkippedInProduction(process.env);

export { APP_DISPLAY_NAME, IS_PROD };
