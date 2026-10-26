import { describe, expect, it } from "vitest";

import { jsonDepth } from "@stuffs/logger-core/json";

import {
  jsonByteLength,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_DEPTH,
  MAX_MESSAGE_LENGTH,
} from "../contract";
import { createRedactor } from "./redact";
import {
  clampString,
  mergeContext,
  normalizeContext,
  serializeError,
  toMessage,
} from "./sanitize";

describe("clampString", () => {
  it("leaves a short string untouched", () => {
    expect(clampString("hello", 10)).toBe("hello");
  });

  it("marks a truncated string", () => {
    expect(clampString("abcdefghijklmnop", 15)).toBe("abcd[truncated]");
  });

  it("cannot exceed a maximum shorter than the marker", () => {
    expect(clampString("abcdefghij", 4)).toBe("abcd");
  });

  it("never exceeds the maximum length", () => {
    expect(clampString("x".repeat(100), 20).length).toBeLessThanOrEqual(20);
  });

  it("never ends in half a surrogate pair", () => {
    // The cut lands between the two code units of the first emoji. A naive
    // slice leaves a lone high surrogate, which `encodeURIComponent` refuses
    // the same way a UTF-8 encoder would.
    const value = `${"a".repeat(8180)}${"\u{1F600}".repeat(10)}`;
    expect(() => encodeURIComponent(value.slice(0, 8181))).toThrow();

    const clamped = clampString(value, MAX_MESSAGE_LENGTH);

    expect(clamped.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    expect(() => encodeURIComponent(clamped)).not.toThrow();
    expect(clamped.endsWith("[truncated]")).toBe(true);
  });
});

describe("toMessage", () => {
  it("passes a string through", () => {
    expect(toMessage("checkout failed")).toBe("checkout failed");
  });

  it("uses an error's message", () => {
    expect(toMessage(new Error("boom"))).toBe("boom");
  });

  it("serializes an object", () => {
    expect(toMessage({ a: 1 })).toBe('{"a":1}');
  });

  it("survives a circular object", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => toMessage(circular)).not.toThrow();
    expect(toMessage(circular).length).toBeGreaterThan(0);
  });

  it("never returns an empty message, because the contract forbids one", () => {
    expect(toMessage("")).toBe("(empty)");
    expect(toMessage("   ")).toBe("(empty)");
    expect(toMessage(undefined)).toBe("(empty)");
    expect(toMessage(null)).toBe("(empty)");
  });

  it("bounds the message at the contract's limit", () => {
    expect(toMessage("x".repeat(MAX_MESSAGE_LENGTH * 2)).length).toBe(
      MAX_MESSAGE_LENGTH,
    );
  });

  it("redacts secret-shaped keys of an object passed as the message", () => {
    const redactor = createRedactor(undefined);

    expect(toMessage({ user: "ada", password: "hunter2" }, redactor)).toBe(
      '{"user":"ada","password":"[redacted]"}',
    );
  });

  it("redacts inside a nested object passed as the message", () => {
    const redactor = createRedactor(undefined);

    const message = toMessage(
      { headers: { authorization: "Bearer x" } },
      redactor,
    );

    expect(message).toContain("[redacted]");
    expect(message).not.toContain("Bearer");
  });

  it("bounds the walk of a huge object to the message budget", () => {
    const wide: Record<string, string> = {};
    for (let index = 0; index < 5000; index += 1) {
      wide[`k${index}`] = "x".repeat(100);
    }

    const message = toMessage(wide);

    expect(message.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    expect(message).toContain("[truncated]");
  });
});

describe("serializeError", () => {
  it("extracts name, message and stack", () => {
    const error = new TypeError("bad input");

    expect(serializeError(error)).toMatchObject({
      name: "TypeError",
      message: "bad input",
    });
  });

  it("wraps a thrown non-error", () => {
    expect(serializeError("nope")).toEqual({
      name: "UnknownError",
      message: "nope",
    });
  });

  it("redacts a thrown plain object's secret-shaped keys", () => {
    const redactor = createRedactor(undefined);

    expect(serializeError({ token: "abc" }, redactor)).toEqual({
      name: "UnknownError",
      message: '{"token":"[redacted]"}',
    });
  });

  it("reports nothing when there was no error", () => {
    expect(serializeError(undefined)).toBeUndefined();
    expect(serializeError(null)).toBeUndefined();
  });
});

