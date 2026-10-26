/**
 * The scheme check that stands between a logged URL and an `href`.
 *
 * Anyone holding a scraped public ingest key can write a log event, and the
 * `url` field is a free-text string on that event. Rendering it straight into
 * an anchor would let `javascript:fetch('/api/...')` run with a colleague's
 * session the moment they clicked it, and `data:text/html,…` would hand the
 * attacker a document on this origin.
 */

/** The only schemes that may reach an `href`. */
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Returns the URL only when it is safe to link to.
 *
 * Parsed with the URL constructor rather than pattern-matched, so tricks that
 * defeat a string check — `java\nscript:`, `JaVaScRiPt:`, leading whitespace,
 * a protocol-relative `//evil.test` — are all resolved before the scheme is
 * examined.
 *
 * Userinfo is refused outright. `https://evil.test@victim.test/` reads, as
 * link text, like a link to `evil.test` and goes to `victim.test` — or the
 * reverse, which is the trick — and nothing a log event legitimately links to
 * needs credentials in the URL.
 *
 * @param value - The `url` field of a log event. Attacker-controlled.
 * @returns The URL when its scheme is `http` or `https` and it carries no
 *   userinfo, otherwise `null`.
 * @example
 * toSafeHttpUrl("javascript:alert(1)"); // null
 * toSafeHttpUrl("https://evil.test@victim.test/"); // null
 * toSafeHttpUrl("https://example.test/checkout"); // the URL
 */
export function toSafeHttpUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Relative or malformed. There is no origin to resolve it against that is
    // meaningful here — the URL belongs to somebody else's site — so it is
    // shown as text instead of guessed at.
    return null;
  }

  if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
  if (parsed.username.length > 0 || parsed.password.length > 0) return null;

  return parsed.toString();
}
