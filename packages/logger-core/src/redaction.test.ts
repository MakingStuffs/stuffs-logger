import { describe, expect, it } from "vitest";

import {
  createKeyRedactor,
  DEFAULT_REDACTION_REPLACEMENT,
  normaliseRedactionKey,
  redactJson,
} from "./redaction";
import type { JsonValue } from "./json";

describe("normaliseRedactionKey", () => {
  it.each([
    ["API_KEY", "apikey"],
    ["api-key", "apikey"],
    ["apiKey", "apikey"],
    ["x-api-key", "xapikey"],
    ["Authorization", "authorization"],
  ])("reduces %s to %s", (input, expected) => {
    expect(normaliseRedactionKey(input)).toBe(expected);
  });

  it("leaves nothing but letters and digits", () => {
    expect(normaliseRedactionKey("a.b_c d!")).toBe("abcd");
  });
});

describe("createKeyRedactor", () => {
  const redactor = createKeyRedactor();

  it.each([
    "password",
    "PASSWORD",
    "userPassword",
    "x-api-key",
    "API_KEY",
    "Authorization",
    "sessionId",
    "refresh_token",
    "creditCardNumber",
  ])("matches the secret-shaped key %s", (key) => {
    expect(redactor.shouldRedact(key)).toBe(true);
  });

  it.each(["userId", "durationMs", "route", "statusCode", "count"])(
    "leaves the ordinary key %s alone",
    (key) => {
      expect(redactor.shouldRedact(key)).toBe(false);
    },
  );

  it("uses the shared replacement by default", () => {
    expect(redactor.replacement).toBe(DEFAULT_REDACTION_REPLACEMENT);
  });

  it("accepts a regular expression pattern", () => {
    const custom = createKeyRedactor({ keys: [/^internal_/] });

    expect(custom.shouldRedact("internal_value")).toBe(true);
    expect(custom.shouldRedact("password")).toBe(false);
  });

  it("keeps the built-in list when extending it", () => {
    const custom = createKeyRedactor({ additionalKeys: ["postcode"] });

    expect(custom.shouldRedact("postcode")).toBe(true);
    expect(custom.shouldRedact("password")).toBe(true);
  });

  it("replaces the built-in list when keys are supplied outright", () => {
    const custom = createKeyRedactor({ keys: ["postcode"] });

    expect(custom.shouldRedact("password")).toBe(false);
  });
});

describe("redactJson", () => {
  it("replaces a secret-shaped value at the top level", () => {
    expect(redactJson({ apiKey: "live-secret", userId: "u1" })).toEqual({
      apiKey: DEFAULT_REDACTION_REPLACEMENT,
      userId: "u1",
    });
  });

  it("replaces a secret-shaped value nested in an object", () => {
    const redacted = redactJson({
      request: { headers: { authorization: "Bearer abc" }, path: "/x" },
    });

    expect(redacted).toEqual({
      request: {
        headers: { authorization: DEFAULT_REDACTION_REPLACEMENT },
        path: "/x",
      },
    });
  });

  it("replaces a secret-shaped value nested inside an array", () => {
    const redacted = redactJson({ items: [{ token: "abc" }, { id: "1" }] });

    expect(redacted).toEqual({
      items: [{ token: DEFAULT_REDACTION_REPLACEMENT }, { id: "1" }],
    });
  });

  it("keeps the key so the shape of the context survives", () => {
    const redacted = redactJson({ password: "hunter2" });

    expect(Object.keys(redacted as object)).toEqual(["password"]);
  });

  it("keeps a literal __proto__ key rather than losing it", () => {
    // JSON.parse is how such a key reaches the server: it creates an own
    // property, where plain assignment would run the prototype setter and
    // drop the entry on the way back out.
    const input = JSON.parse(
      '{"__proto__":{"token":"abc"},"id":"1"}',
    ) as JsonValue;

    const redacted = redactJson(input);

    expect(Object.keys(redacted as object)).toEqual(["__proto__", "id"]);
    expect((redacted as Record<string, unknown>)["__proto__"]).toEqual({
      token: DEFAULT_REDACTION_REPLACEMENT,
    });
    expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
  });

  it("leaves Object.prototype alone when redacting a __proto__ key", () => {
    redactJson(JSON.parse('{"__proto__":{"polluted":true}}') as JsonValue);

    expect("polluted" in {}).toBe(false);
  });

  it("does not mutate the input", () => {
    const input = { apiKey: "live-secret" };

    redactJson(input);

    expect(input.apiKey).toBe("live-secret");
  });

  it("leaves a value with no secret-shaped key untouched", () => {
    const input = { userId: "u1", nested: { count: 2, tags: ["a", "b"] } };

    expect(redactJson(input)).toEqual(input);
  });

  it("replaces a subtree nested deeper than the walk descends", () => {
    // Eleven levels: past MAX_CONTEXT_DEPTH, so the wire schema would have
    // rejected it. Fail closed rather than walk an unbounded structure.
    let deep: Record<string, unknown> = { password: "hunter2" };
    for (let level = 0; level < 11; level += 1) deep = { nested: deep };

    expect(JSON.stringify(redactJson(deep as never))).not.toContain("hunter2");
  });

  it("honours a custom redactor", () => {
    const custom = createKeyRedactor({
      keys: ["postcode"],
      replacement: "[hidden]",
    });

    expect(
      redactJson({ postcode: "LS1", password: "hunter2" }, custom),
    ).toEqual({ postcode: "[hidden]", password: "hunter2" });
  });

  it("passes scalars through unchanged", () => {
    expect(redactJson("plain")).toBe("plain");
    expect(redactJson(7)).toBe(7);
    expect(redactJson(null)).toBeNull();
  });
});
