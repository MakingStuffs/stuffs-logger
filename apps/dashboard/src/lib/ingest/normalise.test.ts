import {
  DEFAULT_REDACTION_REPLACEMENT,
  EMPTY_MESSAGE_PLACEHOLDER,
  MAX_CLOCK_SKEW_FUTURE_MS,
  MAX_CLOCK_SKEW_PAST_MS,
  parseLogEvent,
  type IngestEnvelope,
  type JsonValue,
} from "@stuffs/logger-core";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { normaliseBatch, UNKNOWN_ENVIRONMENT } from "./normalise";

/**
 * The validator is the one collaborator mocked here, and only so one test
 * can make it THROW — the real one never does, which is exactly why the guard
 * around it cannot be exercised any other way. Every other export keeps its
 * real implementation.
 */
vi.mock("@stuffs/logger-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stuffs/logger-core")>();
  return { ...actual, parseLogEvent: vi.fn(actual.parseLogEvent) };
});

const RECEIVED_AT = new Date("2026-09-01T12:00:00.000Z");

/** Built from code points: the characters under test are invisible. */
const ESC = String.fromCodePoint(0x1b);
const NUL = String.fromCodePoint(0x00);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);

/** A context nested far past what any recursive walk survives. */
function stackBreakingContext(): Record<string, JsonValue> {
  let node: JsonValue = [1];
  for (let level = 0; level < 5000; level += 1) node = [node];
  return { deep: node };
}

const CONTEXT = {
  applicationId: "app-1",
  receivedAt: RECEIVED_AT,
  fallbackUserAgent: null,
};

function makeEnvelope(
  events: unknown[],
  overrides: Partial<IngestEnvelope> = {},
): IngestEnvelope {
  return {
    sdk: { name: "@stuffs/logger", version: "0.1.0" },
    environment: "production",
    source: "browser",
    events,
    ...overrides,
  };
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    ts: RECEIVED_AT.getTime(),
    level: "info",
    message: "hello",
    logger: "manual",
    ...overrides,
  };
}

