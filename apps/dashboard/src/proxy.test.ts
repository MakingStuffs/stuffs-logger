import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { CSP_REQUEST_HEADER } from "@/lib/security/csp";

import { config, proxy } from "./proxy";

/**
 * The proxy is the only thing this app runs ahead of every document request,
 * so the properties pinned here are the ones a regression would quietly cost:
 * WHAT it runs on (never `/api/*`), what it deliberately does NOT do (auth),
 * and where the nonce comes from (here, never the caller).
 *
 * The policy itself is covered by `lib/security/csp.test.ts`.
 */

/**
 * The declared matcher, as a regex.
 *
 * Next wraps this same source in optional `_next/data` and `.rsc` suffix groups
 * before matching a pathname against it; the negative lookahead that decides
 * which paths are in scope is the part that lives in this repo, so it is the
 * part tested here.
 */
const matcher = (() => {
  const [source] = config.matcher;
  if (source === undefined) throw new Error("the proxy declares no matcher");

  return new RegExp(`^${source}$`);
})();

function requestFor(
  pathname: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`https://logger.example.test${pathname}`, { headers });
}

/** The nonce the policy was built around. */
function nonceOf(policy: string): string {
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  if (nonce === undefined) throw new Error(`no nonce in policy: ${policy}`);

  return nonce;
}

/** The `content-security-policy` Next will see on the forwarded request. */
function forwardedPolicy(response: Response): string | null {
  return response.headers.get(`x-middleware-request-${CSP_REQUEST_HEADER}`);
}

describe("the proxy matcher", () => {
  it("excludes the ingest API, which must not pay for a proxy hop", () => {
    expect(matcher.test("/api/v1/ingest")).toBe(false);
  });

  it("excludes every other API route too", () => {
    expect(matcher.test("/api")).toBe(false);
    expect(matcher.test("/api/cron/retention")).toBe(false);
  });

  it("covers the dashboard's document routes", () => {
    expect(matcher.test("/")).toBe(true);
    expect(matcher.test("/logs")).toBe(true);
    expect(matcher.test("/logs/evt-1")).toBe(true);
    expect(matcher.test("/apps")).toBe(true);
  });

  it("excludes the build output and the favicon", () => {
    expect(matcher.test("/_next/static/chunk.js")).toBe(false);
    expect(matcher.test("/_next/image")).toBe(false);
    expect(matcher.test("/favicon.ico")).toBe(false);
  });
});

describe("proxy", () => {
  it("lets an anonymous request through instead of gating it", () => {
    const response = proxy(requestFor("/logs"));

    // Pages and queries gate themselves; a proxy that redirected here would
    // become a boundary that anything reaching a page directly routes around.
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("overwrites a caller's content-security-policy header", () => {
    const response = proxy(
      requestFor("/logs", {
        [CSP_REQUEST_HEADER]: "script-src 'nonce-attacker-chosen'",
      }),
    );

    const forwarded = forwardedPolicy(response);
    expect(forwarded).not.toBeNull();
    expect(forwarded).not.toContain("attacker-chosen");
    expect(nonceOf(forwarded ?? "")).not.toBe("attacker-chosen");
  });

  it("mints a different nonce for every request", () => {
    const first = forwardedPolicy(proxy(requestFor("/logs")));
    const second = forwardedPolicy(proxy(requestFor("/logs")));

    expect(nonceOf(first ?? "")).not.toBe(nonceOf(second ?? ""));
  });
});
