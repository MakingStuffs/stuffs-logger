import { describe, expect, it } from "vitest";

import { corsHeaders, VARY_ORIGIN } from "./cors";

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
