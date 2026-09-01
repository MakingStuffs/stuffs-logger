import type { NextConfig } from "next";

/**
 * Extra origins Server Actions may be invoked from.
 *
 * Next validates a Server Action's request `Origin` against the `Host` header;
 * anything added here widens that check, and every action in this app is
 * internal-only — `revokeIngestKeyAction` included.
 *
 * THE PORTAL ORIGIN IS DELIBERATELY ABSENT. It was here for salient-ui's
 * sign-out, but that action is defined inline in this app's own `AppShell` and
 * is therefore posted from a page served on THIS origin; the portal never
 * renders it. This app has also exited the portal proxy, so no page of ours is
 * ever served under the portal's origin. Trusting it would let any page on the
 * portal origin POST this app's actions with the viewer's cookies, for a
 * capability nothing uses.
 *
 * The development entries stay: `next dev` is reached at both hostnames.
 */
const allowedOrigins: string[] =
  process.env.NODE_ENV === "production"
    ? []
    : ["localhost:3000", "lvh.me:3000"];

/**
 * Headers applied to every response.
 *
 * `frame-ancestors 'none'` is the important one: the dashboard renders log
 * lines containing whatever a customer application logged, behind a session
 * that grants access to every application's logs. Framed and overlaid, a
 * colleague's own click could be borrowed. `nosniff` stops a log payload that
 * happens to look like HTML being re-interpreted as such, and the
 * `Referrer-Policy` keeps filter terms — which can contain user identifiers —
 * out of the `Referer` sent to any URL a log line links to.
 *
 * The nonce-based `script-src` policy is NOT here, because a nonce is
 * per-response and this list is static: `middleware.ts` ships it as
 * `Content-Security-Policy-Report-Only`, and `lib/security/csp.ts` documents
 * how it gets promoted to enforcing. `frame-ancestors` stays here, enforced,
 * because a report-only header does not stop framing and this app must never
 * be framed.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

/**
 * HSTS, production only. Setting it in development would pin `localhost` to
 * HTTPS in the developer's browser for a year.
 */
const HSTS_HEADER = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains; preload",
};

const nextConfig: NextConfig = {
  // The server version is a free hint to an attacker enumerating known Next
  // vulnerabilities, and nothing depends on it.
  poweredByHeader: false,

  experimental: {
    serverActions: { allowedOrigins },
  },

  async headers() {
    const headers =
      process.env.NODE_ENV === "production"
        ? [...SECURITY_HEADERS, HSTS_HEADER]
        : SECURITY_HEADERS;

    return [
      {
        // Everything EXCEPT the ingest endpoint, which is a cross-origin API
        // for browsers on other sites: frame-ancestors and the rest are
        // meaningless there, and its own CORS headers are set per key by the
        // route handler.
        source: "/((?!api/v1/ingest).*)",
        headers,
      },
      {
        source: "/api/v1/ingest",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
    ];
  },
};

export default nextConfig;
