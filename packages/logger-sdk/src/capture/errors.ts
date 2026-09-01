import { getProcess, isBrowserRuntime } from "../context/runtime";
import type { ProcessLike } from "../context/runtime";
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
 * - In Node, merely ADDING an `uncaughtException` listener disables the
 *   default crash — the process would keep running in an undefined state
 *   because a logging library attached a listener. `uncaughtExceptionMonitor`
 *   exists precisely for observers: it fires alongside the default handling
 *   and cannot suppress it, so that is what is used.
 *
 * `unhandledRejection` has no monitor variant and a listener does suppress
 * Node's default. Where this SDK is the ONLY listener, the default is
 * reinstated by rethrowing after capture; where the application has its own
 * listener, the application's behaviour already governs and nothing is
 * rethrown.
 */

/** Tuning for {@link captureErrors}. */
export interface ErrorCaptureOptions {
  /**
   * Preserve Node's default "crash on an unhandled rejection" behaviour by
   * rethrowing once the rejection has been captured, but only when this SDK is
   * the sole `unhandledRejection` listener. Defaults to `true`.
   */
  rethrowUnhandledRejections?: boolean;
}

/** Undoes a `captureErrors()` call. Safe to call more than once. */
export type RestoreErrorHandlers = () => void;

const noRestore: RestoreErrorHandlers = () => {};

let activeRestore: RestoreErrorHandlers | undefined;

function captureBrowserErrors(logger: Logger): RestoreErrorHandlers {
  const onError = (event: ErrorEvent): void => {
    logger.capture({
      level: "error",
      logger: "onerror",
      message: event.message || event.error,
      error: event.error,
      context: {
        filename: event.filename,
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
  rethrowRejections: boolean,
): RestoreErrorHandlers {
  const onUncaught = (error: unknown): void => {
    logger.capture({
      level: "fatal",
      logger: "uncaughtException",
      message: error,
      error,
    });
    void logger.flush();
  };

  const onRejection = (reason: unknown): void => {
    logger.capture({
      level: "error",
      logger: "unhandledrejection",
      message: reason,
      error: reason,
    });
    void logger.flush();

    const listenerCount = runtime.listeners?.("unhandledRejection").length ?? 0;
    if (rethrowRejections && listenerCount <= 1) {
      // Restores Node's default: an unhandled rejection becomes an uncaught
      // exception and the process exits, exactly as it would have without us.
      throw reason;
    }
  };

  runtime.on?.("uncaughtExceptionMonitor", onUncaught);
  runtime.on?.("unhandledRejection", onRejection);

  return () => {
    runtime.off?.("uncaughtExceptionMonitor", onUncaught);
    runtime.off?.("unhandledRejection", onRejection);
  };
}

/**
 * Reports uncaught errors and unhandled promise rejections to a logger.
 *
 * @param logger - Where the failures are sent.
 * @param options - Whether to preserve Node's default rejection behaviour.
 * @returns A disposer removing every handler installed. A second call while
 *   handlers are installed returns that same disposer.
 * @example
 * const restore = captureErrors(logger);
 */
export function captureErrors(
  logger: Logger,
  options: ErrorCaptureOptions = {},
): RestoreErrorHandlers {
  if (activeRestore) return activeRestore;

  const remove = isBrowserRuntime()
    ? captureBrowserErrors(logger)
    : nodeHandlers(logger, options);

  const restore: RestoreErrorHandlers = () => {
    remove();
    if (activeRestore === restore) activeRestore = undefined;
  };

  activeRestore = restore;
  return restore;
}

function nodeHandlers(
  logger: Logger,
  options: ErrorCaptureOptions,
): RestoreErrorHandlers {
  const runtime = getProcess();
  if (!runtime) return noRestore;
  return captureNodeErrors(
    logger,
    runtime,
    options.rethrowUnhandledRejections !== false,
  );
}
