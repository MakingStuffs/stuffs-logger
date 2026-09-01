import { jsonByteLength, MAX_BODY_BYTES } from "../contract";
import type { LogEventPayload } from "../contract";
import { MAX_KEEPALIVE_BODY_BYTES } from "../defaults";

/**
 * How many events may travel in one request.
 *
 * The wire contract bounds a batch two ways: by event count, which the queue
 * enforces, and by the UTF-8 BYTE size of the request body, which nothing but
 * measurement can enforce. A UTF-16 length is not that measurement — one CJK
 * code unit is three UTF-8 bytes — so a batch counted in code units can be
 * three times the server's limit and still look legal. The server then answers
 * `413`, which the transport can only treat as "this batch is condemned".
 *
 * Splitting here instead means an over-large batch costs an extra request, not
 * the events.
 */

/**
 * Fraction of the hard limit a batch is allowed to fill.
 *
 * The reserve covers the batch envelope (`sdk`, `environment`, `release`,
 * `sessionId`), which is measured by the server but not by the estimate below.
 */
const BODY_SAFETY_FACTOR = 0.9;

/**
 * How many times the fit is re-estimated before giving up and sending one
 * event. Each pass measures once and shrinks by at least one event, so the
 * work is bounded no matter how uneven the events are.
 */
const MAX_FIT_ATTEMPTS = 6;

/**
 * The byte budget for one request.
 *
 * @param urgent - Whether this is the unload path, which browsers cap far
 *   below the server's limit.
 * @returns The maximum bytes the events of one batch may occupy.
 * @example
 * batchByteBudget(true); // 58982
 */
export function batchByteBudget(urgent: boolean): number {
  const limit = urgent ? MAX_KEEPALIVE_BODY_BYTES : MAX_BODY_BYTES;
  return Math.floor(limit * BODY_SAFETY_FACTOR);
}

/**
 * How many of `events`, taken from the front, fit inside a byte budget.
 *
 * Estimated from whole-batch measurements rather than by measuring every event
 * on its own: on the unload path this runs while the document is being torn
 * down, and a per-event walk would spend the little time left on arithmetic.
 *
 * @param events - The candidate batch, oldest first.
 * @param budget - The maximum UTF-8 byte size of the JSON for the result.
 * @returns The number of leading events to send. At least 1 whenever `events`
 *   is non-empty, so a caller splitting a queue always makes progress.
 * @example
 * countWithinByteBudget(events, batchByteBudget(false));
 */
export function countWithinByteBudget(
  events: readonly LogEventPayload[],
  budget: number,
): number {
  if (events.length === 0) return 0;

  let count = events.length;

  for (let attempt = 0; attempt < MAX_FIT_ATTEMPTS; attempt += 1) {
    if (count <= 1) return 1;

    const bytes = measure(events, count);
    if (bytes <= budget) return count;

    const estimate = Math.floor((budget * count) / bytes);
    count = Math.max(1, Math.min(count - 1, estimate));
  }

  // Wildly uneven event sizes. One event always fits the server's limit, and
  // on the keepalive path the transport refuses what is still too big.
  return 1;
}

function measure(events: readonly LogEventPayload[], count: number): number {
  return jsonByteLength(
    count === events.length ? events : events.slice(0, count),
  );
}
