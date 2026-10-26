import { scheduleAfter, scheduleIdle } from "./scheduler";
import type { CancelScheduled } from "./scheduler";

/**
 * The one pending flush, and the rules for replacing it.
 *
 * At most one flush may ever be scheduled: overlapping timers would turn a
 * burst of log calls into a burst of requests. `arm` therefore only ever
 * brings the pending flush FORWARD — a later request leaves the earlier one
 * in place, an earlier request replaces it — while `armIdle`, used when the
 * batch is already full, replaces it outright because there is no longer any
 * reason to wait.
 */
export interface FlushTimer {
  /** Schedules a flush in `delayMs`, unless one is already due sooner. */
  arm(delayMs: number): void;
  /** Replaces any pending flush with one at the host's next idle moment. */
  armIdle(): void;
  /** Cancels the pending flush, if there is one. */
  cancel(): void;
}

/**
 * Builds the flush timer.
 *
 * @param run - What a due flush does. It must not throw; wrap it first.
 * @param now - The clock, in epoch milliseconds. Injectable for tests.
 * @returns The timer.
 * @example
 * const timer = createFlushTimer(() => void flush());
 * timer.arm(5000);
 */
export function createFlushTimer(
  run: () => void,
  now: () => number = Date.now,
): FlushTimer {
  let cancelScheduled: CancelScheduled | undefined;
  let dueAt = 0;

  function fire(): void {
    cancelScheduled = undefined;
    run();
  }

  return {
    arm(delayMs: number): void {
      const at = now() + delayMs;
      // Keeping whichever flush was armed FIRST looked equivalent, and was
      // not: a retry delay that expires before the idle interval must win,
      // or the retry sits behind the interval that was armed before it.
      if (cancelScheduled && at >= dueAt) return;

      cancelScheduled?.();
      cancelScheduled = scheduleAfter(fire, delayMs);
      dueAt = at;
    },

    armIdle(): void {
      cancelScheduled?.();
      cancelScheduled = scheduleIdle(fire);
      dueAt = now();
    },

    cancel(): void {
      cancelScheduled?.();
      cancelScheduled = undefined;
    },
  };
}
