import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_EVENTS_PER_BATCH } from "../contract";
import type { ContextCollector } from "../context/collector";
import {
  createFakeTransport,
  createTestAdapter,
  PUBLIC_KEY,
  SECRET_KEY,
} from "../testing/fixtures";
import type { FakeTransport } from "../testing/fixtures";
import { createLoggerWith } from "./create-logger";
import type { Logger, LoggerOptions } from "../types";

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
        sdk: { name: "@jf-logger/sdk", version: expect.any(String) },
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
