import { browserAdapter } from "../context/browser-adapter";
import { createLoggerWith } from "../logger/create-logger";
import type { Logger, LoggerOptions } from "../types";

/**
 * `@stuffs-logger/sdk/browser` — the browser-only entry point.
 *
 * Identical API to `.`, minus every byte of Node support. Import this from
 * code you know only ever runs in a document, or let the `browser` condition
 * in `exports` route you here automatically.
 */

/**
 * Creates a logger bound to the browser runtime.
 *
 * @param options - Configuration; `apiKey` must be a `slg_pub_…` key, and the
 *   endpoint defaults to the current origin.
 * @returns A logger that never throws.
 * @example
 * const logger = createLogger({ apiKey: "slg_pub_…" });
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return createLoggerWith(options, browserAdapter);
}

export * from "../public-api";
