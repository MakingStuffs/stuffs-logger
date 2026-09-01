import { DEFAULT_REDACTION_REPLACEMENT } from "../defaults";
import type { RedactionOptions, RedactionPattern } from "../types";

/**
 * Key-shaped secret detection, applied while a context object is normalised.
 *
 * The SDK ships credentials, request headers and form state to a server that
 * stores them and renders them in a dashboard. Anything that looks like a
 * secret is replaced BEFORE it is queued, so a secret never exists inside the
 * SDK's buffers, never reaches the network, and cannot be recovered from the
 * dashboard afterwards.
 *
 * Keys, not values: value-shaped detection (entropy, JWT regexes) is a
 * per-character cost on the caller's hot path with a false-positive rate that
 * silently corrupts legitimate data. Key matching is O(key length) and its
 * failure mode is a redacted field someone can rename.
 */

/**
 * Secret-shaped key fragments, matched against a normalised key.
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
 * `API_KEY`, `api-key`, `apiKey` and `x-api-key` all normalise to a string
 * containing `apikey`, so one pattern covers every casing convention a caller
 * might use.
 */
function normaliseKey(key: string): string {
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
      const normalised = normaliseKey(pattern);
      if (normalised.length > 0) literals.push(normalised);
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

      const normalised = normaliseKey(key);
      return literals.some((literal) => normalised.includes(literal));
    },
  };
}
