import type {
  DeviceType,
  LogLevel,
  LoggerKind,
  LogSource,
} from "@stuffs/logger-core";
import { $Enums } from "@prisma/client";

/**
 * The one translation between the lowercase wire vocabulary of
 * `@stuffs/logger-core` and the uppercase Postgres enums.
 *
 * Explicit lookup tables rather than `toUpperCase()`: `satisfies` makes each
 * map total in both directions, so adding a level to the taxonomy without
 * adding it to the schema (or the reverse) is a compile error rather than a
 * runtime crash on the first event that uses it.
 */

/** Wire level → database level. */
export const LEVEL_TO_DB = {
  trace: $Enums.LogLevel.TRACE,
  debug: $Enums.LogLevel.DEBUG,
  info: $Enums.LogLevel.INFO,
  warn: $Enums.LogLevel.WARN,
  error: $Enums.LogLevel.ERROR,
  fatal: $Enums.LogLevel.FATAL,
} as const satisfies Record<LogLevel, $Enums.LogLevel>;

/** Database level → wire level. */
export const LEVEL_FROM_DB = {
  TRACE: "trace",
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
  FATAL: "fatal",
} as const satisfies Record<$Enums.LogLevel, LogLevel>;

/** Wire source → database source. */
export const SOURCE_TO_DB = {
  browser: $Enums.LogSource.BROWSER,
  node: $Enums.LogSource.NODE,
} as const satisfies Record<LogSource, $Enums.LogSource>;

/** Database source → wire source. */
export const SOURCE_FROM_DB = {
  BROWSER: "browser",
  NODE: "node",
} as const satisfies Record<$Enums.LogSource, LogSource>;

/** Wire logger kind → database logger kind. */
export const LOGGER_TO_DB = {
  manual: $Enums.LoggerKind.MANUAL,
  console: $Enums.LoggerKind.CONSOLE,
  onerror: $Enums.LoggerKind.ONERROR,
  unhandledrejection: $Enums.LoggerKind.UNHANDLEDREJECTION,
  uncaughtException: $Enums.LoggerKind.UNCAUGHTEXCEPTION,
} as const satisfies Record<LoggerKind, $Enums.LoggerKind>;

/** Database logger kind → wire logger kind. */
export const LOGGER_FROM_DB = {
  MANUAL: "manual",
  CONSOLE: "console",
  ONERROR: "onerror",
  UNHANDLEDREJECTION: "unhandledrejection",
  UNCAUGHTEXCEPTION: "uncaughtException",
} as const satisfies Record<$Enums.LoggerKind, LoggerKind>;

/** Wire device type → database device type. */
export const DEVICE_TO_DB = {
  desktop: $Enums.DeviceType.DESKTOP,
  mobile: $Enums.DeviceType.MOBILE,
  tablet: $Enums.DeviceType.TABLET,
  bot: $Enums.DeviceType.BOT,
  unknown: $Enums.DeviceType.UNKNOWN,
} as const satisfies Record<DeviceType, $Enums.DeviceType>;

/** Database device type → wire device type. */
export const DEVICE_FROM_DB = {
  DESKTOP: "desktop",
  MOBILE: "mobile",
  TABLET: "tablet",
  BOT: "bot",
  UNKNOWN: "unknown",
} as const satisfies Record<$Enums.DeviceType, DeviceType>;
