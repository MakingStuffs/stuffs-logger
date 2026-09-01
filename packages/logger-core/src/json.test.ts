import { describe, expect, it } from "vitest";

import { jsonByteLength, jsonDepth } from "./json";

describe("jsonDepth", () => {
  it("reports 0 for a scalar", () => {
    expect(jsonDepth("a")).toBe(0);
    expect(jsonDepth(1)).toBe(0);
    expect(jsonDepth(null)).toBe(0);
  });

  it("reports 1 for a flat object", () => {
    expect(jsonDepth({ a: 1, b: "two" })).toBe(1);
  });

  it("reports 1 for an empty container", () => {
    expect(jsonDepth({})).toBe(1);
    expect(jsonDepth([])).toBe(1);
  });

  it("counts nested objects", () => {
    expect(jsonDepth({ a: { b: 1 } })).toBe(2);
    expect(jsonDepth({ a: { b: { c: 1 } } })).toBe(3);
  });

  it("counts nested arrays", () => {
    expect(jsonDepth([[[1]]])).toBe(3);
  });

  it("reports the deepest branch, not the first", () => {
    expect(jsonDepth({ shallow: 1, deep: { a: { b: 1 } } })).toBe(3);
  });

  it("stops descending once past the limit", () => {
    let node: Record<string, unknown> = { leaf: 1 };
    for (let level = 0; level < 5000; level += 1) node = { nested: node };

    expect(jsonDepth(node, 8)).toBe(9);
  });
});

describe("jsonByteLength", () => {
  it("measures the serialised form", () => {
    expect(jsonByteLength({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
  });

  it("counts multi-byte characters as their UTF-8 length", () => {
    expect(jsonByteLength("é")).toBeGreaterThan(JSON.stringify("é").length - 1);
    expect(jsonByteLength("😀")).toBe(
      new TextEncoder().encode(JSON.stringify("😀")).length,
    );
  });

  it("fails closed on a circular reference", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(jsonByteLength(circular)).toBe(Number.POSITIVE_INFINITY);
  });

  it("fails closed on a value JSON cannot represent", () => {
    expect(jsonByteLength(undefined)).toBe(Number.POSITIVE_INFINITY);
  });
});
