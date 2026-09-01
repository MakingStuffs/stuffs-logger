/**
 * The CORS preflight's answer, cached and throttled.
 *
 * `OPTIONS /api/v1/ingest` is UNAUTHENTICATED by construction: a browser sends
 * no custom headers on a preflight, so there is no key to verify. Answering it
 * with a database query per request makes an anonymous caller's cheapest
 * possible request into work for our Postgres, and the query is a containment
 * test over an array column.
 *
 * Two bounds, in front of the lookup:
 *
 *  - **A short TTL cache.** The registered-origin set changes when someone
 *    edits a key in the dashboard, which is rare; a minute of staleness costs
 *    a developer one minute and costs an attacker their amplifier. Cached
 *    answers are per instance and grant nothing on their own — the POST still
 *    verifies the key and re-checks the origin against THAT key's own list.
 *  - **A lookup budget.** Once the uncached lookups for a window are spent,
 *    unknown origins are refused without touching the database at all. Failing
 *    closed costs a legitimate new origin one preflight retry; failing open
 *    would hand the endpoint straight back to the flood.
 */

/** How long an answer stays usable, in milliseconds. */
export const ORIGIN_CACHE_TTL_MS = 60_000;

/** Distinct origins cached per instance, so the map cannot grow unbounded. */
export const ORIGIN_CACHE_MAX_ENTRIES = 1_000;

/** Uncached lookups permitted per window, across all origins. */
export const ORIGIN_LOOKUP_BUDGET = 60;

/** Length of the lookup budget's window, in milliseconds. */
export const ORIGIN_LOOKUP_WINDOW_MS = 60_000;

interface CacheEntry {
  registered: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const budget = { windowStartedAt: 0, spent: 0 };

/** Whether an uncached lookup may be issued, counting it if so. */
function claimLookup(now: number): boolean {
  if (now - budget.windowStartedAt >= ORIGIN_LOOKUP_WINDOW_MS) {
    budget.windowStartedAt = now;
    budget.spent = 0;
  }

  if (budget.spent >= ORIGIN_LOOKUP_BUDGET) return false;

  budget.spent += 1;
  return true;
}

/** Drops expired entries, then the oldest, once the cache is full. */
function evictIfNeeded(now: number): void {
  if (cache.size < ORIGIN_CACHE_MAX_ENTRIES) return;

  for (const [origin, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(origin);
  }

  while (cache.size >= ORIGIN_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Whether any live public key registers this origin, from cache where possible.
 *
 * @param origin - The `Origin` header from the preflight, untrusted.
 * @param lookup - The authoritative check, called only on a cache miss with
 *   budget left.
 * @param now - Epoch milliseconds; injected so tests need no real clock.
 * @returns Whether to echo the origin back as allowed.
 */
export async function isOriginRegisteredCached(
  origin: string,
  lookup: (origin: string) => Promise<boolean>,
  now: number = Date.now(),
): Promise<boolean> {
  const cached = cache.get(origin);
  if (cached !== undefined && cached.expiresAt > now) return cached.registered;

  if (!claimLookup(now)) return false;

  const registered = await lookup(origin);

  evictIfNeeded(now);
  cache.set(origin, { registered, expiresAt: now + ORIGIN_CACHE_TTL_MS });

  return registered;
}

/** Clears the cache and budget. Test-only seam; never called by app code. */
export function resetOriginRegistryCache(): void {
  cache.clear();
  budget.windowStartedAt = 0;
  budget.spent = 0;
}
