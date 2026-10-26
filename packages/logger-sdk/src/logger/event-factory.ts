import { LOGGER_KINDS } from "../contract";
import type { LoggerKind, LogEventPayload, LogLevel } from "../contract";
import type { ContextCollector } from "../context/collector";
import type { CaptureInput, LogContext } from "../types";
import type { Redactor } from "./redact";
import { redactUrl } from "./redact-url";
import {
  mergeContext,
  normalizeContext,
  serializeError,
  toMessage,
} from "./sanitize";

/**
 * One capture call in, one wire event out.
 *
 * Everything that decides WHAT is sent about an event lives here — the context
 * layering, the redaction of both context keys and url parameters, the
 * normalization of whatever the caller passed as a message or an error. The
 * logger itself is then left deciding WHEN things are sent, which is a
 * different problem with a different failure mode.
 *
 * Nothing here throws for any input: every step delegates to `./sanitize`,
 * which is total by construction.
 */

/** What the factory needs to describe an event. */
export interface EventFactoryOptions {
  /** Supplies the ambient url, user agent and context. */
  readonly collector: ContextCollector;
  /** Applied to context keys and url parameter names; `undefined` disables it. */
  readonly redactor: Redactor | undefined;
  /** The initial static context, merged into every event. */
  readonly context: LogContext | undefined;
}

/** Builds wire events, and holds the static context they are merged with. */
export interface EventFactory {
  /**
   * Describes one event.
   *
   * @param input - The caller's record.
   * @param level - The validated level for it.
   * @returns The event, within every field limit the contract sets.
   */
  build(input: CaptureInput, level: LogLevel): LogEventPayload;
  /** Replaces the static context merged into subsequent events. */
  setStaticContext(context: LogContext | undefined): void;
}

/**
 * Builds the event factory for one logger.
 *
 * @param options - Collector, redactor and initial static context.
 * @returns The factory.
 * @example
 * createEventFactory({ collector, redactor, context: { app: "web" } });
 */
export function createEventFactory(options: EventFactoryOptions): EventFactory {
  const { collector, redactor } = options;
  let staticContext = normalizeContext(options.context, redactor);

  return {
    build(input: CaptureInput, level: LogLevel): LogEventPayload {
      const collected = collector.collect();
      const context = mergeContext(
        collected.context,
        staticContext,
        normalizeContext(input.context, redactor),
      );
      const error = serializeError(input.error, redactor);
      const url =
        collected.url === undefined
          ? undefined
          : redactUrl(collected.url, redactor);

      return {
        ts: Date.now(),
        level,
        message: toMessage(input.message, redactor),
        // Validated like the level is: `logger` is a closed vocabulary on
        // the wire, and an unknown kind fails the batch, not just the event.
        logger: LOGGER_KINDS.includes(input.logger as LoggerKind)
          ? (input.logger as LoggerKind)
          : "manual",
        ...(context !== undefined && { context }),
        ...(error !== undefined && { error }),
        ...(url !== undefined && { url }),
        ...(collected.userAgent !== undefined && {
          userAgent: collected.userAgent,
        }),
      };
    },

    setStaticContext(context: LogContext | undefined): void {
      staticContext = normalizeContext(context, redactor);
    },
  };
}
