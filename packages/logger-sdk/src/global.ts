import { captureConsole } from "./capture/console";
import { captureErrors } from "./capture/errors";
import { createLogger } from "./browser/index";
import { SDK_VERSION } from "./defaults";
import { createDiagnostics } from "./logger/no-throw";
import type { Logger, LoggerOptions, LogContext } from "./types";

/**
 * The `window.StuffsLogger` build, for pages with no build step at all.
 *
 * Two lines of HTML have to be enough here, so this entry point does what the
 * module entry points deliberately do not: it captures the console and the
 * global error handlers by default, and it will configure itself from
 * `data-*` attributes on its own `<script>` tag so a page can adopt logging
 * without writing any JavaScript.
 */

/** `init` options: logger configuration plus what to capture automatically. */
export interface InitOptions extends LoggerOptions {
  /** Patch `console.*`. Defaults to `true`. */
  captureConsole?: boolean;
  /** Report uncaught errors and rejections. Defaults to `true`. */
  captureErrors?: boolean;
}

let current: Logger | undefined;
let configured: InitOptions | undefined;

/**
 * Configures the global logger. Calling it again returns the existing logger
 * rather than building a second one; if the second call asked for a different
 * key or endpoint, its `onError` hook is told that the first configuration is
 * the one in effect.
 *
 * @param options - Logger configuration and capture switches.
 * @returns The global logger.
 * @example
 * StuffsLogger.init({ apiKey: "slg_pub_…" });
 */
export function init(options: InitOptions): Logger {
  if (current) {
    // Two copies of the snippet on one page is the usual cause, and the
    // second copy's key and endpoint silently never taking effect is the
    // kind of mistake that is only found when the logs are needed.
    if (
      options.apiKey !== configured?.apiKey ||
      options.endpoint !== configured?.endpoint
    ) {
      createDiagnostics(options.onError)(
        new Error(
          "StuffsLogger.init was called more than once; the first configuration is in effect",
        ),
        "logger.config",
      );
    }
    return current;
  }

  const logger = createLogger(options);
  current = logger;
  configured = options;

  if (options.captureConsole !== false) captureConsole(logger);
  if (options.captureErrors !== false) captureErrors(logger);

  return logger;
}

/** The logger created by {@link init}, if there is one. */
export function getLogger(): Logger | undefined {
  return current;
}

function forward(
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal",
) {
  return (message: unknown, context?: LogContext): void => {
    current?.capture({
      level,
      message,
      ...(context !== undefined && { context }),
    });
  };
}

/** Records a trace-level event. No-op until {@link init} has been called. */
export const trace = forward("trace");
/** Records a debug-level event. No-op until {@link init} has been called. */
export const debug = forward("debug");
/** Records an info-level event. No-op until {@link init} has been called. */
export const info = forward("info");
/** Alias of {@link info}. */
export const log = forward("info");
/** Records a warn-level event. No-op until {@link init} has been called. */
export const warn = forward("warn");
/** Records an error-level event. No-op until {@link init} has been called. */
export const error = forward("error");
/** Records a fatal-level event. No-op until {@link init} has been called. */
export const fatal = forward("fatal");

/** Sends everything queued. Resolves immediately when uninitialized. */
export function flush(): Promise<void> {
  return current?.flush() ?? Promise.resolve();
}

/** The version of this build, matching the `sdk.version` sent to ingest. */
export const version = SDK_VERSION;

export { captureConsole, captureErrors, createLogger };
export type { Logger, LoggerOptions } from "./types";

/**
 * Reads configuration off the `<script>` tag that loaded this build.
 *
 * `document.currentScript` is only meaningful while the script is executing,
 * which for an IIFE bundle is now — hence the top-level call below.
 *
 * The element is duck-typed on `dataset` rather than checked with
 * `instanceof HTMLScriptElement`: the constructor is not defined outside a
 * document, and `instanceof` evaluates it, so the check itself would throw in
 * a worker or any other DOM-less host that loads this file.
 */
function scriptOptions(): InitOptions | undefined {
  const dataset = globalThis.document?.currentScript?.dataset;
  const apiKey = dataset?.slgKey;
  if (!apiKey) return undefined;

  const { slgEndpoint, slgEnvironment, slgRelease } = dataset;

  return {
    apiKey,
    ...(slgEndpoint !== undefined && { endpoint: slgEndpoint }),
    ...(slgEnvironment !== undefined && { environment: slgEnvironment }),
    ...(slgRelease !== undefined && { release: slgRelease }),
  };
}

try {
  const inline = scriptOptions();
  if (inline) init(inline);
} catch {
  // Auto-configuration is a convenience. A host that cannot support it must
  // still finish loading the script so `StuffsLogger.init()` remains callable.
}
