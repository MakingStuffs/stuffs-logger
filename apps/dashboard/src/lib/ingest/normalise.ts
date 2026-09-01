import {
  clampEventTimestamp,
  parseLogEvent,
  redactJson,
  sanitiseJsonText,
  sanitiseLogText,
  sanitiseOptionalLogText,
  type IngestEnvelope,
  type IngestValidationIssue,
  type JsonValue,
  type LogEventPayload,
} from "@jf-logger/core";
import type { Prisma } from "@prisma/client";

import {
  DEVICE_TO_DB,
  LEVEL_TO_DB,
  LOGGER_TO_DB,
  SOURCE_TO_DB,
} from "@/lib/logs/enums";

import { parseUserAgent } from "./user-agent";

/**
 * Turning a validated envelope plus its raw events into database rows.
 *
 * Events are validated ONE AT A TIME here rather than as an array, so a single
 * malformed line is dropped and reported instead of discarding the whole
 * batch. A logging product that throws away 99 good events because the 100th
 * had a bad `context` fails at the one job it has.
 *
 * Two transforms are applied to every accepted event before it becomes a row,
 * and neither is optional:
 *
 *  - **Redaction.** Secret-shaped context keys are replaced with the shared
 *    marker from `@jf-logger/core`. The SDK redacts too, but that pass is the
 *    caller's to configure — `redaction: { enabled: false }` switches it off,
 *    and anyone POSTing to the ingest endpoint with a scraped key never ran it
 *    at all. THIS pass is the authoritative one: it runs on every batch, it
 *    uses the server's key list, and nothing in the request can disable it.
 *  - **Text sanitisation.** Control characters, ANSI escapes and bidi
 *    overrides are stripped from every stored string. Inert in React today;
 *    not inert in a terminal tail, a CSV export, or the dashboard's own
 *    rendering of a right-to-left override.
 */

/** What the caller is told about an event that did not make it. */
export interface RejectedEvent {
  /** Index of the event within the submitted `events` array. */
  index: number;
  /** Why it was rejected, field by field. Safe to return. */
  issues: IngestValidationIssue[];
}

/** The result of normalising a batch. */
export interface NormalisedBatch {
  /** Rows ready to insert. */
  rows: Prisma.LogEventCreateManyInput[];
  /** Events that failed validation, with their positions. */
  rejected: RejectedEvent[];
  /** How many accepted events had an implausible client clock. */
  clampedCount: number;
}

/** Inputs that come from the request rather than the batch body. */
export interface NormaliseContext {
  /** The application the verified key belongs to — NEVER taken from the body. */
  applicationId: string;
  /** The server's receipt time, shared by every row in the batch. */
  receivedAt: Date;
  /**
   * The request's own `User-Agent` header, used when an event does not carry
   * one. The header is no more trustworthy than the body, but it is the value
   * a browser sets automatically and the SDK does not have to duplicate.
   */
  fallbackUserAgent: string | null;
}

/**
 * Redacts and sanitises a validated event's context.
 *
 * Redaction runs FIRST: sanitising a key could in principle change how it
 * matches, and the credential-bearing decision must be made on the key the
 * caller actually sent.
 *
 * @param context - The validated context, or undefined when absent.
 * @returns The storable context, or undefined.
 */
function prepareContext(
  context: LogEventPayload["context"],
): Record<string, JsonValue> | undefined {
  if (context === undefined) return undefined;

  const prepared = sanitiseJsonText(redactJson(context));

  // The input was validated as an object, so both transforms return one. The
  // narrowing is here rather than asserted, because the column is typed
  // `Json?` and a scalar would be silently storable.
  return typeof prepared === "object" &&
    prepared !== null &&
    !Array.isArray(prepared)
    ? prepared
    : undefined;
}

/**
 * Validates and converts a batch into insertable rows.
 *
 * @param envelope - The already-validated batch envelope.
 * @param context - Request-derived values that override anything in the body.
 * @returns The rows to insert, the rejected events, and the clamp count.
 */
export function normaliseBatch(
  envelope: IngestEnvelope,
  context: NormaliseContext,
): NormalisedBatch {
  const rows: Prisma.LogEventCreateManyInput[] = [];
  const rejected: RejectedEvent[] = [];
  let clampedCount = 0;

  envelope.events.forEach((raw, index) => {
    const parsed = parseLogEvent(raw);
    if (!parsed.ok) {
      rejected.push({ index, issues: parsed.issues });
      return;
    }

    const event = parsed.event;
    const { timestamp, wasClamped } = clampEventTimestamp(
      event.ts,
      context.receivedAt,
    );
    if (wasClamped) clampedCount += 1;

    const userAgent = event.userAgent ?? context.fallbackUserAgent;
    const agent = parseUserAgent(userAgent);

    rows.push({
      // Every field below is either derived server-side or came from the
      // validated event. `applicationId` in particular comes from the verified
      // KEY, never from the body — a caller must not be able to write into
      // another application by naming it.
      applicationId: context.applicationId,
      timestamp,
      receivedAt: context.receivedAt,
      level: LEVEL_TO_DB[event.level],
      message: sanitiseLogText(event.message),
      logger: LOGGER_TO_DB[event.logger],
      context: prepareContext(event.context),
      environment: envelope.environment,
      release: envelope.release ?? null,
      source: SOURCE_TO_DB[envelope.source],
      sessionId: envelope.sessionId ?? null,
      url: sanitiseOptionalLogText(event.url),
      userAgent: sanitiseOptionalLogText(userAgent),
      deviceType: DEVICE_TO_DB[agent.deviceType],
      os: agent.os,
      browser: agent.browser,
      errorName: sanitiseOptionalLogText(event.error?.name),
      errorMessage: sanitiseOptionalLogText(event.error?.message),
      errorStack: sanitiseOptionalLogText(event.error?.stack),
    });
  });

  return { rows, rejected, clampedCount };
}
