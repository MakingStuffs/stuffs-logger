import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  jsonByteLength,
  MAX_BODY_BYTES,
  MAX_EVENTS_PER_BATCH,
} from "../contract";
import { MAX_KEEPALIVE_BODY_BYTES } from "../defaults";
import type { ContextCollector } from "../context/collector";
import {
  createFakeTransport,
  createTestAdapter,
  PUBLIC_KEY,
  SECRET_KEY,
} from "../testing/fixtures";
import type { FakeTransport } from "../testing/fixtures";
import { createLoggerWith } from "./create-logger";
import { createHttpTransport } from "./transport";
import type {
  Logger,
  LoggerOptions,
  Transport,
  TransportOutcome,
} from "../types";

const FLUSH_INTERVAL_MS = 5000;

function makeLogger(
  transport: FakeTransport,
  overrides: Partial<LoggerOptions> = {},
  collector?: ContextCollector,
): Logger {
  return createLoggerWith(
    {
      apiKey: SECRET_KEY,
      transport,
      flushIntervalMs: FLUSH_INTERVAL_MS,
      ...overrides,
    },
    createTestAdapter(collector ? { createCollector: () => collector } : {}),
  );
}

/** A message of roughly `bytes` UTF-8 bytes, written in three-byte CJK. */
function multiByteMessage(bytes: number): string {
  return "\u6f22".repeat(Math.ceil(bytes / 3));
}

interface GatedTransport extends Transport {
  /** One entry per send, in order. */
  readonly sends: { urgent: boolean; events: number }[];
  /** Lets the ordinary send that is currently blocked finish. */
  release(): void;
}

/**
 * A transport whose ORDINARY sends hang until released, while urgent sends
 * resolve at once — the shape of a slow network during a navigation.
 */
function createGatedTransport(): GatedTransport {
  const sends: { urgent: boolean; events: number }[] = [];
  let unblock: (() => void) | undefined;

  return {
    sends,
    release(): void {
      unblock?.();
      unblock = undefined;
    },
    send({ batch, urgent }): Promise<TransportOutcome> {
      sends.push({ urgent, events: batch.events.length });
      const outcome: TransportOutcome = {
        kind: "sent",
        accepted: batch.events.length,
      };
      if (urgent) return Promise.resolve(outcome);
      return new Promise<TransportOutcome>((resolve) => {
        unblock = () => {
          resolve(outcome);
        };
      });
    },
  };
}

