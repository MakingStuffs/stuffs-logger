import { nodeAdapter } from "../context/node-adapter";
import { createLoggerWith } from "../logger/create-logger";
import type { Logger, LoggerOptions } from "../types";

/**
 * `@stuffs-logger/sdk/node` — the Node-only entry point.
 *
 * Identical API to `.`, minus the DOM support. Suited to servers, workers and
 * CLIs, where the ingest key must be a secret key and the endpoint has to be
 * configured rather than inferred from an origin.
 */

/**
 * Creates a logger bound to the Node runtime.
 *
 * @param options - Configuration; `apiKey` must be a `slg_sec_…` key and falls
 *   back to `STUFFS_LOGGER_API_KEY`, and `endpoint` falls back to
 *   `STUFFS_LOGGER_ENDPOINT`.
 * @returns A logger that never throws.
 * @example
 * const logger = createLogger(); // reads STUFFS_LOGGER_API_KEY / STUFFS_LOGGER_ENDPOINT
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return createLoggerWith(options, nodeAdapter);
}

export * from "../public-api";
