/**
 * Throttling for the `IngestKey.lastUsedAt` write.
 *
 * Ingest is the highest-volume path in the product. Stamping `lastUsedAt` on
 * every accepted batch would add a write to a hot row on every single request
 * — turning a read-mostly credential table into a write amplifier and a lock
 * contention point for no operational benefit, since nobody needs
 * second-accurate resolution on "when was this key last used".
 *
 * So the write is throttled to at most ONCE PER MINUTE PER KEY. The value is a
 * usage signal for the key-management UI, never a security control, so losing
 * up to a minute of resolution — or losing the memory entirely when a
 * serverless instance recycles, which only causes an extra write — costs
 * nothing.
 */

/** Minimum gap between two `lastUsedAt` writes for the same key. */
export const LAST_USED_THROTTLE_MS = 60_000;

/** Cap on tracked keys, bounding this instance's memory. */
const MAX_TRACKED_KEYS = 10_000;

const lastWrittenAt = new Map<string, number>();

/**
 * Whether this request should write `lastUsedAt` for the key.
 *
 * Claims the slot as a side effect: two concurrent calls within the window
 * cannot both be told to write.
 *
 * @param keyId - The verified key's id.
 * @param now - Current time in epoch milliseconds; injected for tests.
 * @returns Whether to perform the write.
 */
export function shouldStampLastUsed(
  keyId: string,
  now: number = Date.now(),
): boolean {
  const previous = lastWrittenAt.get(keyId);

  if (previous !== undefined && now - previous < LAST_USED_THROTTLE_MS)
    return false;

  if (lastWrittenAt.size >= MAX_TRACKED_KEYS) {
    for (const [key, at] of lastWrittenAt) {
      if (now - at >= LAST_USED_THROTTLE_MS) lastWrittenAt.delete(key);
    }
  }

  lastWrittenAt.set(keyId, now);
  return true;
}

/** Clears all throttle state. Test-only seam. */
export function resetLastUsedThrottle(): void {
  lastWrittenAt.clear();
}
