/**
 * Throttling of password attempts — the FAST FIRST LINE, not a distributed
 * ceiling.
 *
 * WHY IT EXISTS HERE. Better Auth rate-limits its own HTTP endpoints inside
 * the router, and the sign-in form deliberately does NOT go through the router
 * (a native form POST to `/api/auth/sign-in/email` answers `200` with a JSON
 * body, which is not a sign-in page). The form calls `auth.api.signInEmail`
 * from a Server Action instead, and `auth.api.*` bypasses the router's rate
 * limiter — so without this, the sign-in action would be an unthrottled
 * password-guessing endpoint. The router's own sign-in route is disabled
 * (`disabledPaths` in `./auth.ts`), which makes this the ONLY password path
 * and this module the only thing counting it.
 *
 * WHAT IT IS NOT. The counters live in this module's memory, so on a
 * serverless host each concurrent instance keeps its own copy and a cold start
 * resets a window: the effective ceiling is `limit x live instances`. That
 * bounds a script hammering one account far below what an unthrottled endpoint
 * allows, and it does not claim to be a distributed limit. Making it durable
 * means a shared store, which is a deliberate future step.
 *
 * TWO WINDOWS PER ATTEMPT, because a single account-keyed counter fails in
 * both directions — ten submissions of a colleague's address from anywhere
 * locked that colleague out, and keying on the client instead would hand a
 * guesser spread across addresses an allowance per address:
 *
 * - The CLIENT window is keyed on `client address | account` and carries the
 *   tight ceiling, {@link SIGN_IN_MAX_ATTEMPTS}. A lockout now needs the
 *   victim's address AND their network position.
 * - The ACCOUNT window is keyed on the account alone and carries a looser
 *   ceiling, {@link SIGN_IN_MAX_ATTEMPTS_PER_ACCOUNT}, that bounds the
 *   distributed guesser. It counts only attempts the client window let
 *   through — the ones that reach the password hash — so a single locked-out
 *   address cannot drive it to a lockout for everyone else.
 *
 * WHEN NO ADDRESS IS KNOWN every caller shares one client window per account,
 * which is the pre-split behaviour: stricter, not looser, because "unknown" is
 * not a network position that distinguishes anybody. Next fills
 * `x-forwarded-for` from the socket when no proxy has, so this is the
 * exception. The address is whatever a proxy header says; a deployment with no
 * proxy in front lets a caller choose it, which is what the account window is
 * for.
 *
 * FAILURES ONLY. A slot is reserved BEFORE the credential is tried, so a
 * guessing loop never reaches the password hash; a success then clears both
 * windows ({@link clearSignInAttempts}), so ten legitimate sign-ins in a
 * quarter of an hour are not a lockout.
 */

import { resolveClientIp as resolveTrustedClientIp } from "@/lib/net/client-ip";

/** Attempts permitted per client address per account per window. */
export const SIGN_IN_MAX_ATTEMPTS = 10;

/**
 * Attempts permitted per account per window across every address. Looser,
 * because the thing it bounds is a guesser with many addresses, and the thing
 * it must not do is let one of those addresses lock the account's owner out.
 */
export const SIGN_IN_MAX_ATTEMPTS_PER_ACCOUNT = 50;

/** Length of the fixed window, in milliseconds. */
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Cap on tracked windows, so a stream of invented addresses cannot grow the
 * map without bound on an instance that is never recycled.
 */
const MAX_TRACKED_WINDOWS = 10_000;

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

/** The subset of `Headers` the throttle reads, so tests need no request. */
export type ClientIpSource = Pick<Headers, "get">;

const ALLOWED: SignInThrottleResult = { allowed: true, retryAfterSeconds: 0 };

