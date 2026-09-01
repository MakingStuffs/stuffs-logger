import type { NextConfig } from "next";

import { PORTAL_URL } from "./src/constants/environment";

/**
 * Server Actions validate the request `Origin` against the `Host` header. This
 * app is served on its OWN SUBDOMAIN — it has exited the portal proxy — so the
 * only extra origin it needs to trust is the portal's, for the sign-out action
 * rendered in the shared sidebar.
 */
const allowedOrigins: string[] =
  process.env.NODE_ENV === "production"
    ? []
    : ["localhost:3000", "lvh.me:3000"];

if (PORTAL_URL) allowedOrigins.push(PORTAL_URL.replace(/^https?:\/\//, ""));

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
 * A full `script-src` CSP is deliberately NOT set here: Next's inline bootstrap
 * and salient-ui's styles would both need accounting for, which is a change
 * with real breakage risk and belongs in its own piece of work rather than
 * riding along with the ingest API.
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
