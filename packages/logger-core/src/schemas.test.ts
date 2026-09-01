import { describe, expect, it } from "vitest";

import {
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_DEPTH,
  MAX_EVENTS_PER_BATCH,
  MAX_MESSAGE_LENGTH,
  MAX_SHORT_FIELD_LENGTH,
} from "./constants";
import type { JsonValue } from "./json";
import { parseIngestBatch } from "./schemas";
import type { IngestBatch, LogEventPayload } from "./schemas";

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
    sdk: { name: "@jf-logger/sdk", version: "0.1.0" },
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
