import { MAX_SHORT_FIELD_LENGTH } from "../contract";
import type { JsonObject } from "../types";
import { getProcess, readEnv } from "./runtime";
import type { CollectedContext, ContextCollector } from "./collector";

/**
 * What a Node process reports about itself: hostname, pid and runtime version.
 *
 * Read entirely off `globalThis.process`. Importing `node:os` for a real
 * hostname would give a better answer on bare metal, but it would also make
 * this module — which the isomorphic entry point pulls in — carry a hard
 * dependency on a Node built-in, which bundlers targeting the browser or the
 * edge either shim or fail on. `HOSTNAME` is set by every container runtime,
 * which is where these processes actually live; where it is not, the field is
 * simply absent rather than the bundle being broken.
 *
 * All three values are constant for the life of the process, so they are
 * resolved once and reused rather than re-read per event.
 */

/** Environment variable conventionally carrying the host name. */
const HOSTNAME_ENV_VAR = "HOSTNAME";

function collectOnce(): JsonObject {
  const runtime = getProcess();
  const context: JsonObject = {};

  const hostname = readEnv(HOSTNAME_ENV_VAR);
  if (hostname) context.hostname = hostname.slice(0, MAX_SHORT_FIELD_LENGTH);

  if (typeof runtime?.pid === "number") context.pid = runtime.pid;
  if (typeof runtime?.version === "string")
    context.nodeVersion = runtime.version;
  if (typeof runtime?.platform === "string")
    context.platform = runtime.platform;

  return context;
}

/**
 * Builds the Node context collector.
 *
 * @param sessionIdOverride - An identifier correlating a run or a request.
 *   Node has no ambient session, so nothing is invented when it is omitted.
 * @returns The collector.
 */
export function createNodeContextCollector(
  sessionIdOverride: string | undefined,
): ContextCollector {
  let cached: JsonObject | undefined;

  return {
    sessionId: () => sessionIdOverride,
    collect(): CollectedContext {
      cached ??= collectOnce();
      return { context: cached };
    },
  };
}
