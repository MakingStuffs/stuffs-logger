/**
 * Where a visitor is sent to sign in, and where they are sent back to.
 *
 * `returnTo` is the only value in the sign-in flow a stranger chooses: it
 * arrives in a link they can send to a colleague and it decides where that
 * colleague lands after typing their password. An unvalidated one turns the
 * sign-in page into a phishing springboard, so this module refuses anything
 * that is not a path on this app and replaces it with the app root.
 *
 * Pure and browser-safe: no request state, no I/O, so the rule can be tested
 * directly instead of through a redirect.
 */

/** The app's own sign-in page. This app hosts its own; there is no portal. */
export const SIGN_IN_PATH = "/sign-in";

/** The query parameter carrying the post-sign-in destination. */
export const RETURN_TO_PARAM = "returnTo";

/** Where a refused or absent return path lands. */
export const DEFAULT_RETURN_PATH = "/";

/**
 * A base used only to resolve a candidate path against.
 *
 * A CONSTANT SYNTHETIC ORIGIN, never the request's own: the question being
 * asked is "does this value stay relative?", and using an origin that no
 * request can ever carry means the answer cannot be influenced by a spoofed
 * `Host` or `x-forwarded-host` header. `.invalid` is reserved by RFC 2606, so
 * it can never resolve.
 */
const RESOLUTION_ORIGIN = "https://return-path.invalid";

/**
 * Reduces an untrusted return path to a path on this app.
 *
 * The value is PARSED rather than string-matched, which is what neutralises
 * `//evil.test` (protocol-relative), `\\evil.test` (backslashes, which the URL
 * parser folds to slashes for special schemes), `app.test@evil.test`
 * (userinfo hiding the real host) and `javascript:` / `data:` schemes alike —
 * all of them resolve to an origin that is not the resolution origin, and all
 * of them are refused. An absolute URL is refused even when it names this
 * app's own host, because a path is what the parameter is for; accepting a URL
 * would mean taking an origin from request input.
 *
 * @param returnPath - The untrusted candidate, typically a query parameter.
 * @returns A path beginning with a single `/`, or {@link DEFAULT_RETURN_PATH}.
 * @example
 * resolveReturnPath("/logs?level=error"); // "/logs?level=error"
 * resolveReturnPath("//evil.test");       // "/"
 */
export function resolveReturnPath(returnPath: string | undefined): string {
  if (returnPath === undefined || returnPath.length === 0) {
    return DEFAULT_RETURN_PATH;
  }

  let candidate: URL;
  try {
    candidate = new URL(returnPath, RESOLUTION_ORIGIN);
  } catch {
    return DEFAULT_RETURN_PATH;
  }

  if (candidate.origin !== RESOLUTION_ORIGIN) return DEFAULT_RETURN_PATH;

  // Rebuilt from the parsed parts, so what is emitted is what the parser
  // understood — never the raw input.
  return `${candidate.pathname}${candidate.search}${candidate.hash}`;
}

/**
 * The sign-in URL to redirect an unauthenticated visitor to.
 *
 * Relative, because the sign-in page is on this app: there is nothing to
 * derive from request headers, so there is nothing for a client to spoof.
 *
 * @param returnPath - Where to send them afterwards. Sanitised, never trusted.
 * @returns A path on this app, with the return parameter only when it adds
 *   something the default does not.
 * @example
 * buildSignInUrl("/apps"); // "/sign-in?returnTo=%2Fapps"
 */
export function buildSignInUrl(returnPath: string | undefined): string {
  const resolved = resolveReturnPath(returnPath);
  if (resolved === DEFAULT_RETURN_PATH) return SIGN_IN_PATH;

  const params = new URLSearchParams({ [RETURN_TO_PARAM]: resolved });

  return `${SIGN_IN_PATH}?${params.toString()}`;
}
