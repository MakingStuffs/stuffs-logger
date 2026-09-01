import type { JsonObject } from "../types";

/**
 * The seam that keeps runtime-specific data collection out of the logger.
 *
 * `createLogger` knows nothing about `window` or `process`; it is handed a
 * collector by whichever entry point built it. That is what lets the browser
 * bundle exclude the Node collector entirely, and what lets the pipeline be
 * tested without a DOM.
 */

/** Auto-collected fields for a single event. */
export interface CollectedContext {
  /** Goes on the event's `url` field. Browser only. */
  url?: string;
  /** Goes on the event's `userAgent` field. Browser only. */
  userAgent?: string;
  /** Merged beneath the caller's context. */
  context?: JsonObject;
}

/** Supplies the ambient context for the current runtime. */
export interface ContextCollector {
  /** Stable per-page-session identifier, resolved once. */
  sessionId(): string | undefined;
  /** Fields sampled at the moment an event is captured. */
  collect(): CollectedContext;
}

/** A collector that reports nothing, used when `autoContext` is off. */
export const emptyContextCollector: ContextCollector = {
  sessionId: () => undefined,
  collect: () => ({}),
};
