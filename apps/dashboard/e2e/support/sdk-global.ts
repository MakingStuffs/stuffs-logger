/**
 * The shape the SDK's `<script>` build puts on `window`.
 *
 * Declared here rather than asserted at the call site so the round-trip spec
 * can drive the real bundle without a single type assertion — the alternative
 * (`window as unknown as …`) would tell the compiler to trust a shape nothing
 * checks, in the one test whose whole job is to check that shape.
 *
 * Only the members the round trip uses are declared. This is a description of
 * `packages/logger-sdk/src/global.ts`, kept deliberately minimal so it cannot
 * quietly claim more than the spec exercises.
 */

/** The counters a logger reports about what it did with its events. */
export interface StuffsLoggerStats {
  readonly queued: number;
  readonly dropped: number;
  /** Events the server accepted. The number the round trip asserts on. */
  readonly sent: number;
  readonly failed: number;
}

/** The logger surface the round trip drives. */
export interface StuffsLoggerInstance {
  error(message: string, context?: Record<string, unknown>): void;
  flush(): Promise<void>;
  readonly stats: StuffsLoggerStats;
  /** `false` when the logger refused its configuration — a wrong key shape,
   * an endpoint it will not send a credential over, or a closed logger. */
  readonly enabled: boolean;
}

/** The options the round trip passes. A subset of the SDK's `LoggerOptions`. */
export interface StuffsLoggerInit {
  apiKey: string;
  environment: string;
  release: string;
  /** Sends immediately instead of waiting for the idle flush. */
  batchSize: number;
  onError(error: unknown, context: string): void;
}

/** The `window.StuffsLogger` namespace the IIFE build defines. */
export interface StuffsLoggerGlobal {
  createLogger(options: StuffsLoggerInit): StuffsLoggerInstance;
  readonly version: string;
}

declare global {
  interface Window {
    /**
     * Present only after the global bundle has been injected into the page —
     * hence optional. Nothing in the application itself defines it.
     */
    StuffsLogger?: StuffsLoggerGlobal;
  }
}
