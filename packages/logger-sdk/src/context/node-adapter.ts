import { createNodeContextCollector } from "./node";
import { getProcess } from "./runtime";
import type { RuntimeAdapter } from "./adapter";

/**
 * The Node runtime adapter.
 *
 * `beforeExit` is the only teardown hook that can start asynchronous work and
 * have it complete: it fires when the event loop empties, and a pending flush
 * keeps the process alive for exactly as long as the flush needs. `exit` is
 * synchronous-only and would be useless here, and installing a `SIGINT`
 * handler would change how the process responds to Ctrl-C, which a logging
 * library has no business doing.
 */
export const nodeAdapter: RuntimeAdapter = {
  source: "node",

  createCollector: (sessionIdOverride) =>
    createNodeContextCollector(sessionIdOverride),

  installLifecycle(flush) {
    const runtime = getProcess();
    if (typeof runtime?.on !== "function") return () => {};

    const onBeforeExit = (): void => {
      flush(false);
    };

    runtime.on("beforeExit", onBeforeExit);

    return () => {
      runtime.off?.("beforeExit", onBeforeExit);
    };
  },
};
