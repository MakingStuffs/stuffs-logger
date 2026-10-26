import { MAX_URL_LENGTH, normaliseRedactionKey } from "../contract";
import type { Redactor } from "./redact";
import { clampString } from "./sanitize";

/**
 * Redaction for secrets that travel in a URL rather than in a context bag.
 *
 * A password-reset link, an OAuth callback and a magic-link sign-in all carry
 * their credential in the query string or the fragment, and the browser
 * collector reports `location.href` verbatim. Without this pass, a token that
 * grants account access would be stored by the dashboard and readable by every
 * viewer of it for the whole retention window.
 *
 * The same key-name matching used for context keys decides what goes, plus a
 * short list of names that are only secrets in a url: a parameter NAME is
 * matched, never its value, and never the path. Parameters that do not match
 * are copied through byte for byte, so nothing is re-encoded and no legitimate
 * url changes shape just by being logged.
 */

/**
 * Characters removed from the replacement before it is written into a url.
 *
 * A caller-configured replacement containing `&` or `#` would otherwise turn
 * one redacted parameter into two parameters, or into a fragment.
 */
const URL_UNSAFE_REPLACEMENT_CHARS = /[&#=?\s]/g;

/**
 * Parameter names redacted in a url ONLY, over and above the shared key list.
 *
 * OAuth and OIDC carry their credentials under names the shared list cannot
 * afford to match: as context keys, `code`, `state` and `key` would take
 * `postcode`, `statement` and `keyboard` with them. In a url the names are
 * fixed by the specs, so they are matched EXACTLY, on the normalised form —
 * `id_token`, `ID-Token` and `idToken` all normalise to `idtoken`.
 */
const URL_PARAMETER_KEYS: readonly string[] = [
  "code",
  "state",
  "nonce",
  "key",
  "sig",
  "signature",
  "verifier",
  "challenge",
  "idtoken",
  "accesstoken",
  "refreshtoken",
  "sessionstate",
];

/**
 * The last url redacted, and what it became.
 *
 * `location.href` is the same string on every event until the page navigates,
 * and parsing plus rewriting it was the one per-event cost that repeated its
 * own work. One entry is enough: the cache is for the run of events between
 * navigations, not for the navigations.
 */
let cachedUrl: string | undefined;
let cachedRedactor: Redactor | undefined;
let cachedResult = "";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    // A malformed escape sequence. The raw form still matches most key names.
    return value;
  }
}

/**
 * Rewrites one `a=1&b=2` string, or returns `undefined` when nothing matched.
 */
function redactParameters(
  source: string,
  redactor: Redactor,
  replacement: string,
): string | undefined {
  let changed = false;

  const parts = source.split("&").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return part;

    const name = part.slice(0, separator);
    const decoded = safeDecode(name);
    if (
      !redactor.shouldRedact(decoded) &&
      !URL_PARAMETER_KEYS.includes(normaliseRedactionKey(decoded))
    ) {
      return part;
    }

    changed = true;
    return `${name}=${replacement}`;
  });

  return changed ? parts.join("&") : undefined;
}

/**
 * Removes secret-shaped parameters and embedded credentials from a url.
 *
 * @param url - The captured url, typically `location.href`.
 * @param redactor - The logger's redactor; `undefined` disables redaction.
 * @returns The url with matching parameter values replaced, bounded to the
 *   contract's url length. Returned unchanged when nothing matched, when
 *   redaction is off, or when the value does not parse as a url. Path
 *   segments are never touched.
 * @example
 * redactUrl("https://a.com/reset?token=abc", redactor);
 * // "https://a.com/reset?token=[redacted]"
 */
export function redactUrl(url: string, redactor: Redactor | undefined): string {
  if (!redactor) return url;
  if (url === cachedUrl && redactor === cachedRedactor) return cachedResult;

  const result = redactParsedUrl(url, redactor);
  cachedUrl = url;
  cachedRedactor = redactor;
  cachedResult = result;
  return result;
}

function redactParsedUrl(url: string, redactor: Redactor): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not an absolute url — leave it exactly as it was rather than guess.
    return url;
  }

  const replacement = redactor.replacement.replace(
    URL_UNSAFE_REPLACEMENT_CHARS,
    "",
  );
  let changed = false;

  // `https://user:password@host` — a credential with no parameter name to
  // match, so it goes unconditionally.
  if (parsed.username !== "" || parsed.password !== "") {
    parsed.username = "";
    parsed.password = "";
    changed = true;
  }

  const query = parsed.search.slice(1);
  if (query.length > 0) {
    const redacted = redactParameters(query, redactor, replacement);
    if (redacted !== undefined) {
      parsed.search = `?${redacted}`;
      changed = true;
    }
  }

  // Implicit-flow OAuth returns its token in the fragment. Only rewritten when
  // something matched, so a plain `#section` anchor is never reshaped.
  const fragment = parsed.hash.slice(1);
  if (fragment.length > 0) {
    const redacted = redactParameters(fragment, redactor, replacement);
    if (redacted !== undefined) {
      parsed.hash = `#${redacted}`;
      changed = true;
    }
  }

  if (!changed) return url;

  // A long replacement across several parameters can lengthen the url, and an
  // over-long url would fail validation for the whole batch, not just itself.
  return clampString(parsed.toString(), MAX_URL_LENGTH);
}
