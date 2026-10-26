import {
  levelRank,
  MAX_EVENTS_PER_BATCH,
  MAX_SHORT_FIELD_LENGTH,
} from "../contract";
import type { LogSource } from "../contract";
import type { RuntimeAdapter } from "../context/adapter";
import { readEnv } from "../context/runtime";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_ENVIRONMENT,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_MAX_QUEUE_SIZE,
  DEFAULT_MIN_LEVEL,
} from "../defaults";
import type { LoggerOptions } from "../types";

/**
 * Turning caller options into the settled numbers the logger runs on.
 *
 * Nothing here can fail: an option out of range is clamped, an option of the
 * wrong shape falls back to its default, and an absent option is looked for in
 * the environment. A logger must not refuse to start because someone passed
 * `batchSize: -1`.
 */

/** Environment variable consulted when no `release` option is given. */
const RELEASE_ENV_VAR = "STUFFS_LOGGER_RELEASE";

/** Environment variable consulted when no `environment` option is given. */
const ENVIRONMENT_ENV_VAR = "STUFFS_LOGGER_ENVIRONMENT";

/**
 * Hard ceiling on `maxQueueSize`.
 *
 * The queue is a preallocated ring, so the option is a memory allocation made
 * on the caller's behalf. Above this it stops being a buffer and becomes a
 * leak with a name — and `new Array(1e10)` never gets that far anyway: it
 * throws, from inside `createLogger`, which is the one place a throw breaks
 * the promise the whole SDK is built on.
 */
export const MAX_QUEUE_SIZE_CEILING = 100_000;

/** The settled configuration one logger instance runs on. */
export interface ResolvedOptions {
  /** What batches from this logger are attributed to. */
  readonly source: LogSource;
  readonly environment: string;
  readonly release: string | undefined;
  /** Events ranking below this are discarded on the caller's thread. */
  readonly minRank: number;
  /** Queue length that triggers an early flush. */
  readonly batchSize: number;
  readonly flushIntervalMs: number;
  readonly maxQueueSize: number;
  /** Batches one ordinary flush may send before it defers the rest. */
  readonly maxFlushPasses: number;
}

/**
 * Bounds a free-text field to the contract's short-field limit.
 *
 * @param value - The caller's value, if any.
 * @returns The trimmed, clamped value, or `undefined` when it was empty.
 */
export function clampShort(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_SHORT_FIELD_LENGTH);
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function resolveEnvironment(configured: string | undefined): string {
  return (
    clampShort(configured) ??
    clampShort(readEnv(ENVIRONMENT_ENV_VAR)) ??
    clampShort(readEnv("NODE_ENV")) ??
    DEFAULT_ENVIRONMENT
  );
}

/**
 * Resolves every configurable number and string a logger needs.
 *
 * @param options - Caller configuration.
 * @param adapter - The host runtime, which supplies the default source.
 * @returns The settled configuration.
 * @example
 * resolveOptions({ batchSize: -5 }, nodeAdapter).batchSize; // 1
 */
export function resolveOptions(
  options: LoggerOptions,
  adapter: RuntimeAdapter,
): ResolvedOptions {
  const maxQueueSize = clampInteger(
    options.maxQueueSize,
    1,
    MAX_QUEUE_SIZE_CEILING,
    DEFAULT_MAX_QUEUE_SIZE,
  );

  return {
    source: options.source ?? adapter.source,
    environment: resolveEnvironment(options.environment),
    release: clampShort(options.release ?? readEnv(RELEASE_ENV_VAR)),
    minRank: levelRank(options.minLevel ?? DEFAULT_MIN_LEVEL),
    batchSize: clampInteger(
      options.batchSize,
      1,
      MAX_EVENTS_PER_BATCH,
      DEFAULT_BATCH_SIZE,
    ),
    flushIntervalMs: clampInteger(
      options.flushIntervalMs,
      0,
      Number.MAX_SAFE_INTEGER,
      DEFAULT_FLUSH_INTERVAL_MS,
    ),
    maxQueueSize,
    maxFlushPasses: Math.ceil(maxQueueSize / MAX_EVENTS_PER_BATCH) + 1,
  };
}
