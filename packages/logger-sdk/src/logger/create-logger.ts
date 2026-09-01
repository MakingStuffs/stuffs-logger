import {
  jsonByteLength,
  levelRank,
  LOG_LEVELS,
  MAX_EVENTS_PER_BATCH,
  MAX_SHORT_FIELD_LENGTH,
} from "../contract";
import type {
  IngestBatch,
  LogEventPayload,
  LogLevel,
  SdkInfo,
} from "../contract";
import type { RuntimeAdapter } from "../context/adapter";
import { emptyContextCollector } from "../context/collector";
import { readEnv } from "../context/runtime";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_ENVIRONMENT,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_MAX_QUEUE_SIZE,
  DEFAULT_MIN_LEVEL,
  MAX_KEEPALIVE_BODY_BYTES,
  MAX_RETRY_DELAY_MS,
  MAX_SEND_ATTEMPTS,
  MIN_RETRY_DELAY_MS,
  SDK_NAME,
  SDK_VERSION,
} from "../defaults";
import type {
  CaptureInput,
  Logger,
  LoggerOptions,
  LoggerStats,
  LogContext,
  Transport,
  TransportOutcome,
} from "../types";
import { checkCredential } from "./credentials";
import { resolveEndpoint } from "./endpoint";
import { createDiagnostics, safely, safelyAsync } from "./no-throw";
import { BoundedQueue } from "./queue";
import { createRedactor } from "./redact";
import {
  mergeContext,
  normalizeContext,
  serializeError,
  toMessage,
} from "./sanitize";
import { resolveSampleRate, shouldSample } from "./sampling";
import { scheduleAfter, scheduleIdle } from "./scheduler";
import type { CancelScheduled } from "./scheduler";
import { isSuppressed, runSuppressed } from "./suppression";
import { createHttpTransport } from "./transport";

/**
 * The thin orchestrator: configuration in, {@link Logger} out.
 *
 * Every hard problem is solved in its own module — bounding memory in
 * `./queue`, secrets in `./redact`, the network in `./transport`, host
 * differences in `../context/adapter`. What is left here is the wiring and the
 * flush policy, which is the one piece of behaviour that genuinely needs to
 * see all of them at once.
 */

/** Environment variable consulted when no `apiKey` option is given. */
const API_KEY_ENV_VAR = "JF_LOGGER_API_KEY";

/** Environment variable consulted when no `release` option is given. */
const RELEASE_ENV_VAR = "JF_LOGGER_RELEASE";

/** Environment variable consulted when no `environment` option is given. */
const ENVIRONMENT_ENV_VAR = "JF_LOGGER_ENVIRONMENT";

/** Fraction of the keepalive budget an unload batch is allowed to fill. */
const KEEPALIVE_SAFETY_FACTOR = 0.9;

const SDK_INFO: SdkInfo = { name: SDK_NAME, version: SDK_VERSION };

