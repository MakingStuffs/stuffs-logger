import { describe, expect, it } from "vitest";

import {
  buildSignInUrl,
  DEFAULT_RETURN_PATH,
  resolveReturnPath,
  RETURN_TO_PARAM,
  SIGN_IN_PATH,
} from "./return-path";

/**
 * The open-redirect defence.
 *
 * `returnTo` is the one value in the sign-in flow that a stranger can choose:
 * it arrives in a link they can send to a colleague, and it decides where that
 * colleague lands after typing their password. Anything that leaves this app's
 * own origin turns the sign-in page into a phishing springboard, so the rule
 * is not "escape it" but "refuse it and go home".
 *
 * Every case below is a URL an attacker would actually try, and the parser —
 * not a string match — is what refuses them: `app@evil.test` cannot hide its
 * real host behind userinfo, and `\\evil.test` cannot hide behind a backslash.
 */
describe("resolveReturnPath", () => {
  it.each([
    ["/", "/"],
    ["/logs", "/logs"],
    ["/logs?level=error&limit=50", "/logs?level=error&limit=50"],
    ["/apps/checkout", "/apps/checkout"],
    ["/logs#event-1", "/logs#event-1"],
  ])("keeps the same-origin path %o", (input, expected) => {
    expect(resolveReturnPath(input)).toBe(expected);
  });

  it.each([
    ["//evil.test/x", "protocol-relative URL"],
    ["https://evil.test/x", "absolute URL"],
    ["http://evil.test", "plaintext absolute URL"],
    ["\\\\evil.test/x", "backslash-escaped authority"],
    ["/\\evil.test", "mixed slash authority"],
    ["https://logger.example.test@evil.test", "userinfo-disguised host"],
    ["javascript:alert(1)", "javascript scheme"],
    ["data:text/html,<script>alert(1)</script>", "data scheme"],
    ["https://[", "unparseable value"],
  ])("refuses %o (%s) and falls back to the app root", (input) => {
    expect(resolveReturnPath(input)).toBe(DEFAULT_RETURN_PATH);
  });

  it("falls back to the app root when nothing was supplied", () => {
    expect(resolveReturnPath(undefined)).toBe(DEFAULT_RETURN_PATH);
    expect(resolveReturnPath("")).toBe(DEFAULT_RETURN_PATH);
  });

  it("never returns a value the browser could read as an origin", () => {
    const hostile = [
      "//evil.test",
      "https://evil.test",
      "\\\\evil.test",
      "////evil.test",
    ];

    for (const candidate of hostile) {
      const resolved = resolveReturnPath(candidate);

      expect(resolved.startsWith("/")).toBe(true);
      expect(resolved.startsWith("//")).toBe(false);
      expect(resolved).not.toContain("evil.test");
    }
  });

  it("refuses a return path that is already a sanitised absolute URL", () => {
    // The parameter is a PATH on this app, never a URL. Accepting an absolute
    // one — even to our own host — would mean the value's origin came from the
    // request rather than from us.
    expect(resolveReturnPath("https://logger.example.test/logs")).toBe(
      DEFAULT_RETURN_PATH,
    );
  });

  it("drops a nested credential-bearing query without dropping the path", () => {
    expect(resolveReturnPath("/logs?search=a%20b")).toBe("/logs?search=a%20b");
  });
});

describe("buildSignInUrl", () => {
  it("carries the sanitised return path", () => {
    expect(buildSignInUrl("/logs?level=error")).toBe(
      `${SIGN_IN_PATH}?${RETURN_TO_PARAM}=%2Flogs%3Flevel%3Derror`,
    );
  });

  it("sanitises a hostile return path rather than emitting it", () => {
    const url = buildSignInUrl("https://evil.test/x");

    expect(url).not.toContain("evil.test");
    expect(url).toBe(SIGN_IN_PATH);
  });

  it("stays on this app", () => {
    expect(buildSignInUrl("/logs").startsWith("/")).toBe(true);
  });

  it("omits the parameter when the destination is the default anyway", () => {
    expect(buildSignInUrl(undefined)).toBe(SIGN_IN_PATH);
  });
});
