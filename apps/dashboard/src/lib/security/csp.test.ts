import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, createCspNonce } from "./csp";

function directive(policy: string, name: string): string {
  const found = policy
    .split("; ")
    .find((entry) => entry.startsWith(`${name} `));

  return found ?? "";
}

describe("createCspNonce", () => {
  it("produces a different nonce every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, createCspNonce));

    expect(nonces.size).toBe(50);
  });

  it("produces at least 128 bits of randomness", () => {
    expect(atob(createCspNonce())).toHaveLength(16);
  });
});

describe("buildContentSecurityPolicy", () => {
  it("carries the nonce in script-src", () => {
    const policy = buildContentSecurityPolicy("abc123");

    expect(directive(policy, "script-src")).toContain("'nonce-abc123'");
  });

  it("never allows unsafe-inline scripts", () => {
    const policy = buildContentSecurityPolicy("abc123");

    expect(directive(policy, "script-src")).not.toContain("'unsafe-inline'");
    expect(directive(policy, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("keeps the app out of frames", () => {
    const policy = buildContentSecurityPolicy("abc123");

    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("pins base-uri and object-src shut", () => {
    const policy = buildContentSecurityPolicy("abc123");

    expect(directive(policy, "base-uri")).toBe("base-uri 'none'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
  });

  it("keeps every fetch and form target on this origin", () => {
    const policy = buildContentSecurityPolicy("abc123");

    // The app hosts its own auth, so there is no second origin to allow.
    expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
    expect(policy).not.toContain("  ");
  });

  it("does not restrict a wildcard script host", () => {
    const policy = buildContentSecurityPolicy("abc123");

    expect(directive(policy, "script-src")).not.toContain("*");
  });
});
