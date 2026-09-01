/**
 * The Content Security Policy, shipped in REPORT-ONLY mode.
 *
 * The dashboard renders log lines containing whatever a customer application
 * logged, behind a session that can read every application's logs. React
 * escapes that text today, so the policy is defence in depth rather than a fix
 * for a known hole — but "the framework escapes it" is exactly the assumption
 * a future export view, a syntax highlighter or a `dangerouslySetInnerHTML`
 * quietly breaks.
 *
 * WHY REPORT-ONLY, AND HOW TO PROMOTE IT
 *
 * A nonce-based `script-src` is only safe to enforce once every script on
 * every page is known to carry the nonce. Enforcing it blind takes the
 * dashboard down for anything missed; report-only proves the policy first.
 * The promotion path is:
 *
 *  1. Point `report-uri`/`report-to` at a collector, or read the violations
 *     from the browser console on each route.
 *  2. Exercise every page, including the key-management dialogs.
 *  3. When the reports are clean, have `proxy.ts` also set the enforcing
 *     `Content-Security-Policy` header with the SAME string. Nothing else
 *     changes: the policy, the nonce plumbing and the header value are already
 *     what enforcement would use.
 *
 * `style-src` allows inline styles because Tailwind emits
 * them; that is a known, documented weakening rather than an oversight, and it
 * does not undermine `script-src`.
 *
 * EVERY DIRECTIVE IS `'self'` NOW. The app hosts its own authentication, so
 * there is no second origin to allow for session or sign-out calls. One thing
 * to revisit at promotion time: an OAuth sign-in leaves via a server-issued
 * redirect to the provider, and some browsers have historically applied
 * `form-action` to redirect targets — worth confirming against real reports
 * before this policy is switched from report-only to enforcing.
 */

/** Bytes of randomness in a nonce. 128 bits, per the CSP guidance. */
const NONCE_BYTES = 16;

/**
 * A fresh per-response nonce.
 *
 * Uses Web Crypto, which is present in both runtimes a proxy file can run in.
 * A nonce that repeats across responses is a nonce an injected script can
 * predict, so it is generated per request and never cached.
 *
 * @returns A base64 nonce.
 */
export function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

  return btoa(String.fromCharCode(...bytes));
}

/**
 * Builds the policy string for one response.
 *
 * @param nonce - The nonce this response's scripts will carry.
 * @returns The policy, ready to use as a header value.
 * @example
 * buildContentSecurityPolicy("abc123"); // "default-src 'self'; ..."
 */
export function buildContentSecurityPolicy(nonce: string): string {
  const directives: Record<string, readonly string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets the nonced bootstrap load the chunks it needs
    // without every chunk URL being listed; the host allowlist is ignored by
    // browsers that honour it, and kept for those that do not.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
  };

  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

/** The header this policy is served under while it is being proved. */
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

/**
 * The header Next reads to discover the nonce.
 *
 * Next extracts `'nonce-…'` from the REQUEST's `content-security-policy` header
 * and stamps it onto the scripts it renders. Setting it on the request is what
 * makes the report-only policy on the response describe reality; the enforcing
 * header is deliberately not set on the response yet.
 */
export const CSP_REQUEST_HEADER = "content-security-policy";
