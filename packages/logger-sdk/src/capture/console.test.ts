import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ConsoleCapture from "./console";
import type { ConsoleMethod, ConsoleWriter } from "../logger/original-console";
import type { CaptureInput, Logger } from "../types";

/**
 * `original-console` snapshots the console when it is first imported, so a
 * spy installed afterwards would never be seen. Each test therefore resets the
 * module registry, stubs the console, and only then imports the subject.
 */

interface RecordingLogger extends Logger {
  readonly captured: CaptureInput[];
}

function createRecordingLogger(): RecordingLogger {
  const captured: CaptureInput[] = [];
  const noop = (): void => {};

  return {
    captured,
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

describe("captureConsole", () => {
  let host: Record<ConsoleMethod, ConsoleWriter>;
  let subject: typeof ConsoleCapture;
  let logger: RecordingLogger;

  beforeEach(async () => {
    vi.resetModules();
    host = {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    };
    vi.stubGlobal("console", host);
    subject = await import("./console");
    logger = createRecordingLogger();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("still calls the original console method", () => {
    const original = host.log;
    subject.captureConsole(logger);

    console.log("hello", 1);

    expect(original).toHaveBeenCalledWith("hello", 1);
  });

  it("calls the original even though it also logs", () => {
    const original = host.error;
    subject.captureConsole(logger);

    console.error("boom");

    expect(original).toHaveBeenCalledWith("boom");
    expect(logger.captured).toHaveLength(1);
  });

  it("maps each console method onto a severity", () => {
    subject.captureConsole(logger);

    console.log("a");
    console.info("b");
    console.warn("c");
    console.error("d");
    console.debug("e");
    console.trace("f");

    expect(logger.captured.map((entry) => entry.level)).toEqual([
      "info",
      "info",
      "warn",
      "error",
      "debug",
      "trace",
    ]);
  });

  it("attributes captured events to the console", () => {
    subject.captureConsole(logger);

    console.warn("slow");

    expect(logger.captured[0]?.logger).toBe("console");
  });

  it("keeps the remaining arguments as context", () => {
    subject.captureConsole(logger);

    console.info("query", { ms: 900 }, "extra");

    expect(logger.captured[0]).toMatchObject({
      message: "query",
      context: { arguments: [{ ms: 900 }, "extra"] },
    });
  });

  it("promotes an Error argument to the structured error", () => {
    const failure = new Error("nope");
    subject.captureConsole(logger);

    console.error("request failed", failure);

    expect(logger.captured[0]?.error).toBe(failure);
  });

  it("does not patch twice", () => {
    subject.captureConsole(logger);
    const patched = host.log;
    subject.captureConsole(logger);

    expect(console.log).toBe(patched);

    console.log("once");
    expect(logger.captured).toHaveLength(1);
  });

  it("returns the same disposer for a repeat call", () => {
    const first = subject.captureConsole(logger);
    const second = subject.captureConsole(logger);

    expect(second).toBe(first);
  });

  it("restores the original methods", () => {
    const originals = { ...host };

    const restore = subject.captureConsole(logger);
    restore();

    expect(console.log).toBe(originals.log);
    expect(console.error).toBe(originals.error);

    console.log("after restore");
    expect(logger.captured).toHaveLength(0);
  });

  it("can be installed again after being restored", () => {
    subject.captureConsole(logger)();
    subject.captureConsole(logger);

    console.log("second run");

    expect(logger.captured).toHaveLength(1);
  });

  it("leaves a method someone else patched afterwards alone", () => {
    const restore = subject.captureConsole(logger);
    const foreign = vi.fn();
    console.log = foreign;

    restore();

    expect(console.log).toBe(foreign);
  });

  it("patches only the methods asked for", () => {
    const originals = { ...host };
    subject.captureConsole(logger, { methods: ["error"] });

    expect(console.log).toBe(originals.log);
    expect(console.error).not.toBe(originals.error);
  });

  it("honours a severity override", () => {
    subject.captureConsole(logger, { levels: { log: "debug" } });

    console.log("quiet");

    expect(logger.captured[0]?.level).toBe("debug");
  });

  it("skips a method a frozen console will not let it replace", () => {
    const originals = { ...host };
    Object.freeze(host);

    let restore: (() => void) | undefined;
    expect(() => {
      restore = subject.captureConsole(logger);
    }).not.toThrow();

    expect(console.log).toBe(originals.log);
    console.log("still prints, never captured");
    expect(logger.captured).toHaveLength(0);
    expect(() => restore?.()).not.toThrow();
  });

  it("ignores a method name that is not a console method", () => {
    // `toString` is a function on the snapshot's prototype; without the
    // check it would be found there and patched onto the console.
    expect(() => {
      subject.captureConsole(logger, {
        methods: ["toString" as never, "error"],
      });
    }).not.toThrow();

    expect(Object.hasOwn(host, "toString")).toBe(false);
    console.error("still captured");
    expect(logger.captured).toHaveLength(1);
  });
});
