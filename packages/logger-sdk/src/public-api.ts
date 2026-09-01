/**
 * The surface every entry point shares.
 *
 * `.`, `./browser` and `./node` differ in exactly one thing: which runtime
 * adapter their `createLogger` is bound to. Re-exporting the rest from here
 * keeps the three entry files to that single difference, so the public API
 * cannot drift between them.
 */

export { LOG_LEVELS } from "./contract";
export type { LoggerKind, LogLevel, LogSource } from "./contract";

export { SDK_NAME, SDK_VERSION } from "./defaults";

export { captureConsole, DEFAULT_CONSOLE_LEVELS } from "./capture/console";
export type { ConsoleCaptureOptions, RestoreConsole } from "./capture/console";

export { captureErrors } from "./capture/errors";
export type {
  ErrorCaptureOptions,
  RestoreErrorHandlers,
} from "./capture/errors";

export type { ConsoleMethod } from "./logger/original-console";
export { DEFAULT_REDACTION_KEYS } from "./logger/redact";

export type {
  CaptureInput,
  DiagnosticHandler,
  JsonObject,
  LogContext,
  Logger,
  LoggerOptions,
  LoggerStats,
  RedactionOptions,
  RedactionPattern,
  Transport,
  TransportOutcome,
  TransportRequest,
} from "./types";
