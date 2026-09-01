import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ErrorCapture from "./errors";
import type { CaptureInput, Logger } from "../types";

/**
 * Node-side error capture. `process` is stubbed rather than used, so the suite
 * never installs a real `uncaughtException` handler on the test runner.
 */

type Listener = (...args: unknown[]) => void;

interface FakeProcess {
  on: (event: string, listener: Listener) => void;
  off: (event: string, listener: Listener) => void;
  listeners: (event: string) => Listener[];
  emit: (event: string, payload: unknown) => void;
  registered: Map<string, Listener[]>;
}

function createFakeProcess(): FakeProcess {
  const registered = new Map<string, Listener[]>();

  return {
    registered,
    on(event, listener) {
      registered.set(event, [...(registered.get(event) ?? []), listener]);
    },
    off(event, listener) {
      registered.set(
        event,
        (registered.get(event) ?? []).filter((entry) => entry !== listener),
      );
    },
    listeners: (event) => registered.get(event) ?? [],
    emit(event, payload) {
      for (const listener of registered.get(event) ?? []) listener(payload);
    },
  };
}

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

describe("captureErrors in Node", () => {
  let runtime: FakeProcess;
  let captured: CaptureInput[];
  let logger: Logger;
  let captureErrors: typeof ErrorCapture.captureErrors;

  beforeEach(async () => {
    vi.resetModules();
    runtime = createFakeProcess();
    vi.stubGlobal("process", runtime);
    vi.stubGlobal("window", undefined);
    captured = [];
    logger = createRecordingLogger(captured);
    ({ captureErrors } = await import("./errors"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("observes uncaught exceptions without disabling the default crash", () => {
    captureErrors(logger);

    expect(runtime.listeners("uncaughtExceptionMonitor")).toHaveLength(1);
    expect(runtime.listeners("uncaughtException")).toHaveLength(0);
  });

  it("records an uncaught exception as fatal", () => {
    captureErrors(logger);
    const failure = new Error("catastrophe");

    runtime.emit("uncaughtExceptionMonitor", failure);

    expect(captured[0]).toMatchObject({
      level: "fatal",
      logger: "uncaughtException",
      error: failure,
    });
  });

  it("records an unhandled rejection", () => {
    captureErrors(logger, { rethrowUnhandledRejections: false });
    const reason = new Error("rejected");

    runtime.emit("unhandledRejection", reason);

    expect(captured[0]).toMatchObject({
      level: "error",
      logger: "unhandledrejection",
      error: reason,
    });
  });

  it("preserves the default crash when it is the only rejection listener", () => {
    captureErrors(logger);
    const reason = new Error("rejected");

    expect(() => {
      runtime.emit("unhandledRejection", reason);
    }).toThrow(reason);
  });

  it("defers to the application's own rejection handling", () => {
    runtime.on("unhandledRejection", () => {});
    captureErrors(logger);

    expect(() => {
      runtime.emit("unhandledRejection", new Error("rejected"));
    }).not.toThrow();
  });

  it("does not install handlers twice", () => {
    captureErrors(logger);
    captureErrors(logger);

    expect(runtime.listeners("uncaughtExceptionMonitor")).toHaveLength(1);
  });

  it("removes every handler it installed", () => {
    captureErrors(logger)();

    expect(runtime.listeners("uncaughtExceptionMonitor")).toHaveLength(0);
    expect(runtime.listeners("unhandledRejection")).toHaveLength(0);
  });
});
