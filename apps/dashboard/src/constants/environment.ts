/**
 * The environment this app reads, resolved once and typed, so no module has to
 * reach for `process.env` and guess.
 */

/**
 * This app's slug in the Salient application catalog. Every session gate and
 * the cron endpoint's API-token binding are scoped to it.
 */
const APP_SLUG = "jf-logger" as const;

/** Display name, for page titles and the app chrome. */
const APP_DISPLAY_NAME = "JF Logger" as const;

/**
 * The portal origin.
 *
 * salient-auth v6 reads `BETTER_AUTH_URL` directly for every call to
 * `${portal}/api/auth/*`, and it is where unauthenticated visitors are sent to
 * sign in. This app is served on its OWN SUBDOMAIN — it has exited the portal
 * proxy — so there is no basePath and no proxy path to derive.
 */
const PORTAL_URL = process.env.BETTER_AUTH_URL?.replace(/\/$/, "");

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * The environment variables that switch authentication off.
 *
 * Read here rather than imported from `isAuthSkipped()` for one reason: this
 * module is imported by `next.config.ts`, which is loaded by the Next CLI
 * before any application code exists, and pulling the auth package (and with
 * it Better Auth and the auth Prisma client) into that graph to answer a
 * two-variable question is not a trade worth making. The semantics are copied
 * from the installed package verbatim — both names, lowercased, compared to
 * `"true"` — and the test alongside this file pins them.
 */
const SKIP_AUTH_VARIABLES = ["SKIP_AUTH", "NEXT_PUBLIC_SKIP_AUTH"] as const;

/** A subset of `process.env`, so the guard below is testable without one. */
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/**
 * Whether auth is skipped, matching `isAuthSkipped()` in salient-auth v6.
 *
 * @param env - The environment to read.
 * @returns Whether `getSession` would return the mock internal-admin session.
 */
export function isAuthSkippedIn(env: EnvironmentSource): boolean {
  return SKIP_AUTH_VARIABLES.some(
    (name) => env[name]?.toLowerCase() === "true",
  );
}

/**
 * Refuses to boot a production deployment with authentication switched off.
 *
 * `isAuthSkipped()` in the installed package has NO environment guard of its
 * own: with `SKIP_AUTH=true` set anywhere, `getSession` returns
 * `MOCK_SERVER_SESSION` — an active `INTERNAL_ADMIN` — to every visitor. On a
 * deployment that means an unauthenticated dashboard exposing every
 * application's logs, and a mock administrator who can mint and revoke ingest
 * keys. One copied env file is all it takes, so the failure mode is made loud
 * and immediate: the process does not start.
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

assertAuthNotSkippedInProduction(process.env);

export { APP_SLUG, APP_DISPLAY_NAME, PORTAL_URL, IS_PROD };
