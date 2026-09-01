import { DEFAULT_REDACTION_REPLACEMENT } from "../defaults";
import type { RedactionOptions, RedactionPattern } from "../types";

/**
 * Key-shaped secret detection, applied while a context object is normalized.
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
 * Secret-shaped key fragments, matched against a normalized key.
 *
 * Deliberately broad — a field wrongly redacted is an inconvenience, a
 * credential in a log store is an incident.
 */
export const DEFAULT_REDACTION_KEYS: readonly string[] = [
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "secret",
  "token",
  "apikey",
  "accesskey",
  "privatekey",
  "publickey",
  "authorization",
  "auth",
  "credential",
  "cookie",
  "session",
  "bearer",
  "jwt",
  "signature",
  "otp",
  "pin",
  "cvv",
  "cardnumber",
  "creditcard",
  "ssn",
  "salt",
  "hash",
];

/**
 * Reduces a key to comparable form: lower case, punctuation removed.
 *
 * `API_KEY`, `api-key`, `apiKey` and `x-api-key` all normalize to a string
 * containing `apikey`, so one pattern covers every casing convention a caller
 * might use.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Decides whether a key's value may leave the process. */
export interface Redactor {
  /** Whether the value under `key` must be replaced. */
  shouldRedact(key: string): boolean;
  /** What to replace it with. */
  readonly replacement: string;
}

function compile(patterns: readonly RedactionPattern[]): {
  literals: readonly string[];
  expressions: readonly RegExp[];
} {
  const literals: string[] = [];
  const expressions: RegExp[] = [];

  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      const normalized = normalizeKey(pattern);
      if (normalized.length > 0) literals.push(normalized);
      continue;
    }
    expressions.push(pattern);
  }

  return { literals, expressions };
}

/**
 * Builds the redactor for a logger.
 *
 * @param options - Redaction configuration; omitted means "defaults, enabled".
 * @returns A redactor, or `undefined` when redaction is switched off.
 * @example
 * createRedactor()?.shouldRedact("X-Api-Key"); // true
 */
export function createRedactor(
  options: RedactionOptions | undefined,
): Redactor | undefined {
  if (options?.enabled === false) return undefined;

  const configured =
    options?.keys ??
    (options?.additionalKeys
      ? [...DEFAULT_REDACTION_KEYS, ...options.additionalKeys]
      : DEFAULT_REDACTION_KEYS);

  const { literals, expressions } = compile(configured);
  const replacement = options?.replacement ?? DEFAULT_REDACTION_REPLACEMENT;

  return {
    replacement,
    shouldRedact(key: string): boolean {
      if (expressions.some((expression) => expression.test(key))) return true;

      const normalized = normalizeKey(key);
      return literals.some((literal) => normalized.includes(literal));
    },
  };
}
