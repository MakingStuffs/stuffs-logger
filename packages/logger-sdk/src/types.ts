import type {
  IngestBatch,
  JsonValue,
  LoggerKind,
  LogLevel,
  LogSource,
} from "./contract";

/** A JSON object, the shape every event `context` is normalized into. */
export type JsonObject = { [key: string]: JsonValue };

/**
 * Context as a CALLER supplies it: anything at all. It is normalized, redacted
 * and bounded before it leaves the process, so no constraint is imposed here —
 * a logging call must never fail to compile because of the shape of a value
 * someone wanted to look at.
 */
export type LogContext = Readonly<Record<string, unknown>>;

/** A key pattern that marks a value as secret. Strings match as substrings. */
export type RedactionPattern = string | RegExp;

/** How the redactor decides what never leaves the process. */
export interface RedactionOptions {
  /** Defaults to `true`. */
  enabled?: boolean;
  /** Replaces the built-in list outright. */
  keys?: readonly RedactionPattern[];
  /** Extends the built-in list. Ignored when `keys` is supplied. */
  additionalKeys?: readonly RedactionPattern[];
  /** The value substituted for a redacted one. Defaults to `"[redacted]"`. */
  replacement?: string;
}

/**
 * The SDK's only outward sign of its own failures.
 *
 * It is never called with anything that reached caller code — by the time a
 * handler runs, the failure has already been swallowed.
 */
export type DiagnosticHandler = (error: unknown, context: string) => void;

/** A log record as handed to {@link Logger.capture}. */
export interface CaptureInput {
  level: LogLevel;
  message: unknown;
  context?: LogContext;
  error?: unknown;
  /** Which SDK surface produced it. Defaults to `"manual"`. */
  logger?: LoggerKind;
}

/** Counters describing what the logger has done with the events it was given. */
export interface LoggerStats {
  /** Events currently waiting to be sent. */
  readonly queued: number;
  /** Events discarded — queue overflow, or a batch that exhausted its retries. */
  readonly dropped: number;
  /** Events the server accepted. */
  readonly sent: number;
  /** Send attempts that did not succeed. */
  readonly failed: number;
}

/**
 * Why a batch was condemned, when the reason tells the logger what to do next.
 *
 * `"urgent-body-limit"` means the ONLY thing that refused the batch was the
 * unload path's keepalive cap, and the same batch would fit an ordinary flush.
 * The logger requeues those instead of discarding them; every other drop is
 * final, because a batch requeued after a refusal that would repeat is a loop.
 */
export type DropCause = "urgent-body-limit";

/** What became of one batch. A transport resolves; it never rejects. */
export type TransportOutcome =
  | { readonly kind: "sent"; readonly accepted: number }
  | { readonly kind: "retry"; readonly retryAfterMs?: number }
  | {
      readonly kind: "dropped";
      readonly reason: string;
      readonly cause?: DropCause;
    }
  | { readonly kind: "disabled"; readonly reason: string };

/** One batch, ready to send. */
export interface TransportRequest {
  readonly batch: IngestBatch;
  /**
   * Set on the page-unload path, where the request must outlive the document.
   * Urgent sends use `keepalive`, which browsers cap far below the server's
   * body limit — the caller trims the batch accordingly.
   */
  readonly urgent: boolean;
}

/**
 * The seam between the logger and the network.
 *
 * Injectable so tests can assert batching, retry and the no-throw guarantee
 * without a server, and so a host application can route batches through its
 * own proxy.
 */
export interface Transport {
  send(request: TransportRequest): Promise<TransportOutcome>;
}

/**
 * Everything `createLogger` accepts. Only `apiKey` has no useful default.
 *
 * There is deliberately NO `app` option. Which application a batch belongs to
 * is derived server-side from the verified ingest key, so it is not a field a
 * caller can set: a client that could name its own application could write
 * events into someone else's. The key identifies the application; the SDK
 * never states it.
 */
export interface LoggerOptions {
  /**
   * The ingest key. A `jfl_pub_…` key in the browser, a `jfl_sec_…` key in
   * Node — the SDK refuses the other way round in both directions.
   *
   * Falls back to `JF_LOGGER_API_KEY` when running under Node.
   */
  apiKey?: string;
  /**
   * Ingest origin or full ingest URL. Defaults to the current origin in the
   * browser and `JF_LOGGER_ENDPOINT` under Node.
   *
   * Must be `https:` unless the host is the loopback one — the ingest key
   * travels in a header on every batch.
   */
  endpoint?: string;
  /** Defaults to `NODE_ENV` under Node, otherwise `"production"`. */
  environment?: string;
  /** Build/commit identifier. Defaults to `JF_LOGGER_RELEASE` under Node. */
  release?: string;
  /** Overrides runtime detection. */
  source?: LogSource;
  /** Overrides the automatically persisted browser session id. */
  sessionId?: string;
  /** Events below this severity are discarded. Defaults to `"trace"`. */
  minLevel?: LogLevel;
  /** Fraction of events kept, `0`–`1`. Defaults to `1`. */
  sampleRate?: number;
  /** Per-level overrides of {@link LoggerOptions.sampleRate}. */
  sampleRates?: Partial<Record<LogLevel, number>>;
  /** Queue length that triggers an early flush. Defaults to `20`. */
  batchSize?: number;
  /** Idle flush cadence in milliseconds. Defaults to `5000`. */
  flushIntervalMs?: number;
  /** Hard cap on buffered events; the oldest are dropped. Defaults to `1000`. */
  maxQueueSize?: number;
  /** Static context merged into every event, beneath per-call context. */
  context?: LogContext;
  /** Collect url/userAgent/viewport (browser) and pid/version (Node). Default `true`. */
  autoContext?: boolean;
  redaction?: RedactionOptions;
  /** Set `false` to build an inert logger, e.g. in tests. Defaults to `true`. */
  enabled?: boolean;
  /** Called when the SDK swallows one of its own failures. */
  onError?: DiagnosticHandler;
  /** Replaces the built-in HTTP transport. */
  transport?: Transport;
}

/**
 * The logging surface.
 *
 * Every method is failure-tolerant: none of them throws, none of them returns
 * a rejected promise, and none of them blocks the caller on the network.
 */
export interface Logger {
  trace(message: unknown, context?: LogContext): void;
  debug(message: unknown, context?: LogContext): void;
  info(message: unknown, context?: LogContext): void;
  /** Alias of {@link Logger.info}, so `console.log` can be swapped for it. */
  log(message: unknown, context?: LogContext): void;
  warn(message: unknown, context?: LogContext): void;
  error(message: unknown, context?: LogContext): void;
  fatal(message: unknown, context?: LogContext): void;
  /** The full-fidelity entry point the level helpers and the captures use. */
  capture(input: CaptureInput): void;
  /** Sends everything queued. Resolves once the attempt has finished. */
  flush(): Promise<void>;
  /** Flushes, then releases timers and listeners. The logger goes inert. */
  close(): Promise<void>;
  /** Replaces the static context. */
  setContext(context: LogContext | undefined): void;
  readonly stats: LoggerStats;
  /** `false` when the logger was misconfigured or has been closed. */
  readonly enabled: boolean;
}
