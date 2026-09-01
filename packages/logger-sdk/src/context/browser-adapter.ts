import { createBrowserContextCollector } from "./browser";
import type { RuntimeAdapter } from "./adapter";

/**
 * The browser runtime adapter.
 *
 * Delivery on navigation hangs on listening to the right events. `unload` and
 * `beforeunload` are unreliable on mobile — a tab backgrounded and then killed
 * fires neither — so the queue is flushed on `pagehide` and on the transition
 * to `visibilitychange`/hidden, which is the last moment mobile browsers
 * reliably give a page.
 */

function addListener(
  target: EventTarget | undefined,
  type: string,
  handler: () => void,
): (() => void) | undefined {
  if (typeof target?.addEventListener !== "function") return undefined;
  target.addEventListener(type, handler, { capture: true });
  return () => {
    target.removeEventListener(type, handler, { capture: true });
  };
}

/** The adapter used by the browser and isomorphic entry points. */
export const browserAdapter: RuntimeAdapter = {
  source: "browser",

  createCollector: (sessionIdOverride) =>
    createBrowserContextCollector(sessionIdOverride),

  installLifecycle(flush) {
    const onHidden = (): void => {
      if (globalThis.document?.visibilityState === "visible") return;
      flush(true);
    };

    const disposers = [
      addListener(globalThis.window, "pagehide", () => {
        flush(true);
      }),
      addListener(globalThis.document, "visibilitychange", onHidden),
    ];

    return () => {
      for (const dispose of disposers) dispose?.();
    };
  },
};
