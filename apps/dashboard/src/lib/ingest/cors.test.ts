import { describe, expect, it } from "vitest";

import { corsHeaders, isOriginAllowed, VARY_ORIGIN } from "./cors";

const ORIGIN = "https://app.example.test";

describe("corsHeaders", () => {
  it("echoes only the exact matched origin", () => {
    const headers = corsHeaders(ORIGIN);

    expect(headers["access-control-allow-origin"]).toBe(ORIGIN);
  });

  it("never answers with a wildcard", () => {
    expect(corsHeaders(ORIGIN)["access-control-allow-origin"]).not.toBe("*");
  });

  it("always sets Vary: Origin", () => {
    expect(corsHeaders(ORIGIN).vary).toBe("Origin");
    expect(corsHeaders(null).vary).toBe("Origin");
  });

  it("grants nothing when no origin matched", () => {
    expect(corsHeaders(null)).toEqual(VARY_ORIGIN);
    expect(corsHeaders(null)["access-control-allow-origin"]).toBeUndefined();
  });

  it("advertises only the methods and headers the SDK needs", () => {
    const headers = corsHeaders(ORIGIN);

    expect(headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
    expect(headers["access-control-allow-headers"]).toContain("x-jf-key");
  });

  it("never grants credentials", () => {
    expect(
      corsHeaders(ORIGIN)["access-control-allow-credentials"],
    ).toBeUndefined();
  });
});

describe("isOriginAllowed", () => {
  const allowed = [ORIGIN, "https://other.example.test"];

  it("accepts an exact match", () => {
    expect(isOriginAllowed(ORIGIN, allowed)).toBe(true);
  });

  it("refuses a missing origin", () => {
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });

  it("refuses an empty allowlist", () => {
    expect(isOriginAllowed(ORIGIN, [])).toBe(false);
  });

  it.each([
    ["a suffix attack", "https://app.example.test.evil.test"],
    ["a prefix attack", "https://evil-app.example.test"],
    ["a scheme downgrade", "http://app.example.test"],
    ["an added port", "https://app.example.test:8443"],
    ["a trailing slash", "https://app.example.test/"],
    ["a case change", "https://APP.example.test"],
    ["a subdomain", "https://sub.app.example.test"],
  ])("refuses %s", (_label, origin) => {
    expect(isOriginAllowed(origin, allowed)).toBe(false);
  });

  it("refuses the null origin string sent by sandboxed frames", () => {
    expect(isOriginAllowed("null", allowed)).toBe(false);
  });
});
