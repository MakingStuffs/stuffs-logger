/**
 * Per-account throttling of password attempts — the FAST FIRST LINE, not a
 * distributed ceiling.
 *
 * WHY IT EXISTS HERE. Better Auth rate-limits its own HTTP endpoints inside
 * the router, and the sign-in form deliberately does NOT go through the router
 * (a native form POST to `/api/auth/sign-in/email` answers `200` with a JSON
 * body, which is not a sign-in page). The form calls `auth.api.signInEmail`
 * from a Server Action instead, and `auth.api.*` bypasses the router's rate
 * limiter — so without this, the sign-in action would be an unthrottled
 * password-guessing endpoint. That is the hole this closes.
 *
 * WHAT IT IS NOT. The counters live in this module's memory, so on a
 * serverless host each concurrent instance keeps its own copy and a cold start
 * resets a window: the effective ceiling is `limit x live instances`. That
 * bounds a script hammering one account far below what an unthrottled endpoint
 * allows, and it does not claim to be a distributed limit. Making it durable
 * means a shared store, which is a deliberate future step.
 *
 * KEYED ON THE ACCOUNT, not the client address, because the address is
 * whatever a proxy header says and the thing worth protecting is a specific
 * colleague's password.
 */

/** Attempts permitted per account per window. */
export const SIGN_IN_MAX_ATTEMPTS = 10;

/** Length of the fixed window, in milliseconds. */
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Cap on tracked accounts, so a stream of invented addresses cannot grow the
 * map without bound on an instance that is never recycled.
 */
const MAX_TRACKED_IDENTITIES = 10_000;

interface WindowState {
  /** When the current window started. */
  startedAt: number;
  /** Attempts counted in the current window. */
  count: number;
}

const windows = new Map<string, WindowState>();

/** The outcome of counting an attempt. */
export interface SignInThrottleResult {
  /** Whether the attempt may be tried against the credential store. */
  allowed: boolean;
  /** Seconds until the window resets, for the message shown to the user. */
  retryAfterSeconds: number;
}

const ALLOWED: SignInThrottleResult = { allowed: true, retryAfterSeconds: 0 };

/** Drops expired windows, then the oldest insertions if still over cap. */
function evictIfNeeded(now: number): void {
  if (windows.size < MAX_TRACKED_IDENTITIES) return;

  for (const [key, state] of windows) {
    if (now - state.startedAt >= SIGN_IN_WINDOW_MS) windows.delete(key);
  }

  // Still full of live windows: drop the oldest insertion, which `Map`
  // iterates first. Being wrong costs a guesser a reset window, never a
  // legitimate sign-in.
  while (windows.size >= MAX_TRACKED_IDENTITIES) {
    const oldest = windows.keys().next();
    if (oldest.done) break;
    windows.delete(oldest.value);
  }
}

/**
 * Normalises an address so `Victim@Example.test` and `victim@example.test`
 * share one window. Without this, case is a free way to multiply the
 * allowance.
 */
function identityKey(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Counts one sign-in attempt against an account's window.
 *
 * @param email - The address the attempt was made against, untrusted. An
 *   empty value is refused rather than pooled: a blank identity is not an
 *   account, and pooling every blank attempt into one window would let one
 *   caller lock that pool for everyone.
 * @param now - Current time in epoch milliseconds; injected so tests need no
 *   real clock.
 * @returns Whether to proceed, and how long until the window resets.
 * @example
 * const attempt = consumeSignInAttempt(email);
 * if (!attempt.allowed) return refuse(attempt.retryAfterSeconds);
 */
export function consumeSignInAttempt(
  email: string,
  now: number = Date.now(),
): SignInThrottleResult {
  const key = identityKey(email);
  if (key.length === 0) {
    return { allowed: false, retryAfterSeconds: SIGN_IN_WINDOW_MS / 1000 };
  }

  evictIfNeeded(now);

  const existing = windows.get(key);

  if (existing === undefined || now - existing.startedAt >= SIGN_IN_WINDOW_MS) {
    windows.set(key, { startedAt: now, count: 1 });
    return ALLOWED;
  }

  existing.count += 1;

  if (existing.count > SIGN_IN_MAX_ATTEMPTS) {
    const remaining = Math.max(
      0,
      SIGN_IN_WINDOW_MS - (now - existing.startedAt),
    );
    return { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) };
  }

  return ALLOWED;
}

/** Clears every window. Test-only seam; never called by application code. */
export function resetSignInThrottle(): void {
  windows.clear();
}
