import { NextResponse, type NextRequest, type ProxyConfig } from "next/server";

import {
  buildContentSecurityPolicy,
  createCspNonce,
  CSP_REPORT_ONLY_HEADER,
  CSP_REQUEST_HEADER,
} from "@/lib/security/csp";

/**
 * Per-request CSP nonce plumbing. NOT an auth boundary.
 *
 * `proxy` is what Next 16 calls this file. The `middleware` convention is
 * deprecated in the installed version — `next/dist/lib/constants.js` carries
 * both `MIDDLEWARE_FILENAME` and `PROXY_FILENAME`, `next build` warns on the
 * former, and `next/dist/build/templates/middleware.js` loads the export named
 * `proxy` (or a default export) from a `proxy` file.
 *
 * This proxy does exactly one thing: mint a nonce, hand it to Next on the
 * request so the framework stamps it onto its own scripts, and attach the
 * report-only policy to the response. Authentication is not, and must not be,
 * done here — every page gates itself with `getSessionOrRedirect` and every
 * data-access function re-checks the session, because a proxy is skippable and
 * a check that only lives here is a check that can be routed around.
 *
 * The nonce is minted HERE and the request's `content-security-policy` header
 * is OVERWRITTEN with the policy built around it. That header is how Next
 * discovers the nonce, so forwarding a caller's own value would let them pick
 * the nonce every script on the page is then blessed with.
 *
 * The matcher excludes `/api/*`: the ingest endpoint is a cross-origin API for
 * other sites' browsers, a script policy means nothing to it, and it must not
 * pay for a proxy hop on the hottest path in the product.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = createCspNonce();
  const policy = buildContentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_REQUEST_HEADER, policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_REPORT_ONLY_HEADER, policy);

  return response;
}

export const config = {
  matcher: [
    /*
     * Every document route, and nothing else: API routes, the build output,
     * the image optimiser and the favicon have no scripts of ours to police.
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
} satisfies ProxyConfig;
