import { describe, expect, it } from "vitest";

import {
  proxyTrustWarning,
  resolveClientIp,
  trustedProxyHops,
} from "./client-ip";

function forwardedFor(value: string): Headers {
  return new Headers({ "x-forwarded-for": value });
}

describe("trustedProxyHops", () => {
  it("trusts no proxy unless told to", () => {
    expect(trustedProxyHops({})).toBe(0);
  });

  it("reads an explicit hop count", () => {
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "2" })).toBe(2);
  });

  it("lets an explicit zero switch trust off, even on Vercel", () => {
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "0", VERCEL: "1" })).toBe(0);
  });

  it("trusts one hop on Vercel, which overwrites the header itself", () => {
    expect(trustedProxyHops({ VERCEL: "1" })).toBe(1);
  });

  it.each(["-1", "1.5", "two", "", "11"])(
    "ignores the malformed or implausible value %j",
    (raw) => {
      expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: raw })).toBe(0);
    },
  );
});

describe("resolveClientIp", () => {
  it("knows no address when no proxy is trusted, whatever the header says", () => {
    expect(resolveClientIp(forwardedFor("203.0.113.9"), 0)).toBeNull();
  });

  it("takes the entry the trusted proxy appended, not the client's own", () => {
    // The client forged the first entry; the proxy appended the real one.
    expect(resolveClientIp(forwardedFor("6.6.6.6, 203.0.113.9"), 1)).toBe(
      "203.0.113.9",
    );
  });

  it("counts hops from the right through a chain of trusted proxies", () => {
    expect(
      resolveClientIp(forwardedFor("6.6.6.6, 203.0.113.9, 10.0.0.2"), 2),
    ).toBe("203.0.113.9");
  });

  it("refuses a chain shorter than the proxies it should have passed", () => {
    expect(resolveClientIp(forwardedFor("203.0.113.9"), 2)).toBeNull();
  });

  it("has no address when the header is absent", () => {
    expect(resolveClientIp(new Headers(), 1)).toBeNull();
  });

  it("ignores x-real-ip, whose position in a chain nothing records", () => {
    expect(
      resolveClientIp(new Headers({ "x-real-ip": "203.0.113.9" }), 1),
    ).toBeNull();
  });

  it("normalises case, so one IPv6 address is one key", () => {
    expect(resolveClientIp(forwardedFor("2001:DB8::1"), 1)).toBe("2001:db8::1");
  });

  it.each(["", "   ", "not an address!", "a".repeat(65), "<script>"])(
    "refuses to key on %j",
    (entry) => {
      expect(resolveClientIp(forwardedFor(`6.6.6.6,${entry}`), 1)).toBeNull();
    },
  );
});

describe("proxyTrustWarning", () => {
  it("warns a production server that trusts no proxy", () => {
    expect(proxyTrustWarning({ NODE_ENV: "production" })).toMatch(
      /TRUSTED_PROXY_HOPS is not set/,
    );
  });

  it("is quiet once a proxy is trusted", () => {
    expect(
      proxyTrustWarning({ NODE_ENV: "production", TRUSTED_PROXY_HOPS: "1" }),
    ).toBeNull();
  });

  it("is quiet on Vercel, which is trusted by default", () => {
    expect(
      proxyTrustWarning({ NODE_ENV: "production", VERCEL: "1" }),
    ).toBeNull();
  });

  it("is quiet outside production", () => {
    expect(proxyTrustWarning({ NODE_ENV: "development" })).toBeNull();
  });
});
