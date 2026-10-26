import { readEnv } from "../context/runtime";
import type { LogSource } from "../contract";
import type { DiagnosticHandler, LoggerOptions, Transport } from "../types";
import { checkCredential } from "./credentials";
import { resolveEndpoint } from "./endpoint";
import { createHttpTransport } from "./transport";

/**
 * Deciding what, if anything, this logger can talk to.
 *
 * Both ways of failing here — a key that is wrong for the runtime, an endpoint
 * that cannot be worked out — are configuration mistakes, and both produce an
 * inert logger plus a diagnostic rather than an exception. An application must
 * not fail to boot because its logging is misconfigured.
 */

/** Environment variable consulted when no `apiKey` option is given. */
const API_KEY_ENV_VAR = "STUFFS_LOGGER_API_KEY";

/**
 * Builds the transport a logger will use.
 *
 * @param options - Caller configuration; an injected `transport` wins outright.
 * @param source - The runtime the key must be valid for.
 * @param report - Where a configuration failure is announced.
 * @returns The transport, or `undefined` when the logger must stay inert.
 * @example
 * resolveTransport({ apiKey: "slg_pub_…" }, "browser", report);
 */
export function resolveTransport(
  options: LoggerOptions,
  source: LogSource,
  report: DiagnosticHandler,
): Transport | undefined {
  if (options.transport) return options.transport;

  const credential = checkCredential(
    options.apiKey ?? readEnv(API_KEY_ENV_VAR),
    source,
  );
  if (!credential.ok) {
    report(new Error(credential.reason), "logger.config");
    return undefined;
  }

  const endpoint = resolveEndpoint(options.endpoint, report);
  if (!endpoint) {
    report(new Error("no ingest endpoint could be resolved"), "logger.config");
    return undefined;
  }

  return createHttpTransport({ endpoint, apiKey: credential.apiKey, report });
}
