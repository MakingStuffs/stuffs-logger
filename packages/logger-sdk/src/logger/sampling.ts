import { DEFAULT_SAMPLE_RATE } from "../defaults";
import type { LogLevel } from "../contract";

/**
 * Per-level sampling, so a chatty `debug` call site can be throttled without
 * losing a single `error`.
 *
 * Sampling is evaluated before an event is normalized: a discarded event costs
 * one comparison and one random number, never a walk of its context.
 */

function clampRate(rate: number | undefined): number | undefined {
  if (rate === undefined) return undefined;
  if (!Number.isFinite(rate)) return undefined;
  return Math.min(1, Math.max(0, rate));
}

/**
 * The fraction of events at `level` that should be kept.
 *
 * @param level - The event's severity.
 * @param sampleRate - The logger-wide default.
 * @param sampleRates - Per-level overrides.
 * @returns A rate between 0 and 1 inclusive.
 */
export function resolveSampleRate(
  level: LogLevel,
  sampleRate: number | undefined,
  sampleRates: Partial<Record<LogLevel, number>> | undefined,
): number {
  return (
    clampRate(sampleRates?.[level]) ??
    clampRate(sampleRate) ??
    DEFAULT_SAMPLE_RATE
  );
}

/**
 * Whether an event survives sampling.
 *
 * @param rate - The resolved rate, 0–1.
 * @param random - Source of randomness, injected so tests are deterministic.
 * @returns `true` when the event should be kept.
 */
export function shouldSample(rate: number, random: () => number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return random() < rate;
}
