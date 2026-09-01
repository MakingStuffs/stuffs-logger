/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ErrorCapture from "./errors";
import type { CaptureInput, Logger } from "../types";

function createRecordingLogger(captured: CaptureInput[]): Logger {
  const noop = (): void => {};
  return {
    capture: (input) => {
      captured.push(input);
    },
    trace: noop,
    debug: noop,
    info: noop,
    log: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
    setContext: noop,
    stats: { queued: 0, dropped: 0, sent: 0, failed: 0 },
    enabled: true,
  };
}

describe("captureErrors in the browser", () => {
  let captured: CaptureInput[];
  let logger: Logger;
  let captureErrors: typeof ErrorCapture.captureErrors;
  let restore: () => void;

  beforeEach(async () => {
    vi.resetModules();
    captured = [];
    logger = createRecordingLogger(captured);
    ({ captureErrors } = await import("./errors"));
    restore = captureErrors(logger);
  });

  afterEach(() => {
    restore();
  });

  it("records a window error", () => {
    const failure = new Error("render failed");

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "render failed",
        filename: "https://example.com/app.js",
        lineno: 12,
        colno: 4,
        error: failure,
      }),
    );

    expect(captured[0]).toMatchObject({
      level: "error",
      logger: "onerror",
      error: failure,
      context: {
        filename: "https://example.com/app.js",
        line: 12,
        column: 4,
      },
    });
  });

  it("records an unhandled rejection", () => {
    const reason = new Error("api call failed");
    const event = Object.assign(new Event("unhandledrejection"), { reason });

    window.dispatchEvent(event);

    expect(captured[0]).toMatchObject({
      level: "error",
      logger: "unhandledrejection",
      error: reason,
    });
  });

  it("does not cancel the event, so the browser still reports it", () => {
    const event = new ErrorEvent("error", {
      message: "boom",
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("stops recording once restored", () => {
    restore();

    window.dispatchEvent(new ErrorEvent("error", { message: "after" }));

    expect(captured).toHaveLength(0);
  });
});
