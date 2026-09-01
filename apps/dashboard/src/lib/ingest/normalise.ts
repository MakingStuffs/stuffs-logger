import {
  clampEventTimestamp,
  parseLogEvent,
  type IngestEnvelope,
  type IngestValidationIssue,
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
      message: event.message,
      logger: LOGGER_TO_DB[event.logger],
      context: event.context ?? undefined,
      environment: envelope.environment,
      release: envelope.release ?? null,
      source: SOURCE_TO_DB[envelope.source],
      sessionId: envelope.sessionId ?? null,
      url: event.url ?? null,
      userAgent: userAgent ?? null,
      deviceType: DEVICE_TO_DB[agent.deviceType],
      os: agent.os,
      browser: agent.browser,
      errorName: event.error?.name ?? null,
      errorMessage: event.error?.message ?? null,
      errorStack: event.error?.stack ?? null,
    });
  });

  return { rows, rejected, clampedCount };
}