describe("normaliseBatch", () => {
  it("converts a valid event into a row", () => {
    const result = normaliseBatch(makeEnvelope([validEvent()]), CONTEXT);

    expect(result.rejected).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      applicationId: "app-1",
      level: "INFO",
      logger: "MANUAL",
      source: "BROWSER",
      environment: "production",
      message: "hello",
      receivedAt: RECEIVED_AT,
    });
  });

  it("attributes rows to the application from the context, never the body", () => {
    const envelope = makeEnvelope([validEvent()]);
    const result = normaliseBatch(envelope, {
      ...CONTEXT,
      applicationId: "app-real",
    });

    expect(result.rows[0]?.applicationId).toBe("app-real");
  });

  it("maps the wire taxonomy onto the database enums", () => {
    const events = [
      validEvent({ level: "trace", logger: "console" }),
      validEvent({ level: "fatal", logger: "uncaughtException" }),
    ];
    const result = normaliseBatch(
      makeEnvelope(events, { source: "node" }),
      CONTEXT,
    );

    expect(result.rows.map((row) => row.level)).toEqual(["TRACE", "FATAL"]);
    expect(result.rows.map((row) => row.logger)).toEqual([
      "CONSOLE",
      "UNCAUGHTEXCEPTION",
    ]);
    expect(result.rows.every((row) => row.source === "NODE")).toBe(true);
  });

  describe("partial acceptance", () => {
    it("keeps the good events and reports the bad ones", () => {
      const events = [validEvent(), { ts: 1, level: "nope" }, validEvent()];
      const result = normaliseBatch(makeEnvelope(events), CONTEXT);

      expect(result.rows).toHaveLength(2);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]?.index).toBe(1);
    });

    it("reports the position of each rejected event", () => {
      const events = [{ bad: true }, validEvent(), { alsoBad: true }];
      const result = normaliseBatch(makeEnvelope(events), CONTEXT);

      expect(result.rejected.map((entry) => entry.index)).toEqual([0, 2]);
    });

    it("rejects an event carrying an unknown key", () => {
      const result = normaliseBatch(
        makeEnvelope([validEvent({ applicationId: "app-other" })]),
        CONTEXT,
      );

      expect(result.rows).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
    });

    it("rejects an event whose validator throws instead of failing the batch", () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.mocked(parseLogEvent).mockImplementationOnce(() => {
        throw new RangeError("Maximum call stack size exceeded");
      });
      const events = [validEvent(), validEvent(), validEvent()];

      const result = normaliseBatch(makeEnvelope(events), CONTEXT);

      expect(result.rows).toHaveLength(2);
      expect(result.rejected).toEqual([
        {
          index: 0,
          issues: [{ path: "", message: "event could not be validated" }],
        },
      ]);
    });

    it("lets a deliberate ApiError from the validator through", () => {
      const refusal = new ApiError("VALIDATION_FAILED", "refused on purpose");
      vi.mocked(parseLogEvent).mockImplementationOnce(() => {
        throw refusal;
      });

      expect(() =>
        normaliseBatch(makeEnvelope([validEvent()]), CONTEXT),
      ).toThrow(refusal);
    });

    it("rejects, rather than crashes on, a context nested thousands of levels deep", () => {
      const events = [
        validEvent({ context: stackBreakingContext() }),
        validEvent(),
      ];

      const result = normaliseBatch(makeEnvelope(events), CONTEXT);

      expect(result.rows).toHaveLength(1);
      expect(result.rejected.map((entry) => entry.index)).toEqual([0]);
    });
  });

  describe("timestamp clamping", () => {
    it("keeps a plausible client timestamp", () => {
      const ts = RECEIVED_AT.getTime() - 1000;
      const result = normaliseBatch(
        makeEnvelope([validEvent({ ts })]),
        CONTEXT,
      );

      expect(result.rows[0]?.timestamp).toEqual(new Date(ts));
      expect(result.clampedCount).toBe(0);
    });

    it("clamps a timestamp too far in the future to the receive time", () => {
      const ts = RECEIVED_AT.getTime() + MAX_CLOCK_SKEW_FUTURE_MS + 1000;
      const result = normaliseBatch(
        makeEnvelope([validEvent({ ts })]),
        CONTEXT,
      );

      expect(result.rows[0]?.timestamp).toEqual(RECEIVED_AT);
      expect(result.clampedCount).toBe(1);
    });

    it("clamps a timestamp too far in the past to the receive time", () => {
      const ts = RECEIVED_AT.getTime() - MAX_CLOCK_SKEW_PAST_MS - 1000;
      const result = normaliseBatch(
        makeEnvelope([validEvent({ ts })]),
        CONTEXT,
      );

      expect(result.rows[0]?.timestamp).toEqual(RECEIVED_AT);
      expect(result.clampedCount).toBe(1);
    });

    it("always stamps receivedAt from the server, never the client", () => {
      const ts = RECEIVED_AT.getTime() + MAX_CLOCK_SKEW_FUTURE_MS + 1000;
      const result = normaliseBatch(
        makeEnvelope([validEvent({ ts })]),
        CONTEXT,
      );

      expect(result.rows[0]?.receivedAt).toEqual(RECEIVED_AT);
    });

    it("counts each clamped event separately", () => {
      const bad = validEvent({
        ts: RECEIVED_AT.getTime() + MAX_CLOCK_SKEW_FUTURE_MS + 1,
      });
      const result = normaliseBatch(
        makeEnvelope([bad, validEvent(), bad]),
        CONTEXT,
      );

      expect(result.clampedCount).toBe(2);
    });
  });

  describe("derived fields", () => {
    it("derives device facets from the event user agent", () => {
      const userAgent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
      const result = normaliseBatch(
        makeEnvelope([validEvent({ userAgent })]),
        CONTEXT,
      );

      expect(result.rows[0]).toMatchObject({
        deviceType: "MOBILE",
        os: "iOS",
        browser: "Safari",
      });
    });

    it("falls back to the request user agent when the event has none", () => {
      const result = normaliseBatch(makeEnvelope([validEvent()]), {
        ...CONTEXT,
        fallbackUserAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
      });

      expect(result.rows[0]).toMatchObject({
        deviceType: "DESKTOP",
        os: "Windows",
        browser: "Chrome",
      });
    });

    it("records UNKNOWN when there is no user agent at all", () => {
      const result = normaliseBatch(
        makeEnvelope([validEvent()], { source: "node" }),
        CONTEXT,
      );

      expect(result.rows[0]).toMatchObject({
        deviceType: "UNKNOWN",
        os: null,
        browser: null,
      });
    });

    it("flattens the error payload onto the row", () => {
      const error = { name: "TypeError", message: "boom", stack: "at thing" };
      const result = normaliseBatch(
        makeEnvelope([validEvent({ error })]),
        CONTEXT,
      );

      expect(result.rows[0]).toMatchObject({
        errorName: "TypeError",
        errorMessage: "boom",
        errorStack: "at thing",
      });
    });

    it("carries the envelope fields onto every row", () => {
      const envelope = makeEnvelope([validEvent(), validEvent()], {
        release: "abc123",
        sessionId: "sess-1",
        environment: "staging",
      });
      const result = normaliseBatch(envelope, CONTEXT);

      for (const row of result.rows) {
        expect(row).toMatchObject({
          release: "abc123",
          sessionId: "sess-1",
          environment: "staging",
        });
      }
    });
  });
  describe("redaction", () => {
    it("replaces a secret-shaped context key the client sent verbatim", () => {
      const result = normaliseBatch(
        makeEnvelope([
          validEvent({ context: { apiKey: "live-secret", userId: "u1" } }),
        ]),
        CONTEXT,
      );

      expect(result.rows[0]?.context).toEqual({
        apiKey: DEFAULT_REDACTION_REPLACEMENT,
        userId: "u1",
      });
    });

    it("redacts a secret nested inside the context", () => {
      const context = {
        request: { headers: { authorization: "Bearer live-secret" } },
      };
      const result = normaliseBatch(
        makeEnvelope([validEvent({ context })]),
        CONTEXT,
      );

      expect(JSON.stringify(result.rows[0]?.context)).not.toContain(
        "live-secret",
      );
    });

    it("redacts regardless of what the batch claims about itself", () => {
      // Nothing in the wire contract can switch server-side redaction off:
      // the SDK's own toggle never reaches this side of the boundary.
      const result = normaliseBatch(
        makeEnvelope([validEvent({ context: { password: "hunter2" } })], {
          source: "node",
        }),
        CONTEXT,
      );

      expect(result.rows[0]?.context).toEqual({
        password: DEFAULT_REDACTION_REPLACEMENT,
      });
    });

    it("leaves an event without context alone", () => {
      const result = normaliseBatch(makeEnvelope([validEvent()]), CONTEXT);

      expect(result.rows[0]?.context).toBeUndefined();
    });
  });

  describe("text sanitisation", () => {
    it("strips ANSI escapes from the message", () => {
      const result = normaliseBatch(
        makeEnvelope([validEvent({ message: `${ESC}[31mred${ESC}[0m` })]),
        CONTEXT,
      );

      expect(result.rows[0]?.message).toBe("red");
    });

    it("strips a bidi override that would visually reorder the message", () => {
      const result = normaliseBatch(
        makeEnvelope([
          validEvent({ message: `deleted ${RIGHT_TO_LEFT_OVERRIDE}resu` }),
        ]),
        CONTEXT,
      );

      expect(result.rows[0]?.message).toBe("deleted resu");
    });

    it("strips escapes from the error stack but keeps its newlines", () => {
      const error = { stack: `at foo${ESC}[0m\n  at bar` };
      const result = normaliseBatch(
        makeEnvelope([validEvent({ error })]),
        CONTEXT,
      );

      expect(result.rows[0]?.errorStack).toBe("at foo\n  at bar");
    });

    it("strips control characters from context strings", () => {
      const result = normaliseBatch(
        makeEnvelope([validEvent({ context: { note: `a${NUL}b`, count: 2 } })]),
        CONTEXT,
      );

      expect(result.rows[0]?.context).toEqual({ note: "ab", count: 2 });
    });

    it("stores the placeholder for a message that sanitises to nothing", () => {
      const result = normaliseBatch(
        makeEnvelope([validEvent({ message: `${ESC}[31m${NUL}${ESC}[0m` })]),
        CONTEXT,
      );

      expect(result.rows[0]?.message).toBe(EMPTY_MESSAGE_PLACEHOLDER);
    });

    it("strips a bidi override from the environment label", () => {
      const result = normaliseBatch(
        makeEnvelope([validEvent()], {
          environment: `prod${RIGHT_TO_LEFT_OVERRIDE}uction`,
        }),
        CONTEXT,
      );

      expect(result.rows[0]?.environment).toBe("production");
    });

    it("strips escapes and NULs from the release and session labels", () => {
      const result = normaliseBatch(
        makeEnvelope([validEvent()], {
          release: `${ESC}[31mv1.2.3${ESC}[0m`,
          sessionId: `sess${NUL}-1`,
        }),
        CONTEXT,
      );

      expect(result.rows[0]).toMatchObject({
        release: "v1.2.3",
        sessionId: "sess-1",
      });
    });

    it("falls back to the unknown environment when the label sanitises to nothing", () => {
      const result = normaliseBatch(
        makeEnvelope([validEvent()], { environment: `${NUL}${NUL}` }),
        CONTEXT,
      );

      expect(result.rows[0]?.environment).toBe(UNKNOWN_ENVIRONMENT);
    });

    it("stores an optional label that sanitises to nothing as absent", () => {
      const result = normaliseBatch(
        makeEnvelope([validEvent()], {
          release: `${ESC}[0m`,
          sessionId: NUL,
        }),
        CONTEXT,
      );

      expect(result.rows[0]).toMatchObject({ release: null, sessionId: null });
    });
  });
});
