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

/**
 * Where an unauthenticated visitor is sent. A static, developer-written
 * constant: never derived from request input, or the redirect becomes an open
 * one.
 */
const SIGN_IN_URL = `${PORTAL_URL ?? ""}/login`;

const IS_PROD = process.env.NODE_ENV === "production";

export { APP_SLUG, APP_DISPLAY_NAME, PORTAL_URL, SIGN_IN_URL, IS_PROD };
