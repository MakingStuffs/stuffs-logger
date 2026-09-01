import { levelRank, LOG_LEVELS } from "../contract";
import type {
  IngestBatch,
  LogEventPayload,
  LogLevel,
  SdkInfo,
} from "../contract";
import type { RuntimeAdapter } from "../context/adapter";
import { emptyContextCollector } from "../context/collector";
import { SDK_NAME, SDK_VERSION } from "../defaults";
import type {
  CaptureInput,
  Logger,
  LoggerOptions,
  LoggerStats,
  LogContext,
  Transport,
  TransportOutcome,
} from "../types";
import { batchByteBudget, countWithinByteBudget } from "./batching";
import { createEventFactory } from "./event-factory";
import { createFailurePolicy } from "./failure-policy";
import { createFlushTimer } from "./flush-timer";
import { createDiagnostics, safely, safelyAsync } from "./no-throw";
import { clampShort, resolveOptions } from "./options";
import { BoundedQueue } from "./queue";
import { createRedactor } from "./redact";
import { resolveTransport } from "./resolve-transport";
import { resolveSampleRate, shouldSample } from "./sampling";
import { isSuppressed, runSuppressed } from "./suppression";

/**
 * The thin orchestrator: configuration in, {@link Logger} out.
 *
 * Every hard problem is solved in its own module — bounding memory in
 * `./queue`, option clamping in `./options`, what an event says in
 * `./event-factory`, retry policy in `./failure-policy`, body limits in
 * `./batching`, scheduling in `./flush-timer`, the network in `./transport`,
 * host differences in `../context/adapter`. What is left here is the flush
 * state machine, which is the one piece of behaviour that genuinely needs to
 * see all of them at once.
 */

const SDK_INFO: SdkInfo = { name: SDK_NAME, version: SDK_VERSION };

