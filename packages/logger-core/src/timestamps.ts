import { MAX_CLOCK_SKEW_FUTURE_MS, MAX_CLOCK_SKEW_PAST_MS } from "./constants";

/**
 * Reconciliation of the untrusted client clock with the server's.
 *
 * A browser's clock can be wrong by years, be deliberately set forward to pin
 * an event to the top of every "latest" view, or be set back to bury it. Both
 * timestamps are therefore persisted: `receivedAt` is the server's own and is
 * always true, and the client `ts` is kept only within a plausible window
 * around it.
 */

/** What became of a client-supplied timestamp. */
export interface ClampedTimestamp {
  /** The timestamp to persist as the event's client-side time. */
  timestamp: Date;
  /** Whether the client value was outside the plausible window and replaced. */
  wasClamped: boolean;
}

/**
 * Clamps a client-supplied epoch-millisecond timestamp to a plausible window
 * around the server's receive time.
 *
 * Values more than {@link MAX_CLOCK_SKEW_FUTURE_MS} ahead of, or
 * {@link MAX_CLOCK_SKEW_PAST_MS} behind, `receivedAt` are replaced with
 * `receivedAt` outright rather than pinned to the window edge — a bogus clock
 * carries no information worth preserving, and the edge value would look like
 * a real reading.
 *
 * @param clientTs - Epoch milliseconds as reported by the client.
 * @param receivedAt - When the server received the batch.
 * @returns The timestamp to store and whether it was replaced.
 * @example
 * clampEventTimestamp(Date.now() + 5 * 365 * 86400_000, new Date());
 * // { timestamp: <receivedAt>, wasClamped: true }
 */
export function clampEventTimestamp(
  clientTs: number,
  receivedAt: Date,
): ClampedTimestamp {
  if (!Number.isFinite(clientTs)) {
    return { timestamp: receivedAt, wasClamped: true };
  }

  const receivedMs = receivedAt.getTime();
  const skew = clientTs - receivedMs;

  if (skew > MAX_CLOCK_SKEW_FUTURE_MS || skew < -MAX_CLOCK_SKEW_PAST_MS) {
    return { timestamp: receivedAt, wasClamped: true };
  }

  return { timestamp: new Date(clientTs), wasClamped: false };
}
