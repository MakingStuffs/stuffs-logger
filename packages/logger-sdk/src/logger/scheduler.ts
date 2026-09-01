/**
 * Deferral primitives, so no SDK work ever runs on the caller's stack.
 *
 * A logging call must return immediately: it queues an event and gets out of
 * the way. Serialization and the network happen later, at the lowest priority
 * the host will give us.
 */

/** Undoes a scheduling call. Safe to invoke after the task has already run. */
export type CancelScheduled = () => void;

/** Upper bound on how long an idle task may be deferred. */
const IDLE_TIMEOUT_MS = 2000;

const noopCancel: CancelScheduled = () => {};

type IdleScheduler = (
  callback: () => void,
  options: { timeout: number },
) => number;

function idleScheduler(): IdleScheduler | undefined {
  const candidate = (
    globalThis as {
      requestIdleCallback?: unknown;
      cancelIdleCallback?: unknown;
    }
  ).requestIdleCallback;

  return typeof candidate === "function"
    ? (candidate as IdleScheduler)
    : undefined;
}

/**
 * Detaches a Node timer from the event loop so a queued flush cannot keep a
 * short-lived process alive. A no-op in the browser, where the method does not
 * exist.
 */
function detach(handle: unknown): void {
  if (typeof handle !== "object" || handle === null) return;
  const unref = (handle as { unref?: unknown }).unref;
  if (typeof unref === "function") unref.call(handle);
}

/**
 * Runs `task` when the host is next idle, or on the next macrotask where idle
 * scheduling is unavailable.
 *
 * @param task - The work to defer. It must not throw; wrap it first.
 * @returns A canceller.
 */
export function scheduleIdle(task: () => void): CancelScheduled {
  const requestIdle = idleScheduler();

  if (requestIdle) {
    const handle = requestIdle(task, { timeout: IDLE_TIMEOUT_MS });
    const cancelIdle = (globalThis as { cancelIdleCallback?: unknown })
      .cancelIdleCallback;

    if (typeof cancelIdle !== "function") return noopCancel;
    return () => {
      (cancelIdle as (id: number) => void)(handle);
    };
  }

  return scheduleAfter(task, 0);
}

/**
 * Runs `task` after a delay.
 *
 * @param task - The work to defer. It must not throw; wrap it first.
 * @param delayMs - How long to wait.
 * @returns A canceller.
 */
export function scheduleAfter(
  task: () => void,
  delayMs: number,
): CancelScheduled {
  const handle = setTimeout(task, delayMs);
  detach(handle);
  return () => {
    clearTimeout(handle);
  };
}
