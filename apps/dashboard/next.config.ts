import type { NextConfig } from "next";

/**
 * Extra origins Server Actions may be invoked from.
 *
 * Next validates a Server Action's request `Origin` against the `Host` header;
 * anything added here widens that check, and every action in this app is
 * internal-only — `revokeIngestKeyAction` included.
 *
 * THE PORTAL ORIGIN IS DELIBERATELY ABSENT. It was here for the former design system's
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
 * The `Permissions-Policy` names `browsing-topics`, the feature that replaced
 * FLoC's `interest-cohort`; the old name is no longer a feature any browser
 * recognises, so declaring it declared nothing.
 *
 * The nonce-based `script-src` policy is NOT here, because a nonce is
 * per-response and this list is static: `src/proxy.ts` ships it as
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
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

/**
 * HSTS, production only. Setting it in development would pin `localhost` to
 * HTTPS in the developer's browser for a year.
 *
 * NO `preload` DIRECTIVE. `preload` is not a browser instruction: it is the
 * marker the HSTS preload list requires before it accepts a domain, and an
 * opt-in commitment that the domain and EVERY subdomain will serve HTTPS for
 * good — hard to undo once the list ships it. That is a decision for the
 * operator who registers their domain, not a default this app can make on
 * their behalf; an operator who has submitted theirs appends it here.
 */
const HSTS_HEADER = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains",
};

const nextConfig: NextConfig = {
  // The server version is a free hint to an attacker enumerating known Next
  // vulnerabilities, and nothing depends on it.
  poweredByHeader: false,

  /**
   * A self-contained server for plain-Node hosts.
   *
   * `next start` needs the whole `node_modules` tree beside it — in this
   * workspace, hundreds of megabytes of build tooling and test runners that
   * a running dashboard never loads. Standalone output traces what each route
   * actually imports and copies only that, with its own `server.js`, into
   * `.next/standalone/`. The workspace root is detected automatically (the
   * lockfile marks it), so the tree inside mirrors the monorepo and the
   * server lives at `.next/standalone/apps/dashboard/server.js`; the Prisma
   * query engine is traced in with the client that loads it. Vercel ignores
   * the setting, and `next start` still runs for the e2e suite — with a
   * warning that the standalone server is the one to deploy. `docs/DEPLOYMENT.md`
   * has the run command.
   */
  output: "standalone",

  experimental: {
    serverActions: { allowedOrigins },
  },

  async headers() {
    const isProduction = process.env.NODE_ENV === "production";
    const documentHeaders = isProduction
      ? [...SECURITY_HEADERS, HSTS_HEADER]
      : SECURITY_HEADERS;

    return [
      {
        // Everything EXCEPT the ingest endpoint, which is a cross-origin API
        // for browsers on other sites: frame-ancestors and the rest are
        // meaningless there, and its own CORS headers are set per key by the
        // route handler.
        source: "/((?!api/v1/ingest).*)",
        headers: documentHeaders,
      },
      {
        // The ingest endpoint keeps `nosniff` and, in production, HSTS: an
        // SDK that was once told to use HTTPS for this host must keep being
        // told, and a response that omits the header on this path is a gap in
        // the pin the documents set.
        source: "/api/v1/ingest",
        headers: isProduction
          ? [{ key: "X-Content-Type-Options", value: "nosniff" }, HSTS_HEADER]
          : [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
    ];
  },
};

export default nextConfig;
