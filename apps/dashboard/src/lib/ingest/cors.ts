import { INGEST_KEY_HEADER } from "@jf-logger/core";

import type { ExtraHeaders } from "@/lib/api/responses";

/**
 * CORS for the ingest endpoint.
 *
 * The allowlist is per key, not global, so the headers can only be built once
 * a key has been verified — which is exactly the point: an unverified caller
 * gets `Vary: Origin` and nothing else, and their browser reports a CORS
 * failure rather than being told which origins would have worked.
 */

/** Methods the ingest endpoint accepts. */
const ALLOWED_METHODS = "POST, OPTIONS";

/** Request headers the SDK is permitted to send. */
const ALLOWED_HEADERS = `content-type, ${INGEST_KEY_HEADER}`;

/** How long a browser may cache the preflight result, in seconds. */
const PREFLIGHT_MAX_AGE_SECONDS = 3600;

/**
 * `Vary: Origin` on EVERY response, allowed or refused.
 *
 * Without it a shared cache can serve one origin's `Access-Control-Allow-Origin`
 * to another, which either breaks a legitimate caller or hands an unlisted one
 * a permission it was never granted.
 */
export const VARY_ORIGIN: ExtraHeaders = { vary: "Origin" };

/**
 * The CORS headers for a request whose key verified against `matchedOrigin`.
 *
 * Echoes the EXACT origin that matched the key's allowlist — never `*`, and
 * never the raw request origin unless it was the one that matched. A wildcard
 * here would let any page on the internet POST with a public key it scraped
 * from a bundle.
 *
 * @param matchedOrigin - The allowlist entry this request matched, or `null`
 *   for a secret key (no browser involved, so nothing to grant).
 * @returns The headers to merge into the response.
 */
export function corsHeaders(matchedOrigin: string | null): ExtraHeaders {
  if (matchedOrigin === null) return VARY_ORIGIN;

  return {
    ...VARY_ORIGIN,
    "access-control-allow-origin": matchedOrigin,
    "access-control-allow-methods": ALLOWED_METHODS,
    "access-control-allow-headers": ALLOWED_HEADERS,
    "access-control-max-age": String(PREFLIGHT_MAX_AGE_SECONDS),
  };
}
