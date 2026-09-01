import type { RuntimeAdapter } from "../context/adapter";
import { emptyContextCollector } from "../context/collector";
import type { IngestBatch } from "../contract";
import type { Transport, TransportOutcome, TransportRequest } from "../types";

/**
 * Test doubles shared by the SDK's own suites.
 *
 * They live under `src/` rather than in a test folder so they typecheck under
 * the same strict settings as the code they stand in for — a fake transport
 * that has drifted from the {@link Transport} interface is worse than no test
 * at all. Nothing here is reachable from an entry point, so none of it is
 * bundled.
 */

/** A key of the shape the browser is allowed to use. */
export const PUBLIC_KEY = `slg_pub_${"a".repeat(32)}`;

/** A key of the shape only a server may use. */
export const SECRET_KEY = `slg_sec_keyid123_${"b".repeat(32)}`;

/** A transport that records what it was asked to send. */
export interface FakeTransport extends Transport {
  /** Every batch handed to {@link Transport.send}, in order. */
  readonly batches: IngestBatch[];
  /** Every event across every batch, in order. */
  readonly events: IngestBatch["events"];
  /** Replaces the outcome returned by subsequent sends. */
  respondWith(outcome: TransportOutcome): void;
  /** Makes subsequent sends reject, to exercise the no-throw guarantee. */
  rejectWith(error: unknown): void;
  /** Runs before each send resolves, for feedback-loop tests. */
  onSend(hook: () => void): void;
}

/**
 * Builds a transport double.
 *
 * @param initial - The outcome returned until `respondWith` changes it.
 * @returns The double.
 */
export function createFakeTransport(
  initial: TransportOutcome = { kind: "sent", accepted: 0 },
): FakeTransport {
  const batches: IngestBatch[] = [];
  let outcome = initial;
  let rejection: { error: unknown } | undefined;
  let hook: (() => void) | undefined;

  return {
    batches,
    get events(): IngestBatch["events"] {
      return batches.flatMap((batch) => batch.events);
    },
    respondWith(next: TransportOutcome): void {
      rejection = undefined;
      outcome = next;
    },
    rejectWith(error: unknown): void {
      rejection = { error };
    },
    onSend(next: () => void): void {
      hook = next;
    },
    send({ batch }: TransportRequest): Promise<TransportOutcome> {
      batches.push(batch);
      hook?.();
      if (rejection) return Promise.reject(rejection.error);
      return Promise.resolve(
        outcome.kind === "sent"
          ? { kind: "sent", accepted: batch.events.length }
          : outcome,
      );
    },
  };
}

/**
 * A runtime adapter with no host at all.
 *
 * @param overrides - Fields to replace, e.g. a collector under test.
 * @returns The adapter.
 */
export function createTestAdapter(
  overrides: Partial<RuntimeAdapter> = {},
): RuntimeAdapter {
  return {
    source: "node",
    createCollector: () => emptyContextCollector,
    installLifecycle: () => () => {},
    ...overrides,
  };
}