describe("normalizeContext", () => {
  it("keeps plain JSON values", () => {
    expect(
      normalizeContext({ a: 1, b: "two", c: true, d: [1, 2] }, undefined),
    ).toEqual({ a: 1, b: "two", c: true, d: [1, 2] });
  });

  it("redacts secret-shaped keys at any depth", () => {
    const redactor = createRedactor(undefined);

    expect(
      normalizeContext(
        { user: "ada", headers: { authorization: "Bearer x" } },
        redactor,
      ),
    ).toEqual({ user: "ada", headers: { authorization: "[redacted]" } });
  });

  it("replaces a circular reference instead of throwing", () => {
    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular;

    expect(normalizeContext(circular, undefined)).toEqual({
      name: "root",
      self: "[circular]",
    });
  });

  it("survives a throwing getter", () => {
    const hostile = {
      get boom(): string {
        throw new Error("nope");
      },
      safe: 1,
    };

    expect(() => normalizeContext(hostile, undefined)).not.toThrow();
    expect(normalizeContext(hostile, undefined)).toMatchObject({ safe: 1 });
  });

  it("truncates below the contract's depth limit", () => {
    let nested: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 20; index += 1) nested = { nested };

    const serialized = JSON.stringify(normalizeContext(nested, undefined));

    expect(serialized).toContain("[truncated]");
    expect(serialized).not.toContain("leaf");
  });

  it("stays within the contract's context byte limit", () => {
    const huge = { blob: "x".repeat(MAX_CONTEXT_BYTES * 4) };

    expect(
      jsonByteLength(normalizeContext(huge, undefined)),
    ).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
  });

  it("stays within the byte limit for multi-byte text", () => {
    const huge = { blob: "\u3042".repeat(MAX_CONTEXT_BYTES) };

    expect(
      jsonByteLength(normalizeContext(huge, undefined)),
    ).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
  });

  it("keeps the shape of a multi-byte bag rather than dropping it wholesale", () => {
    const huge = { who: "ada", blob: "\u3042".repeat(MAX_CONTEXT_BYTES) };

    const normalized = normalizeContext(huge, undefined);

    expect(normalized?.who).toBe("ada");
    expect(typeof normalized?.blob).toBe("string");
    expect(jsonByteLength(normalized)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
  });

  it("bounds a wide object with the node budget", () => {
    const wide: Record<string, number> = {};
    for (let index = 0; index < 5000; index += 1) wide[`k${index}`] = index;

    const normalized = normalizeContext(wide, undefined);

    expect(Object.keys(normalized ?? {}).length).toBeLessThan(5000);
  });

  it("renders values JSON cannot hold", () => {
    expect(
      normalizeContext(
        {
          fn: () => undefined,
          sym: Symbol("s"),
          big: 1n,
          nan: Number.NaN,
          when: new Date("2026-01-15T10:00:00.000Z"),
        },
        undefined,
      ),
    ).toEqual({
      fn: "[function]",
      sym: "[symbol]",
      big: "1",
      nan: "NaN",
      when: "2026-01-15T10:00:00.000Z",
    });
  });

  it("ignores non-objects", () => {
    expect(normalizeContext("string", undefined)).toBeUndefined();
    expect(normalizeContext(undefined, undefined)).toBeUndefined();
  });

  it("bounds a bag of errors without losing the keys beside them", () => {
    const stack = `Error: failure\n${"    at step (app.js:1:1)\n".repeat(10)}`;
    const errors = Array.from({ length: 400 }, (_unused, index) =>
      Object.assign(new Error(`failure ${index}`), { stack }),
    );

    const normalized = normalizeContext(
      { request: "GET /checkout", errors },
      undefined,
    );

    expect(normalized?.request).toBe("GET /checkout");
    expect(Array.isArray(normalized?.errors)).toBe(true);
    expect(jsonByteLength(normalized)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
  });

  it("serializes an error inside a context with its name, message and stack", () => {
    const failure = new TypeError("bad input");

    expect(normalizeContext({ failure }, undefined)).toEqual({
      failure: {
        name: "TypeError",
        message: "bad input",
        stack: failure.stack,
      },
    });
  });

  it("walks a plain { message, stack } object as an ordinary object", () => {
    expect(
      normalizeContext(
        { detail: { message: "m", stack: "s", code: 42 } },
        undefined,
      ),
    ).toEqual({ detail: { message: "m", stack: "s", code: 42 } });
  });

  it("keeps a top-level array within the contract's depth limit", () => {
    let nested: unknown[] = [true];
    for (let index = 0; index < 20; index += 1) nested = [nested];

    const normalized = normalizeContext(nested, undefined);

    expect(normalized).toHaveProperty("value");
    expect(jsonDepth(normalized)).toBeLessThanOrEqual(MAX_CONTEXT_DEPTH);
  });

  it("keeps a caller's own __proto__ key as a plain property", () => {
    const normalized = normalizeContext(
      JSON.parse('{"__proto__":{"x":1},"a":1}'),
      undefined,
    );

    expect(Object.hasOwn(normalized ?? {}, "__proto__")).toBe(true);
    expect(normalized?.a).toBe(1);
    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype);
  });
});

describe("mergeContext", () => {
  it("lets later layers win", () => {
    expect(mergeContext({ a: 1, b: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("returns nothing when every layer is empty", () => {
    expect(mergeContext(undefined, undefined)).toBeUndefined();
  });

  it("re-bounds the merged result, because each layer was budgeted alone", () => {
    const half = "x".repeat(MAX_CONTEXT_BYTES * 0.75);

    const merged = mergeContext({ static: half }, { perCall: half });

    expect(jsonByteLength(merged)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
  });

  it("keeps the most specific layer when it has to drop something", () => {
    const bulky = "x".repeat(MAX_CONTEXT_BYTES * 0.75);

    const merged = mergeContext(
      { collected: bulky },
      { static: bulky },
      { perCall: "kept" },
    );

    expect(merged?.perCall).toBe("kept");
    expect(merged?.["[truncated]"]).toBe(true);
    expect(jsonByteLength(merged)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
  });

  it("leaves a merge that already fits exactly as it was", () => {
    expect(mergeContext({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("keeps an own __proto__ key when it has to re-merge within budget", () => {
    const bulky = "x".repeat(MAX_CONTEXT_BYTES * 0.75);

    const merged = mergeContext(
      { collected: bulky },
      { static: bulky },
      JSON.parse('{"__proto__":{"x":1},"kept":true}'),
    );

    expect(Object.hasOwn(merged ?? {}, "__proto__")).toBe(true);
    expect(merged?.kept).toBe(true);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });
});