describe("createLoggerWith", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("batching and flush triggers", () => {
    it("holds events until the batch fills", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { batchSize: 3 });

      logger.info("one");
      logger.info("two");
      await vi.advanceTimersByTimeAsync(0);

      expect(transport.batches).toHaveLength(0);
    });

    it("flushes as soon as the batch is full", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { batchSize: 3 });

      logger.info("one");
      logger.info("two");
      logger.info("three");
      await vi.advanceTimersByTimeAsync(0);

      expect(transport.batches).toHaveLength(1);
      expect(transport.events.map((event) => event.message)).toEqual([
        "one",
        "two",
        "three",
      ]);
    });

    it("flushes a partial batch on the interval", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { batchSize: 50 });

      logger.info("lonely");
      await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

      expect(transport.events).toHaveLength(1);
    });

    it("flushes on demand", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { batchSize: 50 });

      logger.info("now please");
      await logger.flush();

      expect(transport.events).toHaveLength(1);
    });

    it("never exceeds the contract's batch size", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, {
        maxQueueSize: 500,
        batchSize: 500,
      });

      for (let index = 0; index < 250; index += 1)
        logger.info(`event ${index}`);
      await logger.flush();

      expect(transport.batches.length).toBeGreaterThan(1);
      for (const batch of transport.batches) {
        expect(batch.events.length).toBeLessThanOrEqual(MAX_EVENTS_PER_BATCH);
      }
    });

    it("sends the batch envelope the contract requires", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, {
        environment: "staging",
        release: "abc123",
        sessionId: "sess-1",
      });

      logger.warn("careful");
      await logger.flush();

      expect(transport.batches[0]).toMatchObject({
        sdk: { name: "@stuffs-logger/sdk", version: expect.any(String) },
        environment: "staging",
        release: "abc123",
        source: "node",
      });
    });

    it("stamps events with the level, logger kind and clock", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport);

      logger.error("it broke");
      await logger.flush();

      expect(transport.events[0]).toMatchObject({
        ts: Date.now(),
        level: "error",
        message: "it broke",
        logger: "manual",
      });
    });
  });

  describe("bounded memory", () => {
    it("drops the oldest events when the queue overflows", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { maxQueueSize: 3, batchSize: 100 });

      for (const message of ["a", "b", "c", "d", "e"]) logger.info(message);
      await logger.flush();

      expect(transport.events.map((event) => event.message)).toEqual([
        "c",
        "d",
        "e",
      ]);
    });

    it("counts what it dropped", () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { maxQueueSize: 2, batchSize: 100 });

      for (const message of ["a", "b", "c", "d"]) logger.info(message);

      expect(logger.stats.dropped).toBe(2);
      expect(logger.stats.queued).toBe(2);
    });
  });

  describe("redaction", () => {
    it("replaces secret-shaped values before they are queued", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport);

      logger.info("login", { email: "ada@example.com", password: "hunter2" });
      await logger.flush();

      expect(transport.events[0]?.context).toEqual({
        email: "ada@example.com",
        password: "[redacted]",
      });
    });

    it("redacts the static context too", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { context: { apiKey: "leaky" } });

      logger.info("hello");
      await logger.flush();

      expect(transport.events[0]?.context).toEqual({ apiKey: "[redacted]" });
    });

    it("can be switched off deliberately", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { redaction: { enabled: false } });

      logger.info("login", { password: "hunter2" });
      await logger.flush();

      expect(transport.events[0]?.context).toEqual({ password: "hunter2" });
    });
  });

  describe("sampling", () => {
    it("drops every event at a level sampled to zero", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { sampleRates: { debug: 0 } });

      logger.debug("noisy");
      logger.info("kept");
      await logger.flush();

      expect(transport.events.map((event) => event.message)).toEqual(["kept"]);
    });

    it("keeps the fraction the rate describes", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { sampleRate: 0.5 });
      const draws = [0.1, 0.9, 0.2, 0.8];
      let index = 0;
      vi.spyOn(Math, "random").mockImplementation(() => draws[index++] ?? 1);

      for (const message of ["a", "b", "c", "d"]) logger.info(message);
      await logger.flush();

      expect(transport.events.map((event) => event.message)).toEqual([
        "a",
        "c",
      ]);
    });

    it("discards events below the minimum level", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { minLevel: "warn" });

      logger.info("chatter");
      logger.warn("listen");
      await logger.flush();

      expect(transport.events.map((event) => event.message)).toEqual([
        "listen",
      ]);
    });
  });

  describe("context", () => {
    it("layers per-call context over static over collected", async () => {
      const transport = createFakeTransport();
      const collector: ContextCollector = {
        sessionId: () => "sess-9",
        collect: () => ({
          url: "https://example.com/checkout",
          userAgent: "test-agent",
          context: { viewport: "800x600", layer: "collected" },
        }),
      };
      const logger = makeLogger(
        transport,
        { context: { layer: "static", app: "web" } },
        collector,
      );

      logger.info("hello", { layer: "call" });
      await logger.flush();

      expect(transport.events[0]).toMatchObject({
        url: "https://example.com/checkout",
        userAgent: "test-agent",
        context: { viewport: "800x600", app: "web", layer: "call" },
      });
      expect(transport.batches[0]?.sessionId).toBe("sess-9");
    });

    it("redacts secret-shaped query parameters out of the captured url", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(
        transport,
        {},
        {
          sessionId: () => undefined,
          collect: () => ({
            url: "https://app.example.com/reset?token=abc123&step=2",
          }),
        },
      );

      logger.info("password reset opened");
      await logger.flush();

      expect(transport.events[0]?.url).toBe(
        "https://app.example.com/reset?token=[redacted]&step=2",
      );
    });

    it("replaces the static context on request", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { context: { build: 1 } });

      logger.setContext({ build: 2 });
      logger.info("hello");
      await logger.flush();

      expect(transport.events[0]?.context).toEqual({ build: 2 });
    });
  });

  describe("the no-throw guarantee", () => {
    it("does not surface a rejecting transport to the caller", async () => {
      const onError = vi.fn();
      const transport = createFakeTransport();
      transport.rejectWith(new Error("network down"));
      const logger = makeLogger(transport, { onError });

      expect(() => {
        logger.error("something");
      }).not.toThrow();
      await expect(logger.flush()).resolves.toBeUndefined();
      expect(onError).toHaveBeenCalled();
    });

    it("does not surface a throwing transport to the caller", async () => {
      const logger = createLoggerWith(
        {
          apiKey: SECRET_KEY,
          transport: {
            send: () => {
              throw new Error("synchronous explosion");
            },
          },
        },
        createTestAdapter(),
      );

      logger.info("hello");
      await expect(logger.flush()).resolves.toBeUndefined();
    });

    it("does not surface a throwing context collector", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(
        transport,
        {},
        {
          sessionId: () => undefined,
          collect: () => {
            throw new Error("no window");
          },
        },
      );

      expect(() => {
        logger.info("hello");
      }).not.toThrow();
      await logger.flush();
    });

    it("does not surface a throwing onError hook", () => {
      const transport = createFakeTransport();
      const logger = makeLogger(
        transport,
        {
          onError: () => {
            throw new Error("diagnostics exploded");
          },
        },
        {
          sessionId: () => undefined,
          collect: () => {
            throw new Error("no window");
          },
        },
      );

      expect(() => {
        logger.info("hello");
      }).not.toThrow();
    });

    it("survives a circular context", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport);
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(() => {
        logger.info("cycle", circular);
      }).not.toThrow();
      await logger.flush();

      expect(transport.events[0]?.context).toEqual({ self: "[circular]" });
    });
  });

  describe("failure policy", () => {
    it("keeps events for a retry rather than losing them", async () => {
      const transport = createFakeTransport({ kind: "retry" });
      const logger = makeLogger(transport);

      logger.info("keep me");
      await logger.flush();
      expect(logger.stats.queued).toBe(1);

      transport.respondWith({ kind: "sent", accepted: 0 });
      await vi.advanceTimersByTimeAsync(60000);

      expect(transport.events.map((event) => event.message)).toContain(
        "keep me",
      );
    });

    it("stops retrying instead of spinning when the endpoint stays down", async () => {
      const transport = createFakeTransport({ kind: "retry" });
      const logger = makeLogger(transport);

      logger.info("doomed");
      await vi.advanceTimersByTimeAsync(600000);

      expect(transport.batches.length).toBeLessThan(20);
      expect(logger.stats.dropped).toBeGreaterThan(0);
    });

    it("goes inert when the ingest key is refused", async () => {
      const transport = createFakeTransport({
        kind: "disabled",
        reason: "ingest rejected the key (status 401)",
      });
      const logger = makeLogger(transport);

      logger.info("hello");
      await logger.flush();

      expect(logger.enabled).toBe(false);

      logger.info("ignored");
      await logger.flush();
      expect(transport.batches).toHaveLength(1);
    });
  });

  describe("body limits", () => {
    it("splits a multi-byte batch over the body limit instead of losing it", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 202 }));
      vi.stubGlobal("fetch", fetchMock);
      const logger = createLoggerWith(
        {
          apiKey: SECRET_KEY,
          endpoint: "https://logs.example.com",
          batchSize: 100,
          transport: createHttpTransport({
            endpoint: "https://logs.example.com/api/v1/ingest",
            apiKey: SECRET_KEY,
            report: vi.fn(),
          }),
        },
        createTestAdapter(),
      );

      for (let index = 0; index < 25; index += 1) {
        logger.info(multiByteMessage(24_000));
      }
      await logger.flush();

      const bodies = fetchMock.mock.calls.map(
        (call) => (call[1] as { body: Uint8Array }).body,
      );
      expect(bodies.length).toBeGreaterThan(1);
      let delivered = 0;
      for (const body of bodies) {
        expect(body.length).toBeLessThanOrEqual(MAX_BODY_BYTES);
        delivered += (
          JSON.parse(new TextDecoder().decode(body)) as { events: unknown[] }
        ).events.length;
      }
      expect(delivered).toBe(25);
      expect(logger.stats.dropped).toBe(0);
      vi.unstubAllGlobals();
    });

    it("keeps every batch it hands the transport within the body limit", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { batchSize: 100 });

      for (let index = 0; index < 25; index += 1) {
        logger.info(multiByteMessage(24_000));
      }
      await logger.flush();

      for (const batch of transport.batches) {
        expect(jsonByteLength(batch)).toBeLessThanOrEqual(MAX_BODY_BYTES);
      }
      expect(transport.events).toHaveLength(25);
    });

    it("trims an oversized unload batch and requeues the remainder", async () => {
      const transport = createFakeTransport();
      let teardown: ((urgent: boolean) => void) | undefined;
      const logger = createLoggerWith(
        {
          apiKey: SECRET_KEY,
          transport,
          batchSize: 100,
          endpoint: "https://logs.example.com",
        },
        createTestAdapter({
          installLifecycle: (flush) => {
            teardown = flush;
            return () => {};
          },
        }),
      );

      for (let index = 0; index < 4; index += 1) {
        logger.info(multiByteMessage(24_000));
      }
      teardown?.(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(transport.batches).toHaveLength(1);
      expect(transport.events.length).toBeLessThan(4);
      expect(jsonByteLength(transport.batches[0])).toBeLessThanOrEqual(
        MAX_KEEPALIVE_BODY_BYTES,
      );
      expect(logger.stats.queued).toBe(4 - transport.events.length);
    });

    it("requeues an event the keepalive cap alone refused, and sends it on the next flush", async () => {
      // A tab switch fires the urgent path, not just a real unload. An event
      // between the 64 KiB keepalive cap and the server's 256 KiB limit must
      // survive it — destroying it would lose exactly the big, interesting
      // event someone will go looking for.
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 202 }));
      vi.stubGlobal("fetch", fetchMock);
      let teardown: ((urgent: boolean) => void) | undefined;
      const logger = createLoggerWith(
        {
          apiKey: SECRET_KEY,
          endpoint: "https://logs.example.com",
          transport: createHttpTransport({
            endpoint: "https://logs.example.com/api/v1/ingest",
            apiKey: SECRET_KEY,
            report: vi.fn(),
          }),
        },
        createTestAdapter({
          installLifecycle: (flush) => {
            teardown = flush;
            return () => {};
          },
        }),
      );

      const error = new Error("boom");
      error.stack = multiByteMessage(60_000);
      logger.capture({
        level: "error",
        message: multiByteMessage(24_000),
        error,
      });

      teardown?.(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(logger.stats.queued).toBe(1);
      expect(logger.stats.dropped).toBe(0);

      await logger.flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = (fetchMock.mock.calls[0]?.[1] as { body: Uint8Array }).body;
      expect(body.length).toBeGreaterThan(MAX_KEEPALIVE_BODY_BYTES);
      expect(body.length).toBeLessThanOrEqual(MAX_BODY_BYTES);
      expect(
        (
          JSON.parse(new TextDecoder().decode(body)) as {
            events: unknown[];
          }
        ).events,
      ).toHaveLength(1);
      expect(logger.stats.sent).toBe(1);
      expect(logger.stats.dropped).toBe(0);
      vi.unstubAllGlobals();
    });

    it("still discards an event no flush could ever carry", async () => {
      const transport = createFakeTransport();
      transport.respondWith({
        kind: "dropped",
        reason: "batch exceeded the body limit",
      });
      let teardown: ((urgent: boolean) => void) | undefined;
      const logger = createLoggerWith(
        {
          apiKey: SECRET_KEY,
          transport,
          endpoint: "https://logs.example.com",
        },
        createTestAdapter({
          installLifecycle: (flush) => {
            teardown = flush;
            return () => {};
          },
        }),
      );

      logger.info("too big for anything");
      teardown?.(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(logger.stats.queued).toBe(0);
      expect(logger.stats.dropped).toBe(1);
    });

    it("sends the unload batch even while an ordinary flush is still in flight", async () => {
      const transport = createGatedTransport();
      let teardown: ((urgent: boolean) => void) | undefined;
      const logger = createLoggerWith(
        {
          apiKey: SECRET_KEY,
          transport,
          batchSize: 100,
          endpoint: "https://logs.example.com",
        },
        createTestAdapter({
          installLifecycle: (flush) => {
            teardown = flush;
            return () => {};
          },
        }),
      );

      logger.info("ordinary");
      void logger.flush();
      await vi.advanceTimersByTimeAsync(0);
      expect(transport.sends).toHaveLength(1);

      logger.info("last words");
      teardown?.(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(transport.sends[1]).toEqual({ urgent: true, events: 1 });

      transport.release();
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  describe("configuration", () => {
    it("is inert, not fatal, when the key is wrong for the runtime", () => {
      const onError = vi.fn();
      const logger = createLoggerWith(
        { apiKey: PUBLIC_KEY, endpoint: "https://logs.example.com", onError },
        createTestAdapter(),
      );

      expect(logger.enabled).toBe(false);
      expect(() => {
        logger.info("hello");
      }).not.toThrow();
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("browser-only"),
        }),
        "logger.config",
      );
    });

    it("is inert when no endpoint can be resolved", () => {
      const onError = vi.fn();
      const logger = createLoggerWith(
        { apiKey: SECRET_KEY, onError },
        createTestAdapter(),
      );

      expect(logger.enabled).toBe(false);
      expect(onError).toHaveBeenCalledWith(expect.anything(), "logger.config");
    });

    it("can be switched off entirely", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport, { enabled: false });

      logger.info("hello");
      await logger.flush();

      expect(transport.batches).toHaveLength(0);
      expect(logger.enabled).toBe(false);
    });

    it("caps an absurd maxQueueSize instead of throwing out of createLogger", () => {
      const transport = createFakeTransport();

      let logger: Logger | undefined;
      expect(() => {
        logger = makeLogger(transport, { maxQueueSize: 1e10, batchSize: 100 });
      }).not.toThrow();

      // One more event than the ceiling: the queue was allocated at the
      // ceiling, so exactly one event is dropped.
      for (let index = 0; index <= 100_000; index += 1) logger?.info("x");

      expect(logger?.stats).toMatchObject({ queued: 100_000, dropped: 1 });
    });

    it("redacts an object logged as the message, as the console capture does", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport);

      logger.capture({
        level: "error",
        logger: "console",
        message: { password: "hunter2", user: "ada" },
      });
      await logger.flush();

      const [event] = transport.events;
      expect(event?.message).toContain("[redacted]");
      expect(event?.message).not.toContain("hunter2");
      expect(event?.logger).toBe("console");
    });

    it("goes inert after close", async () => {
      const transport = createFakeTransport();
      const logger = makeLogger(transport);

      logger.info("last words");
      await logger.close();

      expect(transport.events.map((event) => event.message)).toEqual([
        "last words",
      ]);
      expect(logger.enabled).toBe(false);
    });

    it("flushes when the host runtime tears down", async () => {
      const transport = createFakeTransport();
      let teardown: ((urgent: boolean) => void) | undefined;
      const logger = createLoggerWith(
        { apiKey: SECRET_KEY, transport, batchSize: 100 },
        createTestAdapter({
          installLifecycle: (flush) => {
            teardown = flush;
            return () => {};
          },
        }),
      );

      logger.info("before navigation");
      teardown?.(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(transport.events).toHaveLength(1);
    });
  });
});