/** Drops expired windows, then the oldest insertions if still over cap. */
function evictIfNeeded(now: number): void {
  if (windows.size < MAX_TRACKED_WINDOWS) return;

  for (const [key, state] of windows) {
    if (now - state.startedAt >= SIGN_IN_WINDOW_MS) windows.delete(key);
  }

  // Still full of live windows: drop the oldest insertion, which `Map`
  // iterates first. Being wrong costs a guesser a reset window, never a
  // legitimate sign-in.
  while (windows.size >= MAX_TRACKED_WINDOWS) {
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

/** The two windows one attempt against one account is counted in. */
function windowKeys(
  account: string,
  clientIp: string | null,
): { client: string; account: string } {
  return {
    client: `client:${clientIp ?? ""}|${account}`,
    account: `account:${account}`,
  };
}

/** Counts one attempt in one window, refusing it past the window's ceiling. */
function countAttempt(
  key: string,
  ceiling: number,
  now: number,
): SignInThrottleResult {
  const existing = windows.get(key);

  if (existing === undefined || now - existing.startedAt >= SIGN_IN_WINDOW_MS) {
    evictIfNeeded(now);
    windows.set(key, { startedAt: now, count: 1 });
    return ALLOWED;
  }

  existing.count += 1;

  if (existing.count > ceiling) {
    const remaining = Math.max(
      0,
      SIGN_IN_WINDOW_MS - (now - existing.startedAt),
    );
    return { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) };
  }

  return ALLOWED;
}

/**
 * The client address a request arrived from, as far as a TRUSTED proxy says.
 *
 * Delegates to `lib/net/client-ip`: only the `x-forwarded-for` entries that
 * `TRUSTED_PROXY_HOPS` vouches for count, because the leftmost entry is
 * whatever the client sent. With no trusted proxy this is `null`, and
 * {@link consumeSignInAttempt} keys the attempt on the account alone at the
 * strict ceiling — a caller cannot buy fresh windows by inventing addresses.
 *
 * @param headers - The request's headers. Attacker-influenced.
 * @returns The address, lower-cased, or `null` when no trusted proxy names one.
 * @example
 * resolveClientIp(await headers()); // "198.51.100.7" behind one trusted proxy
 */
export function resolveClientIp(headers: ClientIpSource): string | null {
  // One resolver for every per-address control: the leftmost forwarded entry
  // is whatever the client sent, so only proxy-vouched entries count, and
  // with no trusted proxy there is no address — the attempt is keyed on the
  // account alone, at the strict ceiling.
  return resolveTrustedClientIp(headers);
}

/**
 * Counts one sign-in attempt against an account, from a client address.
 *
 * @param email - The address the attempt was made against, untrusted. An
 *   empty value is refused rather than pooled: a blank identity is not an
 *   account, and pooling every blank attempt into one window would let one
 *   caller lock that pool for everyone.
 * @param clientIp - Where the attempt came from, per {@link resolveClientIp},
 *   or `null` when nothing says.
 * @param now - Current time in epoch milliseconds; injected so tests need no
 *   real clock.
 * @returns Whether to proceed, and how long until the window resets.
 * @example
 * const attempt = consumeSignInAttempt(email, resolveClientIp(headers));
 * if (!attempt.allowed) return refuse(attempt.retryAfterSeconds);
 */
export function consumeSignInAttempt(
  email: string,
  clientIp: string | null,
  now: number = Date.now(),
): SignInThrottleResult {
  const account = identityKey(email);
  if (account.length === 0) {
    return { allowed: false, retryAfterSeconds: SIGN_IN_WINDOW_MS / 1000 };
  }

  const keys = windowKeys(account, clientIp);

  // NO TRUSTED ADDRESS, NO TIGHT WINDOW. "Unknown" distinguishes nobody, so a
  // tight window keyed on it would be shared by every caller — and anyone who
  // knows a colleague's email could lock them out with ten wrong guesses. Only
  // the looser account ceiling applies: a lockout then costs five times the
  // attempts, and the ceiling still bounds guessing.
  if (clientIp === null) {
    return countAttempt(keys.account, SIGN_IN_MAX_ATTEMPTS_PER_ACCOUNT, now);
  }

  // The client window decides first, and a refusal stops here: an attempt
  // that never reaches the hash is not one the account window should count.
  const byClient = countAttempt(keys.client, SIGN_IN_MAX_ATTEMPTS, now);
  if (!byClient.allowed) return byClient;

  return countAttempt(keys.account, SIGN_IN_MAX_ATTEMPTS_PER_ACCOUNT, now);
}

/**
 * Forgets the attempts counted against an account from a client address.
 *
 * Called after a SUCCESSFUL sign-in and nowhere else: the windows exist to
 * count failures, and the one thing that proves the attempts before it were
 * the account's owner is the owner signing in. Only this address's client
 * window is cleared — another address still guessing stays locked.
 *
 * @param email - The address that just signed in.
 * @param clientIp - Where it signed in from, as given to
 *   {@link consumeSignInAttempt}.
 */
export function clearSignInAttempts(
  email: string,
  clientIp: string | null,
): void {
  const account = identityKey(email);
  if (account.length === 0) return;

  const keys = windowKeys(account, clientIp);
  windows.delete(keys.client);
  windows.delete(keys.account);
}

/** Clears every window. Test-only seam; never called by application code. */
export function resetSignInThrottle(): void {
  windows.clear();
}
