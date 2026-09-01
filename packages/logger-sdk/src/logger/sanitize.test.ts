import { describe, expect, it } from "vitest";

import {
  jsonByteLength,
  MAX_CONTEXT_BYTES,
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
});
