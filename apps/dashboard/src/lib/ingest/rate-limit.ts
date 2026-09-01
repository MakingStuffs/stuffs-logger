/**
 * Per-key rate limiting for the ingest endpoint.
 *
 * HONEST LIMITATION — THIS IS PER INSTANCE, NOT GLOBAL.
 *
 * The counters live in this module's memory. On Vercel (and any serverless
 * host) each concurrent instance has its own copy and instances come and go,
 * so the effective ceiling is `limit × live instances`, and a cold start
 * resets a caller's window. This is therefore a guard against an accidental
 * loop in a customer's app — a `console.log` inside a render, a retry storm —
 * and NOT a defence against a determined attacker with a valid key, who can
 * simply spread requests across instances.
 *
 * Making it real needs shared state (Redis / Vercel KV / Postgres) and a
 * network round trip on the hottest path in the product. That trade is worth
 * making when there is evidence it is needed; it is recorded as an open
 * question rather than pretended away here.
 */

/** Requests permitted per key per window. */
export const RATE_LIMIT_MAX_REQUESTS = 120;

/** Length of the fixed window, in milliseconds. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Cap on tracked keys, so the map cannot grow without bound on an instance
 * that sees traffic from many keys before it is recycled.
 */
const MAX_TRACKED_KEYS = 10_000;

interface WindowState {
  /** When the current window started. */
  startedAt: number;
  /** Requests counted in the current window. */
  count: number;
}

const windows = new Map<string, WindowState>();

/** Drops windows that have already expired, then the oldest if still over cap. */
function evictIfNeeded(now: number): void {
  if (windows.size < MAX_TRACKED_KEYS) return;

  for (const [key, state] of windows) {
    if (now - state.startedAt >= RATE_LIMIT_WINDOW_MS) windows.delete(key);
  }

  // Still full of live windows: drop the oldest insertion, which Map iterates
  // first. Being wrong here costs a caller a reset window, never access.
  while (windows.size >= MAX_TRACKED_KEYS) {
    const oldest = windows.keys().next();
    if (oldest.done) break;
    windows.delete(oldest.value);
  }
}

/** The outcome of a rate-limit check. */
export interface RateLimitResult {
  /** Whether the request may proceed. */
  allowed: boolean;
  /** Seconds until the current window resets, for the `Retry-After` header. */
  retryAfterSeconds: number;
}

/**
 * Counts a request against a key's window.
 *
 * @param keyId - The verified key's id. Never the credential itself.
 * @param now - Current time in epoch milliseconds; injected so tests need no
 *   real clock.
 * @returns Whether to proceed, and how long until the window resets.
 */
export function consumeRateLimit(
  keyId: string,
  now: number = Date.now(),
): RateLimitResult {
  evictIfNeeded(now);

  const existing = windows.get(keyId);

  if (
    existing === undefined ||
    now - existing.startedAt >= RATE_LIMIT_WINDOW_MS
  ) {
    windows.set(keyId, { startedAt: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;

  if (existing.count > RATE_LIMIT_MAX_REQUESTS) {
    const elapsed = now - existing.startedAt;
    const remaining = Math.max(0, RATE_LIMIT_WINDOW_MS - elapsed);
    return { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Clears all windows. Test-only seam; never called by application code. */
export function resetRateLimits(): void {
  windows.clear();
}
