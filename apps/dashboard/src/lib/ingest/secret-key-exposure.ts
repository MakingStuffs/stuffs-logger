import type { LogSource } from "@stuffs/logger-core";

import type { IngestKeyType } from "./keys";

/**
 * Spotting a SECRET key that has been shipped to browsers.
 *
 * A secret key is accepted from anywhere — that is what makes it the key a
 * server process uses — so nothing refuses one that arrives from a browser.
 * But a browser bundle is public, and a secret key in one is a secret key
 * anyone can read out of a view-source. The product decision is to keep
 * accepting the batch (dropping a customer's logs teaches them nothing) and
 * to say so in the server log, loudly enough to notice and quietly enough
 * not to drown everything else: once per key per minute, not once per batch.
 *
 * Same throttle shape as `./last-used`: module memory, per instance, capped.
 */

/** Minimum gap between two warnings about the same key. */
export const SECRET_EXPOSURE_WARN_THROTTLE_MS = 60_000;

/** Cap on tracked keys, bounding this instance's memory. */
const MAX_TRACKED_KEYS = 10_000;

const lastWarnedAt = new Map<string, number>();

/**
 * Whether a request looks like a secret key being used from a browser.
 *
 * Both signals are required. A browser is obliged to send `Origin` on a
 * cross-origin POST and the SDK declares `source: "browser"` when it runs in
 * one; a server process can forge either, but has no reason to forge both.
 *
 * @param keyType - The verified key's class.
 * @param origin - The request `Origin`, or `null` when absent.
 * @param source - The `source` the batch declared.
 * @returns Whether the warning applies.
 */
export function isSecretKeyExposedToBrowser(
  keyType: IngestKeyType,
  origin: string | null,
  source: LogSource,
): boolean {
  return keyType === "SECRET" && origin !== null && source === "browser";
}

/**
 * Whether this request should emit the exposure warning for the key.
 *
 * Claims the slot as a side effect, so two concurrent requests within the
 * window cannot both be told to warn.
 *
 * @param keyId - The verified key's id.
 * @param now - Current time in epoch milliseconds; injected for tests.
 * @returns Whether to warn.
 */
export function shouldWarnSecretKeyExposure(
  keyId: string,
  now: number = Date.now(),
): boolean {
  const previous = lastWarnedAt.get(keyId);

  if (
    previous !== undefined &&
    now - previous < SECRET_EXPOSURE_WARN_THROTTLE_MS
  ) {
    return false;
  }

  if (lastWarnedAt.size >= MAX_TRACKED_KEYS) {
    for (const [key, at] of lastWarnedAt) {
      if (now - at >= SECRET_EXPOSURE_WARN_THROTTLE_MS)
        lastWarnedAt.delete(key);
    }
  }

  lastWarnedAt.set(keyId, now);
  return true;
}

/** Clears all throttle state. Test-only seam. */
export function resetSecretKeyExposureWarnings(): void {
  lastWarnedAt.clear();
}
