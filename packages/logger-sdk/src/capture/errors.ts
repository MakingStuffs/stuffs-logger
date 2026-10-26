import { getProcess, isBrowserRuntime } from "../context/runtime";
import type { ProcessLike } from "../context/runtime";
import { createRedactor } from "../logger/redact";
import type { Redactor } from "../logger/redact";
import { redactUrl } from "../logger/redact-url";
import type { Logger } from "../types";

/**
 * Reporting the failures nobody caught.
 *
 * The governing constraint is that observing a crash must not change it. Both
 * runtimes have a trap here:
 *
 * - In the browser, calling `preventDefault()` on an `error` or
 *   `unhandledrejection` event suppresses the console output the developer
 *   expects. Nothing here does.
 * - In Node, merely ADDING an `uncaughtException` or `unhandledRejection`
 *   listener changes what the process does: the default crash is disabled,
 *   and for rejections the `--unhandled-rejections` mode the operator chose
 *   stops applying. `uncaughtExceptionMonitor` exists precisely for
 *   observers — it fires alongside the default handling and cannot suppress
 *   it — and its `origin` argument says whether the exception began as a
 *   throw or as a rejection nothing handled. That one listener is the whole
 *   Node side: a rejection is seen exactly once, as the exception Node is
 *   about to raise it as, never through a listener of its own.
 */

/** Undoes a `captureErrors()` call. Safe to call more than once. */
export type RestoreErrorHandlers = () => void;

const noRestore: RestoreErrorHandlers = () => {};

let activeRestore: RestoreErrorHandlers | undefined;

/**
 * Built once, lazily, for the failing script's url. This capture has no
 * handle on the logger's redaction configuration, and a script url is still a
 * url: the built-in list is the floor the server applies to it anyway.
 */
let defaultRedactor: Redactor | undefined;

function captureBrowserErrors(logger: Logger): RestoreErrorHandlers {
  const onError = (event: ErrorEvent): void => {
    logger.capture({
      level: "error",
      logger: "onerror",
      message: event.message || event.error,
      error: event.error,
      context: {
        filename: redactUrl(
          event.filename,
          (defaultRedactor ??= createRedactor(undefined)),
        ),
        line: event.lineno,
        column: event.colno,
      },
    });
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    logger.capture({
      level: "error",
      logger: "unhandledrejection",
      message: event.reason,
      error: event.reason,
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

function captureNodeErrors(
  logger: Logger,
  runtime: ProcessLike,
): RestoreErrorHandlers {
  const onUncaught = (error: unknown, origin: unknown): void => {
    // `origin` is `"uncaughtException"` or `"unhandledRejection"`. Either
    // way Node is raising it as an uncaught exception, so both are fatal;
    // the kind records which path it arrived by.
    logger.capture({
      level: "fatal",
      logger:
        origin === "unhandledRejection"
          ? "unhandledrejection"
          : "uncaughtException",
      message: error,
      error,
    });
    void logger.flush();
  };

  runtime.on?.("uncaughtExceptionMonitor", onUncaught);

  return () => {
    runtime.off?.("uncaughtExceptionMonitor", onUncaught);
  };
}

/**
 * Reports uncaught errors and unhandled promise rejections to a logger.
 *
 * @param logger - Where the failures are sent.
 * @returns A disposer removing every handler installed. A second call while
 *   handlers are installed returns that same disposer.
 * @example
 * const restore = captureErrors(logger);
 */
export function captureErrors(logger: Logger): RestoreErrorHandlers {
  if (activeRestore) return activeRestore;

  const remove = isBrowserRuntime()
    ? captureBrowserErrors(logger)
    : nodeHandlers(logger);

  const restore: RestoreErrorHandlers = () => {
    remove();
    if (activeRestore === restore) activeRestore = undefined;
  };

  activeRestore = restore;
  return restore;
}

function nodeHandlers(logger: Logger): RestoreErrorHandlers {
  const runtime = getProcess();
  if (!runtime) return noRestore;
  return captureNodeErrors(logger, runtime);
}
