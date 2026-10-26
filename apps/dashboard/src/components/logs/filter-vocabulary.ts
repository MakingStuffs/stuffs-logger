import {
  DEVICE_TYPES,
  LOG_LEVELS,
  LOG_SOURCES,
} from "@stuffs/logger-core/taxonomy";
import type {
  DeviceType,
  LoggerKind,
  LogLevel,
  LogSource,
} from "@stuffs/logger-core/taxonomy";

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/logs/constants";

import type { BadgeProps } from "../ui/badge";

/**
 * The vocabulary the log explorer's UI shares with the URL.
 *
 * The filter schema in `lib/logs/filters.ts` is CLOSED — an unrecognised query
 * param is a validation error, not an ignored extra — so the names below are
 * the complete set of keys any control, link or form field on `/logs` may
 * emit. Keeping them in one place is what stops a stray `?tab=` creeping into
 * a link and turning a shared URL into an error state.
 *
 * IMPORTED FROM LEAVES, NOT BARRELS. This module is reached from the
 * client-rendered log row, so everything it imports ships to the browser. The
 * `@stuffs/logger-core` barrel re-exports the ingest schemas and therefore
 * zod, and `lib/logs/filters.ts` IS a zod schema: either import would put the
 * whole validator in the bundle to read a few string arrays and two integers.
 */

/** Every search param `/logs` understands. Nothing else may appear in a URL. */
export const LOG_FILTER_PARAMS = [
  "applicationId",
  "applicationSlug",
  "level",
  "source",
  "deviceType",
  "environment",
  "from",
  "to",
  "search",
  "cursor",
  "limit",
] as const;

/** A single accepted search-param name. */
export type LogFilterParam = (typeof LOG_FILTER_PARAMS)[number];

/** Human labels for the severity vocabulary. */
export const LEVEL_LABELS = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
} as const satisfies Record<LogLevel, string>;

/** Human labels for the batch-origin vocabulary. */
export const SOURCE_LABELS = {
  browser: "Browser",
  node: "Server",
} as const satisfies Record<LogSource, string>;

/** Human labels for the device vocabulary. */
export const DEVICE_LABELS = {
  desktop: "Desktop",
  mobile: "Mobile",
  tablet: "Tablet",
  bot: "Bot",
  unknown: "Unknown",
} as const satisfies Record<DeviceType, string>;

/** Human labels for the SDK entry points a row can come from. */
export const LOGGER_LABELS = {
  manual: "Manual",
  console: "Console",
  onerror: "window.onerror",
  unhandledrejection: "Unhandled rejection",
  uncaughtException: "Uncaught exception",
} as const satisfies Record<LoggerKind, string>;

/**
 * Which badge variant carries each severity.
 *
 * Design-system variants only — a level must never be signalled by a colour
 * this app invented, and never by colour alone: the badge always carries the
 * level's name as text.
 *
 * The mapping walks the badge's loudness ramp in severity order, so a column
 * of levels can be read by weight before it is read by word: the two levels
 * nobody triages by are the quietest, and `fatal` is the only thing on the
 * page allowed to be the loudest.
 */
export const LEVEL_BADGE_VARIANT = {
  trace: "outline",
  debug: "outline",
  info: "secondary",
  warn: "warning",
  error: "destructive",
  fatal: "critical",
} as const satisfies Record<LogLevel, NonNullable<BadgeProps["variant"]>>;

/** Ordered severity options for the filter panel. Most severe first: the
 * levels an operator triages by are the ones they reach for. */
export const LEVEL_OPTIONS = [...LOG_LEVELS].reverse() as LogLevel[];

/** Batch-origin options for the filter panel. */
export const SOURCE_OPTIONS: readonly LogSource[] = LOG_SOURCES;

/** Device options for the filter panel. */
export const DEVICE_OPTIONS: readonly DeviceType[] = DEVICE_TYPES;

/**
 * Page sizes the UI offers.
 *
 * Bounded by the schema's own ceiling rather than a second hardcoded 200, so
 * the menu can never offer a size the validator rejects.
 */
export const PAGE_SIZE_OPTIONS: readonly number[] = [
  25,
  DEFAULT_PAGE_SIZE,
  100,
  MAX_PAGE_SIZE,
];
