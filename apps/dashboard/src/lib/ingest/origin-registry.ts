/**
 * The CORS preflight's answer, served from a snapshot of the whole registry.
 *
 * `OPTIONS /api/v1/ingest` is UNAUTHENTICATED by construction: a browser sends
 * no custom headers on a preflight, so there is no key to verify. Answering it
 * with a database query per request makes an anonymous caller's cheapest
 * possible request into work for our Postgres.
 *
 * So the preflight does not ask about an origin at all. The full set of
 * registered origins is loaded ONCE per TTL and every preflight in that window
 * is answered from memory — which makes the cost of the unauthenticated path
 * independent of who calls it, or how often, or with how many distinct
 * `Origin` values. A per-origin cache could not do that: an attacker spraying
 * distinct origins misses it on every request, and any budget protecting the
 * lookups behind it is a budget they can spend on everyone else's behalf.
 *
 * The set is small by construction — live PUBLIC keys, each capped at
 * `MAX_ALLOWED_ORIGINS` (20) entries by `lib/apps/actions` — so holding all of
 * it is cheaper than the map of per-origin answers it replaces.
 *
 * A minute of staleness costs a developer who has just added an origin one
 * minute; the snapshot grants nothing on its own, because the POST still
 * verifies the key and re-checks the origin against THAT key's own list.
 */

/** How long a snapshot answers preflights before it is refreshed. */
export const ORIGIN_SNAPSHOT_TTL_MS = 60_000;

/**
 * How long to wait after a failed refresh before trying again.
 *
 * Shorter than the TTL so a blip recovers quickly, long enough that an
 * unreachable database cannot be turned back into a query per preflight.
 */
export const ORIGIN_SNAPSHOT_RETRY_MS = 5_000;

/** Loads every origin registered by a live public key. */
export type RegisteredOriginLoader = () => Promise<readonly string[]>;

interface OriginSnapshot {
  origins: ReadonlySet<string>;
  expiresAt: number;
}

let snapshot: OriginSnapshot | null = null;

/** The refresh in flight, so concurrent preflights share one query. */
let refresh: Promise<void> | null = null;

function refreshSnapshot(
  loadOrigins: RegisteredOriginLoader,
  now: number,
): Promise<void> {
  if (refresh !== null) return refresh;

  const pending = loadOrigins()
    .then((origins) => {
      snapshot = {
        origins: new Set(origins),
        expiresAt: now + ORIGIN_SNAPSHOT_TTL_MS,
      };
    })
    .catch((error: unknown) => {
      // Fails closed and stays quiet: the previous snapshot keeps answering if
      // there is one — it can only grant origins that WERE registered — and
      // there being none means every origin is refused until the next attempt.
      console.warn(
        "[ingest] could not refresh the registered-origin snapshot:",
        error,
      );

      snapshot = {
        origins: snapshot?.origins ?? new Set<string>(),
        expiresAt: now + ORIGIN_SNAPSHOT_RETRY_MS,
      };
    })
    .finally(() => {
      if (refresh === pending) refresh = null;
    });

  refresh = pending;
  return pending;
}

/**
 * Whether any live public key registers this origin.
 *
 * @param origin - The `Origin` header from the preflight, untrusted.
 * @param loadOrigins - Loads the whole registered set; called at most once per
 *   TTL, never once per origin.
 * @param now - Epoch milliseconds; injected so tests need no real clock.
 * @returns Whether to echo the origin back as allowed.
 */
export async function isOriginRegisteredCached(
  origin: string,
  loadOrigins: RegisteredOriginLoader,
  now: number = Date.now(),
): Promise<boolean> {
  const current = snapshot;
  if (current === null || current.expiresAt <= now) {
    await refreshSnapshot(loadOrigins, now);
  }

  return snapshot?.origins.has(origin) ?? false;
}

/** Drops the snapshot. Test-only seam; never called by app code. */
export function resetOriginRegistrySnapshot(): void {
  snapshot = null;
  refresh = null;
}
