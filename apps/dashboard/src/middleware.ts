import { NextResponse, type NextRequest } from "next/server";

import {
  buildContentSecurityPolicy,
  createCspNonce,
  CSP_REPORT_ONLY_HEADER,
  CSP_REQUEST_HEADER,
} from "@/lib/security/csp";

/**
 * Per-request CSP nonce plumbing. NOT an auth boundary.
 *
 * This middleware does exactly one thing: mint a nonce, hand it to Next on the
 * request so the framework stamps it onto its own scripts, and attach the
 * report-only policy to the response. Authentication is not, and must not be,
 * done here — every page gates itself with `getSessionOrRedirect` and every
 * data-access function re-checks the session, because middleware is skippable
 * and a check that only lives here is a check that can be routed around.
 *
 * The matcher excludes `/api/*`: the ingest endpoint is a cross-origin API for
 * other sites' browsers, a script policy means nothing to it, and it must not
 * pay for a middleware hop on the hottest path in the product.
 */
export function middleware(request: NextRequest): NextResponse {
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
};
