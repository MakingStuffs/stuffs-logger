/**
 * The environment this app reads, resolved once and typed, so no module has to
 * reach for `process.env` and guess.
 */

/** Display name, for page titles and the app chrome. */
const APP_DISPLAY_NAME = "Stuffs Logger" as const;

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * The environment variables that switch authentication off.
 *
 * Answered HERE rather than inside `lib/auth/` for one reason: this module
 * sits on the PROXY's import graph — `src/proxy.ts` imports
 * `lib/security/csp.ts`, which imports this file — and Next compiles the proxy
 * into its own entry that runs ahead of every document request. Pulling Better
 * Auth and the Prisma client into that bundle to answer a two-variable
 * question is not a trade worth making, and it gets worse, not better, if the
 * proxy is ever moved to the Edge runtime with `export const runtime = "edge"`.
 *
 * `NEXT_PUBLIC_SKIP_AUTH` is accepted alongside the plain name because Next
 * only inlines `NEXT_PUBLIC_*` into client bundles. Both are lowercased and
 * compared to `"true"`, and the test alongside this file pins that.
 */
const SKIP_AUTH_VARIABLES = ["SKIP_AUTH", "NEXT_PUBLIC_SKIP_AUTH"] as const;

/** A subset of `process.env`, so the guard below is testable without one. */
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

assertAuthNotSkippedInProduction(process.env);

export { APP_DISPLAY_NAME, IS_PROD };
