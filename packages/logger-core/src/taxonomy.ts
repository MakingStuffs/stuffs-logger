/**
 * The closed vocabularies of the wire contract.
 *
 * Declared as `as const` tuples so each one yields both a runtime list (for zod
 * and for dashboard filter UIs) and a literal union type, and a typo in either
 * consumer is a compile error rather than a silently unmatched string.
 */

/** Severity levels, ordered least to most severe. */
export const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const;

/** A single severity level. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Where a batch originated. */
export const LOG_SOURCES = ["browser", "node"] as const;

/** A single batch origin. */
export type LogSource = (typeof LOG_SOURCES)[number];

/** Which SDK entry point produced an event. */
export const LOGGER_KINDS = [
  "manual",
  "console",
  "onerror",
  "unhandledrejection",
  "uncaughtException",
] as const;

/** A single logger kind. */
export type LoggerKind = (typeof LOGGER_KINDS)[number];

/**
 * Coarse device classes derived server-side from the user agent.
 *
 * Derived rather than reported: a client-supplied device class would be one
 * more attacker-controlled filter value, and the user agent is already sent.
 */
export const DEVICE_TYPES = [
  "desktop",
  "mobile",
  "tablet",
  "bot",
  "unknown",
] as const;

/** A single device class. */
export type DeviceType = (typeof DEVICE_TYPES)[number];

/** Rank of each level, for "at least this severe" comparisons. */
const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * The numeric severity of a level. Higher is more severe.
 *
 * @param level - The level to rank.
 * @returns The rank, for threshold comparisons such as an SDK minimum level.
 * @example
 * levelRank("error") > levelRank("info"); // true
 */
export function levelRank(level: LogLevel): number {
  return LEVEL_RANK[level];
}

/** Levels the dashboard treats as errors when counting failures. */
export const ERROR_LEVELS = [
  "error",
  "fatal",
] as const satisfies readonly LogLevel[];
