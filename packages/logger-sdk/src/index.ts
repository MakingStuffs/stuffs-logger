import { browserAdapter } from "./context/browser-adapter";
import { nodeAdapter } from "./context/node-adapter";
import { isBrowserRuntime } from "./context/runtime";
import { createLoggerWith } from "./logger/create-logger";
import type { Logger, LoggerOptions } from "./types";

/**
 * `@stuffs/logger` — the isomorphic entry point.
 *
 * Picks its runtime adapter when the logger is created, so the same import
 * works in a Next.js server component, a route handler and a client
 * component. Bundlers targeting the browser are steered to `./browser` by the
 * `browser` condition in this package's `exports`, which is smaller still;
 * import `./node` explicitly for a Node-only build.
 */

/**
 * Creates a logger for whichever runtime is executing.
 *
 * @param options - Configuration. Everything except the ingest key has a
 *   default, and the key itself falls back to `STUFFS_LOGGER_API_KEY` under Node.
 * @returns A logger. Misconfiguration produces an inert logger reported
 *   through `onError`, never a thrown error.
 * @example
 * const logger = createLogger({ apiKey: "slg_pub_…" });
 * logger.info("checkout started", { basketId });
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return createLoggerWith(
    options,
    isBrowserRuntime() ? browserAdapter : nodeAdapter,
  );
}

export * from "./public-api";
