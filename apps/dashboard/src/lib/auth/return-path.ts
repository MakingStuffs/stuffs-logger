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

/** The path, query and fragment of a parsed URL, with the origin dropped. */
function pathOf(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Whether an already-parsed path survives being parsed AGAIN as itself.
 *
 * Dot-segment normalisation can manufacture an authority the first parse never
 * reported: `/..//evil.test` is a path on the resolution origin as far as
 * `URL.origin` is concerned, but its normalised pathname is `//evil.test`, and
 * handed to `redirect()` that is a scheme-relative URL to another host. The
 * same shape falls out of `/.//`, `/%2e%2e//` and `/a/..//`. The first parse
 * cannot see it, because the origin it reports is the base's; only re-parsing
 * the OUTPUT does. So the rule is idempotence: the output must parse back to
 * the same origin and to itself, and must not begin with the two characters
 * that make a browser read an authority. The backslash form is refused even
 * though the parser folds `\` to `/` for `https:` today — the guarantee should
 * not rest on that.
 *
 * @param path - A value rebuilt from parsed parts, never raw input.
 * @returns Whether it can be emitted as a path on this app.
 */
function staysOnThisApp(path: string): boolean {
  if (path.startsWith("//") || path.startsWith("/\\")) return false;

  let reparsed: URL;
  try {
    reparsed = new URL(path, RESOLUTION_ORIGIN);
  } catch {
    return false;
  }

  return reparsed.origin === RESOLUTION_ORIGIN && pathOf(reparsed) === path;
}

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
 * would mean taking an origin from request input. What the parser emits is
 * then checked once more, by {@link staysOnThisApp}, for the dot-segment
 * escapes a single parse cannot report.
 *
 * @param returnPath - The untrusted candidate, typically a query parameter.
 * @returns A path beginning with a single `/`, or {@link DEFAULT_RETURN_PATH}.
 * @example
 * resolveReturnPath("/logs?level=error"); // "/logs?level=error"
 * resolveReturnPath("//evil.test");       // "/"
 * resolveReturnPath("/..//evil.test");    // "/"
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
  const rebuilt = pathOf(candidate);

  return staysOnThisApp(rebuilt) ? rebuilt : DEFAULT_RETURN_PATH;
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