function clampShort(value: string | undefined): string | undefined {
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

function isLogLevel(value: unknown): value is LogLevel {
  return LOG_LEVELS.includes(value as LogLevel);
}

/**
 * How many of `events` fit inside the browser's keepalive body budget.
 *
 * Estimated from one measurement of the whole batch rather than measured per
 * event: this runs while the document is being torn down, and a binary search
 * over `JSON.stringify` would spend the little time left on arithmetic.
 */
function keepaliveBatchSize(events: readonly LogEventPayload[]): number {
  if (events.length === 0) return 0;

  const bytes = jsonByteLength(events);
  const budget = MAX_KEEPALIVE_BODY_BYTES * KEEPALIVE_SAFETY_FACTOR;
  if (bytes <= budget) return events.length;

  const averageBytes = bytes / events.length;
  return Math.max(1, Math.floor(budget / averageBytes));
}

/**
 * Builds a logger for a specific runtime.
 *
 * Exported for the entry points and for tests; applications call the
 * `createLogger` re-exported from `.`, `./browser` or `./node`, which supply
 * the adapter for them.
 *
 * @param options - Caller configuration.
 * @param adapter - The host runtime's context collection and teardown hooks.
 * @returns A logger that never throws, even when misconfigured.
 */
export function createLoggerWith(
  options: LoggerOptions,
  adapter: RuntimeAdapter,
): Logger {
  const report = createDiagnostics(options.onError);
  const source = options.source ?? adapter.source;
  const environment = resolveEnvironment(options.environment);
  const release = clampShort(options.release ?? readEnv(RELEASE_ENV_VAR));
  const minRank = levelRank(options.minLevel ?? DEFAULT_MIN_LEVEL);
  const batchSize = clampInteger(
    options.batchSize,
    1,
    MAX_EVENTS_PER_BATCH,
    DEFAULT_BATCH_SIZE,
  );
  const flushIntervalMs = clampInteger(
    options.flushIntervalMs,
    0,
    Number.MAX_SAFE_INTEGER,
    DEFAULT_FLUSH_INTERVAL_MS,
  );
  const maxQueueSize = clampInteger(
    options.maxQueueSize,
    1,
    Number.MAX_SAFE_INTEGER,
    DEFAULT_MAX_QUEUE_SIZE,
  );
  const maxFlushPasses = Math.ceil(maxQueueSize / MAX_EVENTS_PER_BATCH) + 1;

  const redactor = createRedactor(options.redaction);
  const collector =
    options.autoContext === false
      ? emptyContextCollector
      : adapter.createCollector(clampShort(options.sessionId));
  const sessionId = clampShort(collector.sessionId() ?? options.sessionId);
  const queue = new BoundedQueue<LogEventPayload>(maxQueueSize);

  let staticContext = normalizeContext(options.context, redactor);
  let active = options.enabled !== false;
  let transport: Transport | undefined;

  if (active) {
    transport = options.transport ?? buildTransport();
    if (!transport) active = false;
  }

  function buildTransport(): Transport | undefined {
    const credential = checkCredential(
      options.apiKey ?? readEnv(API_KEY_ENV_VAR),
      source,
    );
    if (!credential.ok) {
      report(new Error(credential.reason), "logger.config");
      return undefined;
    }

    const endpoint = resolveEndpoint(options.endpoint);
    if (!endpoint) {
      report(
        new Error("no ingest endpoint could be resolved"),
        "logger.config",
      );
      return undefined;
    }

    return createHttpTransport({ endpoint, apiKey: credential.apiKey, report });
  }

  let sentCount = 0;
  let failedCount = 0;
  let discardedCount = 0;
  let consecutiveFailures = 0;
  let nextAttemptAt = 0;
  let cancelTimer: CancelScheduled | undefined;
  let pending: Promise<void> = Promise.resolve();

  function clearTimer(): void {
    cancelTimer?.();
    cancelTimer = undefined;
  }

  function armTimer(delayMs: number): void {
    if (cancelTimer || !active) return;
    cancelTimer = scheduleAfter(() => {
      cancelTimer = undefined;
      void enqueueDrain(false);
    }, delayMs);
  }

  function armIdle(): void {
    clearTimer();
    cancelTimer = scheduleIdle(() => {
      cancelTimer = undefined;
      void enqueueDrain(false);
    });
  }

  function buildBatch(events: LogEventPayload[]): IngestBatch {
    return {
      sdk: SDK_INFO,
      environment,
      source,
      ...(release !== undefined && { release }),
      ...(sessionId !== undefined && { sessionId }),
      events,
    };
  }

  function onOutcome(
    outcome: TransportOutcome,
    events: LogEventPayload[],
  ): boolean {
    if (outcome.kind === "sent") {
      sentCount += outcome.accepted;
      consecutiveFailures = 0;
      nextAttemptAt = 0;
      return true;
    }

    failedCount += 1;

    if (outcome.kind === "disabled") {
      report(new Error(outcome.reason), "logger.transport");
      teardown();
      return false;
    }

    if (outcome.kind === "dropped") {
      discardedCount += events.length;
      report(new Error(outcome.reason), "logger.transport");
      return false;
    }

    consecutiveFailures += 1;
    if (consecutiveFailures < MAX_SEND_ATTEMPTS) {
      queue.restore(events);
    } else {
      discardedCount += events.length;
    }

    const backoffMs =
      outcome.retryAfterMs ??
      Math.min(
        MAX_RETRY_DELAY_MS,
        MIN_RETRY_DELAY_MS * 2 ** (consecutiveFailures - 1),
      );
    nextAttemptAt = Date.now() + backoffMs;
    armTimer(backoffMs);
    return false;
  }

  async function sendOneBatch(urgent: boolean): Promise<boolean> {
    if (!active || !transport || queue.size === 0) return false;

    if (!urgent && Date.now() < nextAttemptAt) {
      armTimer(nextAttemptAt - Date.now());
      return false;
    }

    // While the endpoint is failing, probe with a single event instead of
    // spending a hundred on every attempt.
    const limit =
      consecutiveFailures >= MAX_SEND_ATTEMPTS ? 1 : MAX_EVENTS_PER_BATCH;
    const taken = queue.take(limit);
    if (taken.length === 0) return false;

    let events = taken;
    if (urgent) {
      const room = keepaliveBatchSize(taken);
      if (room < taken.length) {
        events = taken.slice(0, room);
        queue.restore(taken.slice(room));
      }
    }

    const sender = transport;
    // Suppressed for the synchronous part of the send, so a transport that
    // reports its own trouble to the console cannot turn a failing network
    // into an ever-growing queue of failure messages.
    const outcome =
      (await safelyAsync(
        () =>
          runSuppressed(() =>
            sender.send({ batch: buildBatch(events), urgent }),
          ),
        report,
        "logger.send",
      )) ?? ({ kind: "retry" } as const);

    return onOutcome(outcome, events);
  }

  async function drain(urgent: boolean): Promise<void> {
    for (let pass = 0; pass < maxFlushPasses; pass += 1) {
      const progressed = await sendOneBatch(urgent);
      if (!progressed || queue.size === 0) break;
    }
    if (active && queue.size > 0) armTimer(flushIntervalMs);
  }

  /**
   * Serialises flushes onto one chain so overlapping triggers — the interval,
   * a full batch and an explicit `flush()` — can never send the same events
   * twice, and so the promise an awaiting caller holds covers the flush that
   * is actually running.
   */
  function enqueueDrain(urgent: boolean): Promise<void> {
    pending = pending.then(() => drain(urgent)).catch(() => undefined);
    return pending;
  }

  function teardown(): void {
    active = false;
    clearTimer();
    discardedCount += queue.size;
    queue.clear();
    removeLifecycle();
  }

  function capture(input: CaptureInput): void {
    if (!active || isSuppressed()) return;

    safely(
      () =>
        runSuppressed(() => {
          const level = isLogLevel(input.level) ? input.level : "info";
          if (levelRank(level) < minRank) return;

          const rate = resolveSampleRate(
            level,
            options.sampleRate,
            options.sampleRates,
          );
          if (!shouldSample(rate, Math.random)) return;

          const collected = collector.collect();
          const context = mergeContext(
            collected.context,
            staticContext,
            normalizeContext(input.context, redactor),
          );
          const error = serializeError(input.error);

          queue.push({
            ts: Date.now(),
            level,
            message: toMessage(input.message),
            logger: input.logger ?? "manual",
            ...(context !== undefined && { context }),
            ...(error !== undefined && { error }),
            ...(collected.url !== undefined && { url: collected.url }),
            ...(collected.userAgent !== undefined && {
              userAgent: collected.userAgent,
            }),
          });

          if (queue.size >= batchSize) {
            armIdle();
            return;
          }
          armTimer(flushIntervalMs);
        }),
      report,
      "logger.capture",
    );
  }

  function at(level: LogLevel) {
    return (message: unknown, context?: LogContext): void => {
      capture({ level, message, ...(context !== undefined && { context }) });
    };
  }

  const removeLifecycle = active
    ? adapter.installLifecycle((urgent) => {
        void enqueueDrain(urgent);
      })
    : (): void => {};

  return {
    trace: at("trace"),
    debug: at("debug"),
    info: at("info"),
    log: at("info"),
    warn: at("warn"),
    error: at("error"),
    fatal: at("fatal"),
    capture,
    flush: () => enqueueDrain(false),
    async close(): Promise<void> {
      await enqueueDrain(false);
      teardown();
    },
    setContext(context: LogContext | undefined): void {
      safely(
        () => {
          staticContext = normalizeContext(context, redactor);
        },
        report,
        "logger.setContext",
      );
    },
    get stats(): LoggerStats {
      return {
        queued: queue.size,
        dropped: queue.droppedCount + discardedCount,
        sent: sentCount,
        failed: failedCount,
      };
    },
    get enabled(): boolean {
      return active;
    },
  };
}
