import type { LogSource } from "../contract";
import type { ContextCollector } from "./collector";

/**
 * Everything `createLogger` needs to know about the host runtime, behind one
 * interface.
 *
 * The pipeline itself must not branch on `typeof window`: doing so would put a
 * dead Node code path in every browser bundle and make the whole thing
 * untestable without a DOM. Each entry point supplies the adapter for the
 * runtime it targets, and the isomorphic entry picks one at load time.
 */
export interface RuntimeAdapter {
  /** What batches from this runtime are attributed to. */
  readonly source: LogSource;
  /** Builds the ambient-context collector. */
  createCollector(sessionIdOverride: string | undefined): ContextCollector;
  /**
   * Wires the host's "we are about to lose this process/document" signals to a
   * flush.
   *
   * @param flush - Called with `urgent: true` when the flush must survive the
   *   teardown, which constrains how much may be sent.
   * @returns A disposer removing every listener installed.
   */
  installLifecycle(flush: (urgent: boolean) => void): () => void;
}
