/**
 * Pre-authentication throttling for the ingest endpoint, keyed on client
 * address and counting ONLY refused keys.
 *
 * Every well-formed but unknown key costs an indexed `findUnique` before it
 * is refused. The per-key rate limit cannot help — there is no key to count
 * against — so a caller spraying guesses pays nothing while the database
 * pays a lookup each. This module gives that caller a budget: after
 * `INVALID_KEY_MAX_REFUSALS` refusals in a window, their address is answered
 * 429 before the key is even parsed.
 *
 * Three deliberate narrowings keep it from being a weapon:
 *
 *  - Only `invalid_key` refusals count. A successful request does not, and
 *    neither does an origin refusal, which is reachable only with a LIVE key
 *    and is overwhelmingly a developer with a misconfigured allowlist.
 *  - A request with no client address is never throttled. Pooling every
 *    address-less caller into one bucket would let any one of them lock out
 *    all of the rest.
 *  - The address comes from the proxy's headers, so it is exactly as truthful
 *    as the proxy makes it. `DEPLOYMENT.md` tells the operator to SET
 *    `x-forwarded-for` rather than append to it; a proxy that appends leaves
 *    the first entry under the caller's control.
 *
 * Same shape as `./rate-limit`: fixed window, module memory, per instance,
 * reset on a cold start, capped so it cannot grow without bound. It is the
 * cheap first line; a WAF-level limit on the path is still recommended.
 */

/** Invalid-key refusals permitted per client address per window. */
export const INVALID_KEY_MAX_REFUSALS = 60;

/** Length of the fixed window, in milliseconds. */
export const INVALID_KEY_WINDOW_MS = 60_000;

/**
 * Cap on tracked addresses, so an instance that sees refusals from many
 * addresses before it is recycled cannot be made to hold them all.
 */
export const INVALID_KEY_MAX_TRACKED_CLIENTS = 10_000;

/**
 * Longest header value accepted as a client address. An IPv6 address with a
 * port and brackets is under 60 characters; anything longer is not an address
 * and is treated as absent rather than pooled.
 */
const MAX_CLIENT_IP_LENGTH = 64;

interface WindowState {
  /** When the current window started. */
  startedAt: number;
  /** Refusals counted in the current window. */
  count: number;
}

const windows = new Map<string, WindowState>();

/** Drops windows that have already expired, then the oldest if still over cap. */
function evictIfNeeded(now: number): void {
  if (windows.size < INVALID_KEY_MAX_TRACKED_CLIENTS) return;

  for (const [clientIp, state] of windows) {
    if (now - state.startedAt >= INVALID_KEY_WINDOW_MS)
      windows.delete(clientIp);
  }

  // Still full of live windows: drop the oldest insertion, which Map iterates
  // first. Being wrong here forgets a caller's refusals, never blocks one.
  while (windows.size >= INVALID_KEY_MAX_TRACKED_CLIENTS) {
    const oldest = windows.keys().next();
    if (oldest.done) break;
    windows.delete(oldest.value);
  }
}

/** A header value as a client address, or `null` when it cannot be one. */
function asClientIp(value: string | null): string | null {
  if (value === null) return null;

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CLIENT_IP_LENGTH)
    return null;
  return trimmed;
}

/**
 * The client address a reverse proxy recorded for a request.
 *
 * The first `x-forwarded-for` entry, then `x-real-ip`, then nothing. Both
 * headers are the proxy's to set; a request that reaches the process without
 * one has no address this module will trust, and is not throttled.
 *
 * @param headers - The request headers.
 * @returns The address, or `null` when none is present.
 * @example
 * clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
 * // "203.0.113.9"
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const firstHop =
    forwarded === null ? null : (forwarded.split(",")[0] ?? null);

  return asClientIp(firstHop) ?? asClientIp(headers.get("x-real-ip"));
}

/** The outcome of consulting the throttle. */
export type InvalidKeyThrottleResult =
  | { throttled: false }
  | {
      throttled: true;
      /** Seconds until the window resets, for the `Retry-After` header. */
      retryAfterSeconds: number;
    };

/**
 * Whether a client address has used up its invalid-key allowance.
 *
 * Read-only: consulting the throttle never counts anything. Call it BEFORE
 * key verification, so a throttled address costs no lookup.
 *
 * @param clientIp - The address from {@link clientIpFromHeaders}; never `null`.
 * @param now - Current time in epoch milliseconds; injected for tests.
 * @returns Whether to refuse, and how long until the window resets.
 */
export function checkInvalidKeyThrottle(
  clientIp: string,
  now: number = Date.now(),
): InvalidKeyThrottleResult {
  const state = windows.get(clientIp);
  if (state === undefined) return { throttled: false };

  const elapsed = now - state.startedAt;
  if (elapsed >= INVALID_KEY_WINDOW_MS) return { throttled: false };
  if (state.count < INVALID_KEY_MAX_REFUSALS) return { throttled: false };

  const remaining = Math.max(0, INVALID_KEY_WINDOW_MS - elapsed);
  return { throttled: true, retryAfterSeconds: Math.ceil(remaining / 1000) };
}

/**
 * Counts one invalid-key refusal against a client address.
 *
 * Call it AFTER verification has refused the key, and for that reason only.
 *
 * @param clientIp - The address from {@link clientIpFromHeaders}; never `null`.
 * @param now - Current time in epoch milliseconds; injected for tests.
 */
export function recordInvalidKeyRefusal(
  clientIp: string,
  now: number = Date.now(),
): void {
  evictIfNeeded(now);

  const existing = windows.get(clientIp);

  if (
    existing === undefined ||
    now - existing.startedAt >= INVALID_KEY_WINDOW_MS
  ) {
    windows.set(clientIp, { startedAt: now, count: 1 });
    return;
  }

  existing.count += 1;
}

/** Clears all windows. Test-only seam; never called by application code. */
export function resetInvalidKeyThrottle(): void {
  windows.clear();
}
