import { createKeyRedactor } from "../contract";
import type { KeyRedactor } from "../contract";
import type { RedactionOptions } from "../types";

/**
 * Key-shaped secret detection, applied while a context object is normalized.
 *
 * The matching itself is NOT implemented here: the key list, the key
 * normalization and the pattern compilation all come from
 * `@stuffs-logger/core`'s redaction module via `../contract`, because the SDK and
 * the ingest server are two ends of one control. Two lists would drift, and
 * the drift would be silent — a key added server-side would simply never be
 * redacted in the browser. What IS the SDK's own is the policy below: a
 * caller may switch client-side redaction off, and the server's pass cannot
 * be switched off by anyone holding an ingest key.
 *
 * The SDK ships credentials, request headers and form state to a server that
 * stores them and renders them in a dashboard, so a secret-shaped value is
 * replaced BEFORE the event is queued.
 *
 * WHAT THIS COVERS, precisely — the guarantee is narrower than "no secret ever
 * leaves the process", and reading it as the wider claim is how a token ends
 * up in a log store:
 *
 * - Context object KEYS, at any depth, in the collected, static and per-call
 *   layers (see `./sanitize`).
 * - Query and fragment PARAMETER NAMES in the captured url, plus credentials
 *   embedded in its authority (see `./redact-url`).
 *
 * What it does NOT cover: `message`, `error.message` and `error.stack` are
 * sent verbatim. A caller who interpolates a token into a log message ships
 * that token. Free-text scanning is a per-character cost on the caller's hot
 * path with a false-positive rate that silently corrupts the very text someone
 * is reading a log to understand; the server applies its own pass over stored
 * text instead.
 *
 * Keys, not values, for the same reason: key matching is O(key length) and its
 * failure mode is a redacted field someone can rename.
 */

/**
 * Decides whether a key's value may leave the process.
 *
 * The SDK's name for the core's redactor — the same matcher the server runs,
 * built here from the caller's configuration.
 */
export type Redactor = KeyRedactor;

/** Verdicts remembered per redactor before the memo is emptied. */
const MAX_MEMO_ENTRIES = 256;

/** Keys longer than this are not remembered: a bag of them would BE the memo. */
const MAX_MEMO_KEY_LENGTH = 128;

/**
 * Builds the redactor for a logger.
 *
 * @param options - Redaction configuration; omitted means "defaults, enabled".
 * @returns A redactor, or `undefined` when redaction is switched off.
 * @example
 * createRedactor(undefined)?.shouldRedact("X-Api-Key"); // true
 */
export function createRedactor(
  options: RedactionOptions | undefined,
): Redactor | undefined {
  if (options?.enabled === false) return undefined;

  const matcher = createKeyRedactor(options);
  // Keys repeat across events — `userId`, `path`, `viewport` — and every
  // verdict costs a normalisation plus a scan of the whole pattern list, on
  // the caller's thread. A bounded memo makes the repeat a map lookup;
  // emptying it when full is simpler than an LRU and, at this size, no worse.
  const verdicts = new Map<string, boolean>();

  return {
    replacement: matcher.replacement,
    shouldRedact(key: string): boolean {
      let verdict = verdicts.get(key);
      if (verdict === undefined) {
        verdict = matcher.shouldRedact(key);
        if (key.length <= MAX_MEMO_KEY_LENGTH) {
          if (verdicts.size >= MAX_MEMO_ENTRIES) verdicts.clear();
          verdicts.set(key, verdict);
        }
      }
      return verdict;
    },
  };
}
