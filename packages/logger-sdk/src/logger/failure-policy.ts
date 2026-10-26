import { MAX_EVENTS_PER_BATCH } from "../contract";
import {
  MAX_RETRY_DELAY_MS,
  MAX_SEND_ATTEMPTS,
  MIN_RETRY_DELAY_MS,
} from "../defaults";

/**
 * What the logger does about a send that did not succeed.
 *
 * Kept apart from the flush machinery because it is a policy, not a mechanism:
 * how long to wait, how many events to risk on the next attempt, and when to
 * stop paying for a batch that will never land. All of it is decided from
 * counters, so it can be reasoned about — and tested — without a queue, a
 * transport or a clock.
 */

/** What to do with the batch that just failed. */
export interface FailureDecision {
  /** Whether the events are worth another attempt. */
  readonly requeue: boolean;
  /** How long to wait before the next attempt. */
  readonly retryInMs: number;
}

/** The retry and backoff state of one logger. */
export interface FailurePolicy {
  /**
   * How many events the next attempt may carry. Drops to one while the
   * endpoint is failing, so an outage costs a probe rather than a batch.
   */
  readonly eventsPerAttempt: number;
  /**
   * How long an ordinary send must still wait.
   *
   * @param now - The current epoch time in milliseconds.
   * @returns Milliseconds remaining, or `0` when a send may go out.
   */
  waitMs(now: number): number;
  /** Clears the backoff after a batch lands. */
  recordSuccess(): void;
  /**
   * Registers a failed attempt and decides what happens next.
   *
   * @param retryAfterMs - A server-supplied delay, when there was one.
   * @param now - The current epoch time in milliseconds.
   * @returns The decision for the batch that failed.
   */
  recordFailure(retryAfterMs: number | undefined, now: number): FailureDecision;
}

/**
 * Builds the retry policy for one logger.
 *
 * @returns A policy starting from a clean slate.
 * @example
 * const policy = createFailurePolicy();
 * policy.recordFailure(undefined, Date.now()); // { requeue: true, retryInMs: 1000 }
 */
export function createFailurePolicy(): FailurePolicy {
  let consecutiveFailures = 0;
  let nextAttemptAt = 0;

  return {
    get eventsPerAttempt(): number {
      return consecutiveFailures >= MAX_SEND_ATTEMPTS
        ? 1
        : MAX_EVENTS_PER_BATCH;
    },

    waitMs(now: number): number {
      return Math.max(0, nextAttemptAt - now);
    },

    recordSuccess(): void {
      consecutiveFailures = 0;
      nextAttemptAt = 0;
    },

    recordFailure(
      retryAfterMs: number | undefined,
      now: number,
    ): FailureDecision {
      consecutiveFailures += 1;

      // The server's delay is a floor on top of ours, never a replacement for
      // it: `Retry-After` exists to make a client wait LONGER, and a
      // `Retry-After: 0` honoured literally spent every attempt a batch had
      // in the same millisecond.
      const backoff = Math.min(
        MAX_RETRY_DELAY_MS,
        MIN_RETRY_DELAY_MS * 2 ** (consecutiveFailures - 1),
      );
      const retryInMs =
        retryAfterMs === undefined ? backoff : Math.max(retryAfterMs, backoff);
      nextAttemptAt = now + retryInMs;

      return { requeue: consecutiveFailures < MAX_SEND_ATTEMPTS, retryInMs };
    },
  };
}
