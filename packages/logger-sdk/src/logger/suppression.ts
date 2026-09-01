/**
 * The structural guard against the console/transport feedback loop.
 *
 * `captureConsole()` turns every `console.error` into a log event. A transport
 * that reported its own failure to `console.error` would therefore produce an
 * event, whose send could fail, which would report again — an unbounded loop
 * that only shows up under exactly the conditions (a broken network) where the
 * SDK must behave best.
 *
 * Making it impossible rather than unlikely: everything the SDK runs on its
 * own behalf executes inside {@link runSuppressed}, and the capture pipeline
 * refuses to accept an event while suppression is active. A console call made
 * from inside the SDK — directly, or from a caller's `onError` hook — cannot
 * re-enter the pipeline no matter how it got there.
 */

let depth = 0;

/** Whether the current call stack originated inside the SDK. */
export function isSuppressed(): boolean {
  return depth > 0;
}

/**
 * Runs `operation` with capture suppressed.
 *
 * Re-entrant (a counter, not a flag) so nested SDK work does not lift
 * suppression early, and `finally`-balanced so a throw cannot leave the
 * pipeline permanently deaf.
 *
 * @param operation - The SDK-internal work to run.
 * @returns Whatever `operation` returns.
 */
export function runSuppressed<T>(operation: () => T): T {
  depth += 1;
  try {
    return operation();
  } finally {
    depth -= 1;
  }
}
