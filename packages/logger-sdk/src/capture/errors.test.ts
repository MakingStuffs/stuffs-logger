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
  emit: (event: string, ...args: unknown[]) => void;
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
    emit(event, ...args) {
      for (const listener of registered.get(event) ?? []) listener(...args);
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

  it("installs no rejection listener, so the process's --unhandled-rejections mode still applies", () => {
    captureErrors(logger);

    expect(runtime.listeners("unhandledRejection")).toHaveLength(0);
  });

  it("records an uncaught exception as fatal", () => {
    captureErrors(logger);
    const failure = new Error("catastrophe");

    runtime.emit("uncaughtExceptionMonitor", failure, "uncaughtException");

    expect(captured[0]).toMatchObject({
      level: "fatal",
      logger: "uncaughtException",
      error: failure,
    });
  });

  it("classifies a rejection Node is raising as an uncaught exception", () => {
    captureErrors(logger);
    const reason = new Error("rejected");

    runtime.emit("uncaughtExceptionMonitor", reason, "unhandledRejection");

    expect(captured[0]).toMatchObject({
      level: "fatal",
      logger: "unhandledrejection",
      error: reason,
    });
  });

  it("records a rejection once, not once per listener", () => {
    captureErrors(logger);

    runtime.emit(
      "uncaughtExceptionMonitor",
      new Error("rejected"),
      "unhandledRejection",
    );

    expect(captured).toHaveLength(1);
  });

  it("does not install handlers twice", () => {
    captureErrors(logger);
    captureErrors(logger);

    expect(runtime.listeners("uncaughtExceptionMonitor")).toHaveLength(1);
  });

  it("removes every handler it installed", () => {
    captureErrors(logger)();

    expect(runtime.listeners("uncaughtExceptionMonitor")).toHaveLength(0);
  });
});
