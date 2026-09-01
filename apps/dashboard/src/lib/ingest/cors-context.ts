import type { ExtraHeaders } from "@/lib/api/responses";

import { VARY_ORIGIN } from "./cors";

/**
 * Per-request CORS headers, so a REFUSAL raised deep in the handler still
 * carries them.
 *
 * Without this, a 429 or a 400 raised after the key verified would reach the
 * browser with no `Access-Control-Allow-Origin`, and the SDK would see an
 * opaque network error instead of the status the server actually sent —
 * turning every rate limit into "the logging endpoint is down".
 *
 * A `WeakMap` keyed on the `Request` rather than a module-level variable: two
 * requests are handled concurrently in the same instance, and a shared
 * variable would let one request's allowed origin be echoed to another's.
 */
const headersByRequest = new WeakMap<Request, ExtraHeaders>();

/** Records the CORS headers to attach to any later failure for this request. */
export function rememberCorsHeaders(
  request: Request,
  headers: ExtraHeaders,
): void {
  headersByRequest.set(request, headers);
}

/**
 * The CORS headers resolved for this request so far.
 *
 * Falls back to `Vary: Origin` alone — the correct answer before a key has
 * verified, when no origin has been granted anything.
 */
export function recallCorsHeaders(request: Request): ExtraHeaders {
  return headersByRequest.get(request) ?? VARY_ORIGIN;
}
