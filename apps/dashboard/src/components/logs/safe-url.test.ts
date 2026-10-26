import { describe, expect, it } from "vitest";

import { toSafeHttpUrl } from "./safe-url";

describe("toSafeHttpUrl", () => {
  it("accepts an https URL", () => {
    expect(toSafeHttpUrl("https://example.test/checkout")).toBe(
      "https://example.test/checkout",
    );
  });

  it("accepts an http URL", () => {
    expect(toSafeHttpUrl("http://example.test/")).toBe("http://example.test/");
  });

  it("refuses a javascript: URL", () => {
    expect(toSafeHttpUrl("javascript:alert(1)")).toBeNull();
  });

  it("refuses a javascript: URL whatever its casing", () => {
    expect(toSafeHttpUrl("JaVaScRiPt:alert(1)")).toBeNull();
  });

  it("refuses a javascript: URL padded with whitespace and newlines", () => {
    expect(toSafeHttpUrl("  java\nscript:alert(1)  ")).toBeNull();
  });

  it("refuses a data: URL", () => {
    expect(
      toSafeHttpUrl("data:text/html,<script>alert(1)</script>"),
    ).toBeNull();
  });

  it("refuses a vbscript: URL", () => {
    expect(toSafeHttpUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("refuses a protocol-relative URL, which has no scheme to check", () => {
    expect(toSafeHttpUrl("//evil.test/steal")).toBeNull();
  });

  it("refuses a URL whose userinfo disguises the real host", () => {
    // Rendered as link text this reads as a link to evil.test and goes to
    // victim.test — or the reverse, which is the trick.
    expect(toSafeHttpUrl("https://evil.test@victim.test/")).toBeNull();
  });

  it("refuses a URL carrying credentials", () => {
    expect(toSafeHttpUrl("https://user:secret@example.test/")).toBeNull();
  });

  it("refuses a relative path", () => {
    expect(toSafeHttpUrl("/logs")).toBeNull();
  });

  it("returns null for an absent URL", () => {
    expect(toSafeHttpUrl(null)).toBeNull();
    expect(toSafeHttpUrl(undefined)).toBeNull();
  });

  it("returns null for an empty or whitespace-only value", () => {
    expect(toSafeHttpUrl("")).toBeNull();
    expect(toSafeHttpUrl("   ")).toBeNull();
  });
});
