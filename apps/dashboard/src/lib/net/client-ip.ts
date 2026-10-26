/**
 * The one answer to "which address did this request come from?".
 *
 * Every per-address control in the app — the sign-in throttle, the ingest
 * invalid-key throttle — asks this module and nothing else, because getting
 * the answer wrong is worse than not having one.
 *
 * WHY NOT THE FIRST `x-forwarded-for` ENTRY. That entry is whatever the
 * CLIENT sent: a proxy that appends leaves it untouched, and with no proxy at
 * all Next forwards a client-supplied header as-is (it only fills the header
 * in from the socket when it is ABSENT). Keying a throttle on it lets a caller
 * dodge the throttle by inventing an address per request, and — worse — pin a
 * throttle on somebody else's address, so a real application stops being able
 * to log because a stranger sent bad keys "from" its server.
 *
 * WHAT IS TRUSTED INSTEAD. Each proxy appends the address it received the
 * connection from, so the entries a deployment can vouch for are the ones on
 * the RIGHT, one per proxy it runs. With `TRUSTED_PROXY_HOPS=n`, the client
 * is the n-th entry from the right: the address the outermost trusted proxy
 * saw. Anything to its left was written by the client and is ignored.
 *
 * WHEN NOTHING IS TRUSTED, THERE IS NO ADDRESS. With no proxy configured the
 * header is attacker-controlled end to end, so this returns `null` and the
 * per-address controls fall back to what they do without one: the ingest
 * invalid-key throttle stands down, and the sign-in throttle keys on the
 * account alone at its strict ceiling. On Vercel the platform overwrites the
 * header with the real client, so one hop is trusted by default there.
 *
 * Pure apart from reading `process.env` as a default; inject `hops` in tests.
 */

/** The variable naming how many proxies in front of the app may be trusted. */
export const TRUSTED_PROXY_HOPS_VARIABLE = "TRUSTED_PROXY_HOPS";

/** More hops than any sane deployment has; a larger value is a typo. */
const MAX_TRUSTED_PROXY_HOPS = 10;

/** Longest plausible address (a bracketed IPv6 with a zone and port). */
const MAX_CLIENT_IP_LENGTH = 64;

/**
 * The characters an IPv4 or IPv6 address, with an optional port, bracket or
 * zone id, can contain. Anything else is not an address and keys nothing.
 */
const CLIENT_IP_PATTERN = /^[0-9a-z.:[\]%_-]+$/;

/** The environment this module reads, so it is testable without one. */
export type ClientIpEnvironment = Readonly<Record<string, string | undefined>>;

/** What a resolver needs from the request: just header lookup. */
export type ClientIpSource = Pick<Headers, "get">;

/**
 * How many proxies in front of the app this deployment trusts.
 *
 * `TRUSTED_PROXY_HOPS` when it is a whole number from 0 to 10; otherwise one
 * on Vercel (which overwrites the header itself) and none anywhere else. A
 * malformed value is treated as unset rather than guessed at.
 *
 * @param env - The environment to read.
 * @returns The number of right-hand `x-forwarded-for` entries to trust.
 * @example
 * trustedProxyHops({ TRUSTED_PROXY_HOPS: "1" }); // 1
 * trustedProxyHops({ VERCEL: "1" }); // 1
 * trustedProxyHops({}); // 0
 */
export function trustedProxyHops(env: ClientIpEnvironment): number {
  const raw = env[TRUSTED_PROXY_HOPS_VARIABLE]?.trim();

  if (raw !== undefined && /^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (hops <= MAX_TRUSTED_PROXY_HOPS) return hops;
  }

  return env.VERCEL === "1" ? 1 : 0;
}

/** A forwarded entry as a comparable address, or `null` if it is not one. */
function asClientIp(entry: string | undefined): string | null {
  if (entry === undefined) return null;

  const candidate = entry.trim().toLowerCase();
  if (candidate.length === 0 || candidate.length > MAX_CLIENT_IP_LENGTH)
    return null;

  return CLIENT_IP_PATTERN.test(candidate) ? candidate : null;
}

/**
 * The client address, as far as this deployment's proxies vouch for it.
 *
 * @param headers - The request headers.
 * @param hops - Trusted proxies; defaults to {@link trustedProxyHops} of the
 *   process environment, read on every call.
 * @returns The address the outermost trusted proxy recorded, or `null` when
 *   no proxy is trusted, the header is absent, or the chain is shorter than
 *   the configured hop count (the request did not come through the proxies).
 * @example
 * // TRUSTED_PROXY_HOPS=1, client sent a forged first entry:
 * resolveClientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }));
 * // "203.0.113.9"
 */
export function resolveClientIp(
  headers: ClientIpSource,
  hops: number = trustedProxyHops(process.env),
): string | null {
  if (hops <= 0) return null;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded === null) return null;

  const entries = forwarded.split(",");
  if (entries.length < hops) return null;

  return asClientIp(entries[entries.length - hops]);
}
