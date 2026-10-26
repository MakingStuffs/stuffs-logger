import { describe, expect, it } from "vitest";

import {
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_DEPTH,
  MAX_EVENTS_PER_BATCH,
  MAX_MESSAGE_LENGTH,
  MAX_SHORT_FIELD_LENGTH,
} from "./constants";
import type { JsonValue } from "./json";
import { parseIngestBatch, parseLogEvent } from "./schemas";
import type {
  IngestBatch,
  IngestBatchParseResult,
  LogEventPayload,
} from "./schemas";

function makeEvent(overrides: Partial<LogEventPayload> = {}): LogEventPayload {
  return {
    ts: 1725187200000,
    level: "info",
    message: "hello",
    logger: "manual",
    ...overrides,
  };
}

function makeBatch(overrides: Partial<IngestBatch> = {}): IngestBatch {
  return {
    sdk: { name: "@stuffs-logger/sdk", version: "0.1.0" },
    environment: "production",
    source: "browser",
    events: [makeEvent()],
    ...overrides,
  };
}

/** Builds an object nested `depth` levels deep. */
function nestToDepth(depth: number): Record<string, JsonValue> {
  let node: Record<string, JsonValue> = { leaf: 1 };
  for (let level = 1; level < depth; level += 1) node = { nested: node };
  return node;
}

/**
 * Deep enough to overflow the stack of any recursive walk. The iterative
 * depth check must refuse this before zod or `JSON.stringify` ever see it.
 */
const STACK_BREAKING_DEPTH = 5000;

/** A context whose only value is an array nested `STACK_BREAKING_DEPTH` deep. */
function stackBreakingContext(): Record<string, JsonValue> {
  let node: JsonValue = [1];
  for (let level = 0; level < STACK_BREAKING_DEPTH; level += 1) node = [node];
  return { deep: node };
}