function isLogLevel(value: unknown): value is LogLevel {
  return LOG_LEVELS.includes(value as LogLevel);
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
  const {
    source,
    environment,
    release,
    minRank,
    batchSize,
    flushIntervalMs,
    maxQueueSize,
    maxFlushPasses,
  } = resolveOptions(options, adapter);

  const redactor = createRedactor(options.redaction);
  const collector =
    options.autoContext === false
      ? emptyContextCollector
      : adapter.createCollector(clampShort(options.sessionId));
  const sessionId = clampShort(collector.sessionId() ?? options.sessionId);
  const events = createEventFactory({
    collector,
    redactor,
    context: options.context,
  });
  const queue = new BoundedQueue<LogEventPayload>(maxQueueSize);
  const policy = createFailurePolicy();
  const timer = createFlushTimer(() => {
    void enqueueDrain(false);
  });

  let active = options.enabled !== false;
  let transport: Transport | undefined;

  if (active) {
    transport = resolveTransport(options, source, report);
    if (!transport) active = false;
  }

  let sentCount = 0;
  let failedCount = 0;
  let discardedCount = 0;
  let pending: Promise<void> = Promise.resolve();
  let pendingUrgent: Promise<void> = Promise.resolve();

  function armTimer(delayMs: number): void {
    if (!active) return;
    timer.arm(delayMs);
  }

  function buildBatch(batchEvents: LogEventPayload[]): IngestBatch {
    return {
      sdk: SDK_INFO,
      environment,
      source,
      ...(release !== undefined && { release }),
      ...(sessionId !== undefined && { sessionId }),
      events: batchEvents,
    };
  }

  function onOutcome(
    outcome: TransportOutcome,
    sent: LogEventPayload[],
  ): boolean {
    if (outcome.kind === "sent") {
      sentCount += outcome.accepted;
      policy.recordSuccess();
      return true;
    }

    failedCount += 1;

    if (outcome.kind === "disabled") {
      report(new Error(outcome.reason), "logger.transport");
      teardown();
      return false;
    }

    if (outcome.kind === "dropped") {
      // A batch refused only by the unload path's smaller keepalive cap is put
      // back, not destroyed: the browser fires an urgent flush on every tab
      // switch, and the same events fit the server's limit comfortably on the
      // next ordinary flush. Nothing else is requeued — a drop that would
      // repeat is a loop, so every other refusal stays final.
      if (outcome.cause === "urgent-body-limit") {
        queue.restore(sent);
        return false;
      }

      discardedCount += sent.length;
      report(new Error(outcome.reason), "logger.transport");
      return false;
    }

    const decision = policy.recordFailure(outcome.retryAfterMs, Date.now());
    if (decision.requeue) {
      queue.restore(sent);
    } else {
      discardedCount += sent.length;
    }

    armTimer(decision.retryInMs);
    return false;
  }

  /**
   * Takes what may be sent now, splitting on the body limit.
   *
   * The contract bounds a body in UTF-8 bytes, so an over-large batch is split
   * HERE rather than left for the server to refuse with a `413` the transport
   * can only read as "condemned": the remainder goes back to the front of the
   * queue and travels in the next request.
   */
  function takeBatch(urgent: boolean): LogEventPayload[] {
    const taken = queue.take(policy.eventsPerAttempt);
    const room = countWithinByteBudget(taken, batchByteBudget(urgent));

    if (room >= taken.length) return taken;

    queue.restore(taken.slice(room));
    return taken.slice(0, room);
  }

  async function sendOneBatch(urgent: boolean): Promise<boolean> {
    if (!active || !transport || queue.size === 0) return false;

    if (!urgent) {
      const waitMs = policy.waitMs(Date.now());
      if (waitMs > 0) {
        armTimer(waitMs);
        return false;
      }
    }

    const batch = takeBatch(urgent);
    if (batch.length === 0) return false;

    const sender = transport;
    // Suppressed for the synchronous part of the send, so a transport that
    // reports its own trouble to the console cannot turn a failing network
    // into an ever-growing queue of failure messages.
    const outcome =
      (await safelyAsync(
        () =>
          runSuppressed(() =>
            sender.send({ batch: buildBatch(batch), urgent }),
          ),
        report,
        "logger.send",
      )) ?? ({ kind: "retry" } as const);

    return onOutcome(outcome, batch);
  }

  /**
   * An urgent drain sends exactly ONE request: browsers cap the COMBINED body
   * of all in-flight keepalive requests at 64 KiB, so a second one would only
   * make the first fail. Whatever did not fit stays queued for the next page
   * view rather than being thrown at a budget that is already spent.
   */
  async function drain(urgent: boolean): Promise<void> {
    const passes = urgent ? 1 : maxFlushPasses;

    for (let pass = 0; pass < passes; pass += 1) {
      const progressed = await sendOneBatch(urgent);
      if (!progressed || queue.size === 0) break;
    }
    if (active && queue.size > 0) armTimer(flushIntervalMs);
  }

  /**
   * Serializes ordinary flushes onto one chain so overlapping triggers — the
   * interval, a full batch and an explicit `flush()` — can never send the same
   * events twice, and so the promise an awaiting caller holds covers the flush
   * that is actually running.
   *
   * The unload path gets a chain of its OWN. Sharing one would mean a slow
   * ordinary flush, which is exactly what a bad network produces, holding the
   * keepalive send until after the document is gone — losing the batch in the
   * one situation the unload path exists for. Concurrency is safe because
   * taking from the queue is synchronous: two drains can never hold the same
   * event.
   */
  function enqueueDrain(urgent: boolean): Promise<void> {
    if (urgent) {
      pendingUrgent = pendingUrgent
        .then(() => drain(true))
        .catch(() => undefined);
      return pendingUrgent;
    }

    pending = pending.then(() => drain(false)).catch(() => undefined);
    return pending;
  }

  function teardown(): void {
    active = false;
    timer.cancel();
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

          queue.push(events.build(input, level));

          if (queue.size >= batchSize) {
            timer.armIdle();
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
          events.setStaticContext(context);
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
