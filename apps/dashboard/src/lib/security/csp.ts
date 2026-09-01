import { PORTAL_URL } from "@/constants/environment";

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
 *  3. When the reports are clean, have `middleware.ts` also set the enforcing
 *     `Content-Security-Policy` header with the SAME string. Nothing else
 *     changes: the policy, the nonce plumbing and the header value are already
 *     what enforcement would use.
 *
 * `style-src` allows inline styles because Tailwind and salient-ui both emit
 * them; that is a known, documented weakening rather than an oversight, and it
 * does not undermine `script-src`.
 */

/** Bytes of randomness in a nonce. 128 bits, per the CSP guidance. */
const NONCE_BYTES = 16;

/**
 * A fresh per-response nonce.
 *
 * Uses Web Crypto, which exists in both the Edge and Node middleware runtimes.
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
 * @param portalUrl - The portal origin, allowed as a connect/form target for
 *   the shared sign-out and session calls. Defaults to the configured one.
 * @returns The policy, ready to use as a header value.
 * @example
 * buildContentSecurityPolicy("abc123"); // "default-src 'self'; ..."
 */
export function buildContentSecurityPolicy(
  nonce: string,
  portalUrl: string | undefined = PORTAL_URL,
): string {
  const portal = portalUrl ?? "";

  const directives: Record<string, readonly string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets the nonced bootstrap load the chunks it needs
    // without every chunk URL being listed; the host allowlist is ignored by
    // browsers that honour it, and kept for those that do not.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(portal ? [portal] : [])],
    "form-action": ["'self'", ...(portal ? [portal] : [])],
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
