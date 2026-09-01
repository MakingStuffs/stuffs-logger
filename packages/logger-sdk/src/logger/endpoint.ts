import { INGEST_PATH } from "../contract";
import { isBrowserRuntime, readEnv } from "../context/runtime";

/**
 * Working out where batches go, from as little configuration as possible.
 *
 * Most deployments serve the dashboard and the app from the same origin, so
 * the browser default — the current origin plus the ingest path — needs no
 * configuration at all. Node has no ambient origin, so it falls back to an
 * environment variable before giving up.
 */

/** Environment variable consulted when no `endpoint` option is given. */
const ENDPOINT_ENV_VAR = "JF_LOGGER_ENDPOINT";

function withIngestPath(base: string): string | undefined {
  try {
    const url = new URL(base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.pathname.endsWith(INGEST_PATH)) return url.toString();

    const prefix = url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;
    url.pathname = `${prefix}${INGEST_PATH}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    // Not a URL at all.
    return undefined;
  }
}

/**
 * Resolves the absolute ingest URL.
 *
 * Accepts either an origin (`https://logs.example.com`) or a full ingest URL,
 * so a caller who copied the endpoint out of the dashboard and a caller who
 * only knows their host both get the same result.
 *
 * @param endpoint - The `endpoint` option, if supplied.
 * @returns The absolute URL, or `undefined` when none could be determined —
 *   the caller reports that and disables the logger rather than guessing.
 * @example
 * resolveEndpoint("https://logs.example.com");
 * // "https://logs.example.com/api/v1/ingest"
 */
export function resolveEndpoint(
  endpoint: string | undefined,
): string | undefined {
  if (endpoint) return withIngestPath(endpoint);

  const fromEnv = readEnv(ENDPOINT_ENV_VAR);
  if (fromEnv) return withIngestPath(fromEnv);

  if (isBrowserRuntime()) {
    const origin = window.location?.origin;
    if (typeof origin === "string" && origin.length > 0) {
      return withIngestPath(origin);
    }
  }

  return undefined;
}
