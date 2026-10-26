import { MAX_URL_LENGTH, MAX_USER_AGENT_LENGTH } from "../contract";
import { clampString } from "../logger/sanitize";
import { resolveSessionId } from "./session";
import type { CollectedContext, ContextCollector } from "./collector";

/**
 * What the browser reports about itself.
 *
 * Deliberately limited to the url, the user agent and the viewport. Nothing
 * here reads storage, cookies, form state, referrers or any other ambient
 * data: a logging SDK that quietly hoovers up the page is a data-protection
 * incident waiting to happen, and anything beyond this list is the
 * application's to pass explicitly.
 *
 * The device class the dashboard filters on is NOT sent. `@stuffs/logger-core`
 * derives it server-side from the user agent this collector already reports,
 * precisely so it cannot be a client-supplied — and therefore
 * attacker-supplied — filter value. Computing a second copy here would ship
 * bytes on every event to create a value that can disagree with the
 * authoritative one.
 */

function readUrl(): string | undefined {
  const href = globalThis.location?.href;
  if (typeof href !== "string" || href.length === 0) return undefined;
  return clampString(href, MAX_URL_LENGTH);
}

function readUserAgent(): string | undefined {
  const agent = globalThis.navigator?.userAgent;
  if (typeof agent !== "string" || agent.length === 0) return undefined;
  return clampString(agent, MAX_USER_AGENT_LENGTH);
}

function readViewport(): string | undefined {
  const width = globalThis.innerWidth;
  const height = globalThis.innerHeight;
  if (typeof width !== "number" || typeof height !== "number") return undefined;
  return `${Math.round(width)}x${Math.round(height)}`;
}

/**
 * Builds the browser context collector.
 *
 * The url and viewport are sampled per event rather than once, because a
 * single-page application changes both without reloading and an event
 * attributed to the entry route would be actively misleading.
 *
 * @param sessionIdOverride - Supplied when the host application already has a
 *   session identifier worth correlating on.
 * @returns The collector.
 * @example
 * createBrowserContextCollector(undefined).collect();
 * // { url: "https://…", userAgent: "…", context: { viewport: "1280x720" } }
 */
export function createBrowserContextCollector(
  sessionIdOverride: string | undefined,
): ContextCollector {
  let cachedSessionId: string | undefined;

  return {
    sessionId(): string | undefined {
      if (sessionIdOverride) return sessionIdOverride;
      cachedSessionId ??= resolveSessionId();
      return cachedSessionId;
    },

    collect(): CollectedContext {
      const url = readUrl();
      const userAgent = readUserAgent();
      const viewport = readViewport();

      return {
        ...(url !== undefined && { url }),
        ...(userAgent !== undefined && { userAgent }),
        ...(viewport !== undefined && { context: { viewport } }),
      };
    },
  };
}
