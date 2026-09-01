import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ConsoleCapture from "./console";
import type * as CreateLogger from "../logger/create-logger";
import type { ConsoleMethod, ConsoleWriter } from "../logger/original-console";
import {
  createFakeTransport,
  createTestAdapter,
  SECRET_KEY,
} from "../testing/fixtures";
import type { Logger } from "../types";

/**
 * `captureConsole` plus anything inside the SDK that writes to the console is
 * a feedback loop: the SDK's complaint about a failed send becomes an event,
 * whose send fails, which produces another complaint. These tests pin the
 * structural guard that makes it impossible rather than merely unlikely.
 *
 * The modules are imported per test because `original-console` snapshots the
 * console the first time it is loaded.
 */
describe("console capture and the SDK's own diagnostics", () => {
  let host: Record<ConsoleMethod, ConsoleWriter>;
  let captureConsole: typeof ConsoleCapture.captureConsole;
  let createLoggerWith: typeof CreateLogger.createLoggerWith;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    host = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    };
    vi.stubGlobal("console", host);
    ({ captureConsole } = await import("./console"));
    ({ createLoggerWith } = await import("../logger/create-logger"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function build(onError?: (error: unknown, context: string) => void): {
    logger: Logger;
    transport: ReturnType<typeof createFakeTransport>;
  } {
    const transport = createFakeTransport();
    const logger = createLoggerWith(
      {
        apiKey: SECRET_KEY,
        transport,
        batchSize: 1,
        ...(onError !== undefined && { onError }),
      },
      createTestAdapter(),
    );
    return { logger, transport };
  }

  it("does not capture a console call made by the transport itself", async () => {
    const { logger, transport } = build();
    transport.onSend(() => {
      console.error("transport had a problem");
    });
    captureConsole(logger);

    console.log("real application output");
    await vi.advanceTimersByTimeAsync(0);
    await logger.flush();

    const messages = transport.events.map((event) => event.message);
    expect(messages).toEqual(["real application output"]);
    expect(messages).not.toContain("transport had a problem");
  });

  it("does not capture a console call made by the onError hook", async () => {
    const { logger, transport } = build(() => {
      console.error("diagnostic");
    });
    transport.rejectWith(new Error("network down"));
    const originalError = host.error;
    captureConsole(logger);

    console.log("real application output");
    await logger.flush();

    expect(originalError).toHaveBeenCalled();
    expect(logger.stats.queued).toBeLessThanOrEqual(1);
  });

  it("settles instead of spinning when every send fails and is logged", async () => {
    const { logger, transport } = build(() => {
      console.error("send failed");
    });
    transport.rejectWith(new Error("network down"));
    captureConsole(logger);

    console.log("first");
    await vi.advanceTimersByTimeAsync(600000);

    expect(transport.batches.length).toBeLessThan(20);
  });
});