describe("parseIngestBatch", () => {
  it("accepts a minimal valid batch", () => {
    const result = parseIngestBatch(makeBatch());

    expect(result.ok).toBe(true);
  });

  it("accepts every optional field", () => {
    const result = parseIngestBatch(
      makeBatch({
        release: "abc123",
        sessionId: "session-1",
        source: "node",
        events: [
          makeEvent({
            context: { userId: "u1", nested: { ok: true } },
            error: { name: "TypeError", message: "boom", stack: "at x" },
            url: "https://example.test/page",
            userAgent: "Mozilla/5.0",
          }),
        ],
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("rejects a non-object body", () => {
    expect(parseIngestBatch("not-a-batch").ok).toBe(false);
    expect(parseIngestBatch(null).ok).toBe(false);
    expect(parseIngestBatch([]).ok).toBe(false);
  });

  it("rejects unknown top-level keys rather than stripping them", () => {
    const result = parseIngestBatch({ ...makeBatch(), applicationId: "app-1" });

    expect(result.ok).toBe(false);
  });

  it("rejects unknown keys inside an event", () => {
    const result = parseIngestBatch(
      makeBatch({
        events: [{ ...makeEvent(), ip: "1.2.3.4" } as LogEventPayload],
      }),
    );

    expect(result.ok).toBe(false);
  });

  it("rejects an empty batch", () => {
    const result = parseIngestBatch(makeBatch({ events: [] }));

    expect(result.ok).toBe(false);
  });

  it(`accepts exactly ${MAX_EVENTS_PER_BATCH} events`, () => {
    const events = Array.from({ length: MAX_EVENTS_PER_BATCH }, () =>
      makeEvent(),
    );

    expect(parseIngestBatch(makeBatch({ events })).ok).toBe(true);
  });

  it(`rejects ${MAX_EVENTS_PER_BATCH + 1} events`, () => {
    const events = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () =>
      makeEvent(),
    );

    expect(parseIngestBatch(makeBatch({ events })).ok).toBe(false);
  });

  it(`accepts a message of exactly ${MAX_MESSAGE_LENGTH} characters`, () => {
    const message = "a".repeat(MAX_MESSAGE_LENGTH);

    expect(
      parseIngestBatch(makeBatch({ events: [makeEvent({ message })] })).ok,
    ).toBe(true);
  });

  it("rejects a message one character over the limit", () => {
    const message = "a".repeat(MAX_MESSAGE_LENGTH + 1);

    expect(
      parseIngestBatch(makeBatch({ events: [makeEvent({ message })] })).ok,
    ).toBe(false);
  });

  it("rejects an empty message", () => {
    expect(
      parseIngestBatch(makeBatch({ events: [makeEvent({ message: "" })] })).ok,
    ).toBe(false);
  });

  it("rejects an environment over the short-field limit", () => {
    const environment = "e".repeat(MAX_SHORT_FIELD_LENGTH + 1);

    expect(parseIngestBatch(makeBatch({ environment })).ok).toBe(false);
  });

  it("rejects a release over the short-field limit", () => {
    const release = "r".repeat(MAX_SHORT_FIELD_LENGTH + 1);

    expect(parseIngestBatch(makeBatch({ release })).ok).toBe(false);
  });

  it("rejects a sessionId over the short-field limit", () => {
    const sessionId = "s".repeat(MAX_SHORT_FIELD_LENGTH + 1);

    expect(parseIngestBatch(makeBatch({ sessionId })).ok).toBe(false);
  });

  it("rejects a level outside the taxonomy", () => {
    const events = [
      { ...makeEvent(), level: "critical" } as unknown as LogEventPayload,
    ];

    expect(parseIngestBatch(makeBatch({ events })).ok).toBe(false);
  });

  it("rejects a logger outside the taxonomy", () => {
    const events = [
      { ...makeEvent(), logger: "custom" } as unknown as LogEventPayload,
    ];

    expect(parseIngestBatch(makeBatch({ events })).ok).toBe(false);
  });

  it("rejects a source outside the taxonomy", () => {
    expect(parseIngestBatch({ ...makeBatch(), source: "deno" }).ok).toBe(false);
  });

  it("rejects a non-integer timestamp", () => {
    expect(
      parseIngestBatch(makeBatch({ events: [makeEvent({ ts: 1.5 })] })).ok,
    ).toBe(false);
  });

  it("rejects a negative timestamp", () => {
    expect(
      parseIngestBatch(makeBatch({ events: [makeEvent({ ts: -1 })] })).ok,
    ).toBe(false);
  });

  it(`accepts context nested exactly ${MAX_CONTEXT_DEPTH} levels deep`, () => {
    const context = nestToDepth(MAX_CONTEXT_DEPTH);

    expect(
      parseIngestBatch(makeBatch({ events: [makeEvent({ context })] })).ok,
    ).toBe(true);
  });

  it("rejects context nested one level too deep", () => {
    const context = nestToDepth(MAX_CONTEXT_DEPTH + 1);

    expect(
      parseIngestBatch(makeBatch({ events: [makeEvent({ context })] })).ok,
    ).toBe(false);
  });

  it(`rejects context serialising to more than ${MAX_CONTEXT_BYTES} bytes`, () => {
    const context = { blob: "x".repeat(MAX_CONTEXT_BYTES + 1) };

    expect(
      parseIngestBatch(makeBatch({ events: [makeEvent({ context })] })).ok,
    ).toBe(false);
  });

  it("rejects, rather than throws on, a context nested thousands of levels deep", () => {
    const batch = makeBatch({
      events: [makeEvent({ context: stackBreakingContext() })],
    });
    let result: IngestBatchParseResult | undefined;

    expect(() => {
      result = parseIngestBatch(batch);
    }).not.toThrow();

    expect(result?.ok).toBe(false);
    if (result === undefined || result.ok) return;
    expect(result.issues[0]).toEqual({
      path: "events.0.context",
      message: `context must not nest more than ${MAX_CONTEXT_DEPTH} levels deep`,
    });
  });

  it("rejects a context that is not an object", () => {
    const events = [
      { ...makeEvent(), context: [1, 2] } as unknown as LogEventPayload,
      { ...makeEvent(), context: "text" } as unknown as LogEventPayload,
      { ...makeEvent(), context: null } as unknown as LogEventPayload,
    ];

    for (const event of events) {
      expect(parseIngestBatch(makeBatch({ events: [event] })).ok).toBe(false);
    }
  });

  it("does not echo the caller's key names when rejecting unknown keys", () => {
    const hostileKey = `<img src=x onerror=alert(1)>${"k".repeat(2000)}`;
    const result = parseIngestBatch({ ...makeBatch(), [hostileKey]: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { path: "", message: "unrecognized keys are not allowed" },
    ]);
  });

  it("does not echo unknown event keys either", () => {
    const events = [
      { ...makeEvent(), stolenField: 1 } as unknown as LogEventPayload,
    ];
    const result = parseIngestBatch(makeBatch({ events }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.issues)).not.toContain("stolenField");
  });

  it("reports the path of the offending field", () => {
    const result = parseIngestBatch(
      makeBatch({ events: [makeEvent({ message: "" })] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe("events.0.message");
  });

  it("caps the number of reported issues", () => {
    const events = Array.from({ length: 50 }, () => makeEvent({ message: "" }));
    const result = parseIngestBatch(makeBatch({ events }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeLessThanOrEqual(20);
  });
});

describe("parseLogEvent", () => {
  it("accepts a valid event", () => {
    expect(parseLogEvent(makeEvent()).ok).toBe(true);
  });

  it("rejects, rather than throws on, a stack-breaking context", () => {
    const event = makeEvent({ context: stackBreakingContext() });

    expect(() => parseLogEvent(event)).not.toThrow();
    expect(parseLogEvent(event).ok).toBe(false);
  });
});
