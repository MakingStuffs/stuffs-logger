import { afterEach, describe, expect, it, vi } from "vitest";

import {
  levelRank,
  MAX_EVENTS_PER_BATCH,
  MAX_SHORT_FIELD_LENGTH,
} from "../contract";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_ENVIRONMENT,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_MAX_QUEUE_SIZE,
} from "../defaults";
import { createTestAdapter } from "../testing/fixtures";
import { clampShort, MAX_QUEUE_SIZE_CEILING, resolveOptions } from "./options";

const adapter = createTestAdapter();

describe("clampShort", () => {
  it("trims and bounds a free-text field", () => {
    expect(clampShort("  staging  ")).toBe("staging");
    expect(clampShort("x".repeat(200))?.length).toBe(MAX_SHORT_FIELD_LENGTH);
  });

  it("treats an empty value as absent", () => {
    expect(clampShort("   ")).toBeUndefined();
    expect(clampShort(undefined)).toBeUndefined();
  });
});

describe("resolveOptions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to defaults for everything but the key", () => {
    vi.stubGlobal("process", { env: {} });

    expect(resolveOptions({}, adapter)).toMatchObject({
      source: "node",
      environment: DEFAULT_ENVIRONMENT,
      release: undefined,
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      maxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
    });
  });

  it("clamps a nonsensical batch size instead of refusing to start", () => {
    expect(resolveOptions({ batchSize: -5 }, adapter).batchSize).toBe(1);
    expect(resolveOptions({ batchSize: 10_000 }, adapter).batchSize).toBe(
      MAX_EVENTS_PER_BATCH,
    );
    expect(resolveOptions({ batchSize: Number.NaN }, adapter).batchSize).toBe(
      DEFAULT_BATCH_SIZE,
    );
  });

  it("keeps a queue of at least one event", () => {
    expect(resolveOptions({ maxQueueSize: 0 }, adapter).maxQueueSize).toBe(1);
  });

  it("caps the queue at the ceiling rather than allocating whatever was asked for", () => {
    expect(resolveOptions({ maxQueueSize: 1e10 }, adapter).maxQueueSize).toBe(
      MAX_QUEUE_SIZE_CEILING,
    );
  });

  it("allows a zero flush interval, which is not the same as absent", () => {
    expect(
      resolveOptions({ flushIntervalMs: 0 }, adapter).flushIntervalMs,
    ).toBe(0);
  });

  it("reads the environment when nothing is configured", () => {
    vi.stubGlobal("process", {
      env: {
        STUFFS_LOGGER_ENVIRONMENT: "staging",
        STUFFS_LOGGER_RELEASE: "abc123",
      },
    });

    expect(resolveOptions({}, adapter)).toMatchObject({
      environment: "staging",
      release: "abc123",
    });
  });

  it("prefers explicit options over the environment", () => {
    vi.stubGlobal("process", { env: { STUFFS_LOGGER_ENVIRONMENT: "staging" } });

    expect(resolveOptions({ environment: "prod" }, adapter).environment).toBe(
      "prod",
    );
  });

  it("resolves the minimum level to a comparable rank", () => {
    expect(resolveOptions({ minLevel: "warn" }, adapter).minRank).toBe(
      levelRank("warn"),
    );
  });

  it("allows enough flush passes to empty a full queue", () => {
    const { maxFlushPasses, maxQueueSize } = resolveOptions(
      { maxQueueSize: 1000 },
      adapter,
    );

    expect(maxFlushPasses * MAX_EVENTS_PER_BATCH).toBeGreaterThan(maxQueueSize);
  });

  it("takes the source from the runtime unless overridden", () => {
    expect(resolveOptions({ source: "browser" }, adapter).source).toBe(
      "browser",
    );
  });
});
