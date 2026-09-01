import { describe, expect, it } from "vitest";

import {
  LIST_CONTEXT_MAX_BYTES,
  LIST_STACK_MAX_CHARS,
  projectListContext,
  projectListStack,
} from "./projection";

describe("projectListContext", () => {
  it("reports an absent context as null and untruncated", () => {
    expect(projectListContext(null)).toEqual({
      context: null,
      truncated: false,
    });
  });

  it("returns a small context whole", () => {
    const context = { userId: "u1", route: "/checkout" };

    expect(projectListContext(context)).toEqual({ context, truncated: false });
  });

  it("keeps the entries that fit and flags the rest", () => {
    const context = {
      small: "a",
      huge: "x".repeat(LIST_CONTEXT_MAX_BYTES * 2),
      alsoSmall: "b",
    };

    const projected = projectListContext(context);

    expect(projected.truncated).toBe(true);
    expect(projected.context).toEqual({ small: "a", alsoSmall: "b" });
  });

  it("keeps the result inside the budget", () => {
    const context = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [
        `key${index}`,
        "v".repeat(64),
      ]),
    );

    const projected = projectListContext(context);

    expect(projected.truncated).toBe(true);
    expect(JSON.stringify(projected.context).length).toBeLessThanOrEqual(
      LIST_CONTEXT_MAX_BYTES,
    );
  });

  it("truncates an oversized array to the entries that fit", () => {
    const context = Array.from({ length: 100 }, () => "v".repeat(64));

    const projected = projectListContext(context);

    expect(projected.truncated).toBe(true);
    expect(Array.isArray(projected.context)).toBe(true);
  });

  it("drops an oversized scalar entirely", () => {
    const projected = projectListContext(
      "x".repeat(LIST_CONTEXT_MAX_BYTES * 2),
    );

    expect(projected).toEqual({ context: null, truncated: true });
  });

  it("honours an explicit budget", () => {
    const projected = projectListContext({ a: "12345678901234567890" }, 8);

    expect(projected.truncated).toBe(true);
  });
});

describe("projectListStack", () => {
  it("reports an absent stack as null and untruncated", () => {
    expect(projectListStack(null)).toEqual({
      errorStack: null,
      truncated: false,
    });
  });

  it("returns a short stack whole", () => {
    const stack = "TypeError: boom\n  at foo";

    expect(projectListStack(stack)).toEqual({
      errorStack: stack,
      truncated: false,
    });
  });

  it("cuts a long stack to the budget and flags it", () => {
    const projected = projectListStack("x".repeat(LIST_STACK_MAX_CHARS + 10));

    expect(projected.truncated).toBe(true);
    expect(projected.errorStack).toHaveLength(LIST_STACK_MAX_CHARS);
  });

  it("keeps the first frames, which are the identifying ones", () => {
    const stack = `TypeError: boom\n  at foo\n${"  at filler\n".repeat(500)}`;

    expect(projectListStack(stack).errorStack).toContain("at foo");
  });
});
