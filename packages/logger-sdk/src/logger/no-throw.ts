import type { DiagnosticHandler } from "../types";
import { runSuppressed } from "./suppression";

/**
 * The no-throw guarantee, in one place.
 *
 * The SDK's central promise is that logging can never become the reason an
 * application breaks. Every public entry point and every scheduled callback
 * runs through one of these wrappers, so the guarantee is a property of a
 * single module rather than of remembering a `try` at forty call sites.
 */

const noop: DiagnosticHandler = () => {};

/**
 * Hardens a caller-supplied diagnostic hook.
 *
 * @param onError - The caller's hook, if any.
 * @returns A handler that reports and cannot itself throw — a broken hook must
 *   not become the failure the SDK exists to avoid.
 */
export function createDiagnostics(
  onError: DiagnosticHandler | undefined,
): DiagnosticHandler {
  if (!onError) return noop;

  return (error, context) => {
    try {
      // Suppressed, because the commonest thing an `onError` hook does is
      // write to the console — and with `captureConsole` installed that would
      // feed the failure straight back into the pipeline that produced it.
      runSuppressed(() => {
        onError(error, context);
      });
    } catch {
      // A diagnostic hook that throws is the one failure with nowhere left to
      // report it. Dropping it is the only option that keeps the guarantee.
    }
  };
}

/**
 * Runs a synchronous operation, swallowing any failure.
 *
 * @param operation - The work to attempt.
 * @param report - Where a swallowed failure is announced.
 * @param context - A short label naming the operation, for the diagnostic.
 * @returns The result, or `undefined` when the operation failed.
 */
export function safely<T>(
  operation: () => T,
  report: DiagnosticHandler,
  context: string,
): T | undefined {
  try {
    return operation();
  } catch (error) {
    report(error, context);
    return undefined;
  }
}

/**
 * Runs an asynchronous operation, swallowing both throws and rejections.
 *
 * @param operation - The work to attempt.
 * @param report - Where a swallowed failure is announced.
 * @param context - A short label naming the operation, for the diagnostic.
 * @returns The result, or `undefined` when the operation failed.
 */
export async function safelyAsync<T>(
  operation: () => Promise<T>,
  report: DiagnosticHandler,
  context: string,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    report(error, context);
    return undefined;
  }
}
