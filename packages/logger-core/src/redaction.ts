import { MAX_CONTEXT_DEPTH } from "./constants";
import { setJsonEntry } from "./json";
import type { JsonValue } from "./json";

/**
 * Key-shaped secret detection, shared by the SDK and the server.
 *
 * Both ends redact, and they redact against the SAME list for the same reason
 * every other limit lives in this package: two lists would drift, and the
 * drift would be silent. This module is that list: the SDK re-exports the
 * matcher below through its `src/contract.ts` seam rather than carrying a copy
 * of it, so a key added here is redacted in the browser too.
 *
 * The two ends are not the same control, though. The SDK redacts so a secret
 * never enters its buffers and never reaches the network at all; that pass is
 * configurable, and a caller may switch it off. The SERVER pass is
 * authoritative and is not configurable by anyone holding an ingest key —
 * whoever POSTs to the ingest endpoint chose neither the key list nor whether
 * it runs.
 *
 * Keys, not values: value-shaped detection (entropy scoring, JWT regexes) is a
 * per-character cost with a false-positive rate that silently corrupts
 * legitimate data. Key matching is O(key length) and its failure mode is a
 * redacted field someone can rename.
 */

/** A configured redaction pattern: a key fragment, or an expression. */
export type RedactionPattern = string | RegExp;

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

/** What a redacted value is replaced with. */
export const DEFAULT_REDACTION_REPLACEMENT = "[redacted]";

/**
 * Reduces a key to comparable form: lower case, punctuation removed.
 *
 * `API_KEY`, `api-key`, `apiKey` and `x-api-key` all normalise to a string
 * containing `apikey`, so one pattern covers every casing convention a caller
 * might use.
 *
 * @param key - The raw object key.
 * @returns The normalised form used for matching.
 * @example
 * normaliseRedactionKey("X-Api-Key"); // "xapikey"
 */
export function normaliseRedactionKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Decides whether a key's value may be kept. */
export interface KeyRedactor {
  /** Whether the value under `key` must be replaced. */
  shouldRedact(key: string): boolean;
  /** What to replace it with. */
  readonly replacement: string;
}

/** How a redactor is configured. */
export interface KeyRedactorOptions {
  /** Replaces the built-in list outright. */
  keys?: readonly RedactionPattern[];
  /** Extends the built-in list. Ignored when `keys` is supplied. */
  additionalKeys?: readonly RedactionPattern[];
  /** The value substituted for a redacted one. */
  replacement?: string;
}

function compile(patterns: readonly RedactionPattern[]): {
  literals: readonly string[];
  expressions: readonly RegExp[];
} {
  const literals: string[] = [];
  const expressions: RegExp[] = [];

  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      const normalised = normaliseRedactionKey(pattern);
      if (normalised.length > 0) literals.push(normalised);
      continue;
    }
    expressions.push(pattern);
  }

  return { literals, expressions };
}

/**
 * Builds a redactor from a pattern list.
 *
 * @param options - Optional overrides; omitted means the built-in key list.
 * @returns A redactor that matches keys and knows its replacement value.
 * @example
 * createKeyRedactor().shouldRedact("X-Api-Key"); // true
 */
export function createKeyRedactor(
  options: KeyRedactorOptions = {},
): KeyRedactor {
  const configured =
    options.keys ??
    (options.additionalKeys
      ? [...DEFAULT_REDACTION_KEYS, ...options.additionalKeys]
      : DEFAULT_REDACTION_KEYS);

  const { literals, expressions } = compile(configured);
  const replacement = options.replacement ?? DEFAULT_REDACTION_REPLACEMENT;

  return {
    replacement,
    shouldRedact(key: string): boolean {
      if (expressions.some((expression) => expression.test(key))) return true;

      const normalised = normaliseRedactionKey(key);
      return literals.some((literal) => normalised.includes(literal));
    },
  };
}

/** The default redactor, built once — the server needs no other. */
const defaultRedactor = createKeyRedactor();

/**
 * How deep redaction descends.
 *
 * One level past the wire contract's own nesting limit, so a value that passed
 * validation is always fully walked, and a value that somehow did not still
 * terminates instead of recursing on hostile input.
 */
const MAX_REDACTION_DEPTH = MAX_CONTEXT_DEPTH + 1;

/**
 * Replaces every secret-shaped value in a JSON structure.
 *
 * Object keys are matched at every level, including inside arrays, because a
 * secret is no less a secret for sitting in `headers[0].authorization`. The
 * structure is otherwise preserved: the shape of a log context is itself
 * diagnostic information, so a redacted field keeps its key and loses only its
 * value.
 *
 * Beyond {@link MAX_REDACTION_DEPTH} the subtree is replaced wholesale rather
 * than trusted, so a payload nested deeper than the contract allows fails
 * closed instead of smuggling a credential past the walk.
 *
 * @param value - The value to redact. Not mutated.
 * @param redactor - The matcher to use; defaults to the built-in key list.
 * @returns A new value with matching leaves replaced.
 * @example
 * redactJson({ apiKey: "abc" }); // { apiKey: "[redacted]" }
 */
export function redactJson(
  value: JsonValue,
  redactor: KeyRedactor = defaultRedactor,
): JsonValue {
  return redactAtDepth(value, redactor, 0);
}

function redactAtDepth(
  value: JsonValue,
  redactor: KeyRedactor,
  depth: number,
): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_REDACTION_DEPTH) return redactor.replacement;

  if (Array.isArray(value)) {
    return value.map((entry) => redactAtDepth(entry, redactor, depth + 1));
  }

  const result: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    setJsonEntry(
      result,
      key,
      redactor.shouldRedact(key)
        ? redactor.replacement
        : redactAtDepth(entry, redactor, depth + 1),
    );
  }

  return result;
}
