import { z } from "zod";

import {
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_DEPTH,
  MAX_ERROR_NAME_LENGTH,
  MAX_ERROR_STACK_LENGTH,
  MAX_EVENTS_PER_BATCH,
  MAX_MESSAGE_LENGTH,
  MAX_SHORT_FIELD_LENGTH,
  MAX_URL_LENGTH,
  MAX_USER_AGENT_LENGTH,
} from "./constants";
import { jsonByteLength, jsonDepth } from "./json";
import { LOG_LEVELS, LOG_SOURCES, LOGGER_KINDS } from "./taxonomy";

/**
 * The ingest wire schema.
 *
 * Every object here is a `strictObject`: unknown keys are REJECTED, not
 * stripped. The ingest endpoint is public, so an accepted-but-ignored field is
 * a field a future version might start honouring for a caller who was never
 * meant to set it. Rejecting keeps the accepted shape exactly what is
 * documented.
 */

/** Milliseconds since the Unix epoch, as read from the untrusted client clock. */
const epochMillisSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const shortTextSchema = z.string().min(1).max(MAX_SHORT_FIELD_LENGTH);

/**
 * A free-form context bag.
 *
 * Bounded on both size and nesting: `MAX_CONTEXT_BYTES` stops a caller
 * inflating a row, and `MAX_CONTEXT_DEPTH` stops a deeply nested value from
 * turning every later `JSON.stringify` in the read path into a stack overflow.
 */
const contextSchema = z
  // `z.json()` rather than `z.unknown()`: the value is persisted into a JSONB
  // column, so the static type must actually be JSON-representable. With
  // `unknown` the compiler would happily accept a value the driver cannot
  // serialise, and the failure would surface at the database instead of here.
  .record(z.string(), z.json())
  .refine((value) => jsonDepth(value, MAX_CONTEXT_DEPTH) <= MAX_CONTEXT_DEPTH, {
    message: `context must not nest more than ${MAX_CONTEXT_DEPTH} levels deep`,
  })
  .refine((value) => jsonByteLength(value) <= MAX_CONTEXT_BYTES, {
    message: `context must serialise to at most ${MAX_CONTEXT_BYTES} bytes`,
  });

/** The serialised error attached to an event. */
export const logErrorSchema = z.strictObject({
  name: z.string().max(MAX_ERROR_NAME_LENGTH).optional(),
  message: z.string().max(MAX_MESSAGE_LENGTH).optional(),
  stack: z.string().max(MAX_ERROR_STACK_LENGTH).optional(),
});

/** A single log event within a batch. */
export const logEventSchema = z.strictObject({
  ts: epochMillisSchema,
  level: z.enum(LOG_LEVELS),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  logger: z.enum(LOGGER_KINDS),
  context: contextSchema.optional(),
  error: logErrorSchema.optional(),
  url: z.string().max(MAX_URL_LENGTH).optional(),
  userAgent: z.string().max(MAX_USER_AGENT_LENGTH).optional(),
});

/** Identifies the client library that produced a batch. */
export const sdkInfoSchema = z.strictObject({
  name: shortTextSchema,
  version: shortTextSchema,
});

/** The batch-level fields shared by every event in a request. */
const batchEnvelopeShape = {
  sdk: sdkInfoSchema,
  environment: shortTextSchema,
  release: shortTextSchema.optional(),
  source: z.enum(LOG_SOURCES),
  sessionId: shortTextSchema.optional(),
} as const;

/** The full `POST /api/v1/ingest` request body, events included. */
export const ingestBatchSchema = z.strictObject({
  ...batchEnvelopeShape,
  events: z.array(logEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

/**
 * The request body with its events left UNVALIDATED.
 *
 * The server validates the envelope with this and then each event on its own,
 * so one malformed line cannot discard the 99 good ones batched alongside it.
 * A logging client that drops a whole batch because of a single bad `context`
 * loses exactly the diagnostic data it exists to deliver. The envelope, by
 * contrast, is all-or-nothing: without a valid `source` or `environment` there
 * is nothing sensible to attribute any event to.
 */
export const ingestEnvelopeSchema = z.strictObject({
  ...batchEnvelopeShape,
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS_PER_BATCH),
});

/** A validated error payload. */
export type LogErrorPayload = z.infer<typeof logErrorSchema>;

/** A validated single event. */
export type LogEventPayload = z.infer<typeof logEventSchema>;

/** A validated SDK descriptor. */
export type SdkInfo = z.infer<typeof sdkInfoSchema>;

/** A validated ingest batch. */
export type IngestBatch = z.infer<typeof ingestBatchSchema>;

/** A validated batch envelope, whose `events` are still unvalidated. */
export type IngestEnvelope = z.infer<typeof ingestEnvelopeSchema>;

/** One field-level complaint about a rejected batch. */
export interface IngestValidationIssue {
  /** Dotted path to the offending field, e.g. `events.0.message`. */
  path: string;
  /** Human-readable explanation, safe to return to the caller. */
  message: string;
}

/** The outcome of validating an ingest batch. */
export type IngestBatchParseResult =
  | { ok: true; batch: IngestBatch }
  | { ok: false; issues: IngestValidationIssue[] };

/** The outcome of validating a batch envelope. */
export type IngestEnvelopeParseResult =
  | { ok: true; envelope: IngestEnvelope }
  | { ok: false; issues: IngestValidationIssue[] };

/** The outcome of validating a single event. */
export type LogEventParseResult =
  | { ok: true; event: LogEventPayload }
  | { ok: false; issues: IngestValidationIssue[] };

/** Cap on issues reported back, so a hostile payload cannot inflate the response. */
const MAX_REPORTED_ISSUES = 20;

/**
 * Validates an already-JSON-parsed ingest body.
 *
 * Shared by the SDK (to fail fast in development) and by the ingest route (as
 * the real boundary). Never throws — a hostile body is an expected input here,
 * not an exception.
 *
 * @param input - The parsed request body, untrusted.
 * @returns The validated batch, or the field-level issues that rejected it.
 * @example
 * const result = parseIngestBatch(await request.json());
 * if (!result.ok) return badRequest(result.issues);
 */
export function parseIngestBatch(input: unknown): IngestBatchParseResult {
  const parsed = ingestBatchSchema.safeParse(input);
  if (parsed.success) return { ok: true, batch: parsed.data };

  return { ok: false, issues: toIssues(parsed.error) };
}

/** Maps a zod error onto the capped, client-safe issue list. */
function toIssues(error: z.ZodError): IngestValidationIssue[] {
  return error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Validates the batch envelope, leaving `events` as raw `unknown` values.
 *
 * @param input - The parsed request body, untrusted.
 * @returns The validated envelope, or the issues that rejected it.
 */
export function parseIngestEnvelope(input: unknown): IngestEnvelopeParseResult {
  const parsed = ingestEnvelopeSchema.safeParse(input);
  if (parsed.success) return { ok: true, envelope: parsed.data };
  return { ok: false, issues: toIssues(parsed.error) };
}

/**
 * Validates one event from a batch.
 *
 * @param input - A single raw entry from `envelope.events`, untrusted.
 * @returns The validated event, or the issues that rejected it.
 */
export function parseLogEvent(input: unknown): LogEventParseResult {
  const parsed = logEventSchema.safeParse(input);
  if (parsed.success) return { ok: true, event: parsed.data };
  return { ok: false, issues: toIssues(parsed.error) };
}
