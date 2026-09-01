import { describe, expect, it } from "vitest";

import { jsonByteLength, MAX_BODY_BYTES } from "../contract";
import type { LogEventPayload } from "../contract";
import { MAX_KEEPALIVE_BODY_BYTES } from "../defaults";
import { batchByteBudget, countWithinByteBudget } from "./batching";

function makeEvent(message: string): LogEventPayload {
  return { ts: 1_767_000_000_000, level: "info", message, logger: "manual" };
}

/** One event of roughly `bytes` UTF-8 bytes, written in three-byte CJK. */
function makeMultiByteEvent(bytes: number): LogEventPayload {
  return makeEvent("漢".repeat(Math.ceil(bytes / 3)));
}

describe("batchByteBudget", () => {
  it("stays under the server's body limit", () => {
    expect(batchByteBudget(false)).toBeLessThan(MAX_BODY_BYTES);
  });

  it("stays under the browser's keepalive limit on the unload path", () => {
    expect(batchByteBudget(true)).toBeLessThan(MAX_KEEPALIVE_BODY_BYTES);
  });
});

describe("countWithinByteBudget", () => {
  it("takes everything when the whole batch fits", () => {
    const events = [makeEvent("one"), makeEvent("two")];

    expect(countWithinByteBudget(events, 1000)).toBe(2);
  });

  it("takes nothing from an empty batch", () => {
    expect(countWithinByteBudget([], 1000)).toBe(0);
  });

  it("measures UTF-8 bytes, not UTF-16 code units", () => {
    // 10,000 code units of CJK is 30,000 bytes: a code-unit count would say
    // this fits in a 20,000 byte budget.
    const events = [makeMultiByteEvent(30_000)];

    expect(countWithinByteBudget(events, 20_000)).toBe(1);
    expect(jsonByteLength(events)).toBeGreaterThan(20_000);
  });

  it("splits a multi-byte batch so each part fits the budget", () => {
    const events = Array.from({ length: 20 }, () => makeMultiByteEvent(10_000));

    const count = countWithinByteBudget(events, 45_000);

    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(events.length);
    expect(jsonByteLength(events.slice(0, count))).toBeLessThanOrEqual(45_000);
  });

  it("always makes progress, even when one event alone is too big", () => {
    const events = [makeMultiByteEvent(90_000), makeEvent("small")];

    expect(countWithinByteBudget(events, 1000)).toBe(1);
  });

  it("keeps every part within the budget when applied repeatedly", () => {
    let remaining = Array.from({ length: 30 }, (_unused, index) =>
      makeMultiByteEvent(3000 * ((index % 5) + 1)),
    );
    const budget = 40_000;
    let delivered = 0;

    while (remaining.length > 0) {
      const count = countWithinByteBudget(remaining, budget);
      const part = remaining.slice(0, count);
      if (part.length > 1) {
        expect(jsonByteLength(part)).toBeLessThanOrEqual(budget);
      }
      delivered += part.length;
      remaining = remaining.slice(count);
    }

    expect(delivered).toBe(30);
  });
});
