import { scheduleAfter, scheduleIdle } from "./scheduler";
import type { CancelScheduled } from "./scheduler";

/**
 * The one pending flush, and the rules for replacing it.
 *
 * At most one flush may ever be scheduled: overlapping timers would turn a
 * burst of log calls into a burst of requests. `arm` therefore keeps the
 * earliest pending flush rather than pushing it back, while `armIdle` — used
 * when the batch is already full — replaces it, because there is no longer any
 * reason to wait.
 */
export interface FlushTimer {
  /** Schedules a flush in `delayMs`, unless one is already pending. */
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
 * @returns The timer.
 * @example
 * const timer = createFlushTimer(() => void flush());
 * timer.arm(5000);
 */
export function createFlushTimer(run: () => void): FlushTimer {
  let cancelScheduled: CancelScheduled | undefined;

  function fire(): void {
    cancelScheduled = undefined;
    run();
  }

  return {
    arm(delayMs: number): void {
      if (cancelScheduled) return;
      cancelScheduled = scheduleAfter(fire, delayMs);
    },

    armIdle(): void {
      cancelScheduled?.();
      cancelScheduled = scheduleIdle(fire);
    },

    cancel(): void {
      cancelScheduled?.();
      cancelScheduled = undefined;
    },
  };
}
