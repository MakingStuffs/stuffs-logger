import {
  parseIngestKey,
  PUBLIC_KEY_PREFIX,
  SECRET_KEY_PREFIX,
} from "../contract";
import type { LogSource } from "../contract";

/**
 * The one place that decides whether a key may be used from where it is.
 *
 * The ingest server enforces this too — it answers 403 to a public key
 * presented with `source: "node"` — but the check that matters is the one on
 * the client, because the dangerous direction never reaches the server at all:
 * a `jfl_sec_` key configured in browser code has already been published to
 * every visitor by the time the first request is made. Refusing to send with
 * it does not undo that, but it turns a silent leak into a loud one during
 * development, which is when it can still be fixed.
 */

/** The outcome of validating a configured key against its runtime. */
export type CredentialCheck =
  | { readonly ok: true; readonly apiKey: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Validates an ingest key for the runtime it is about to be used from.
 *
 * @param apiKey - The configured key, if any.
 * @param source - The runtime the batch will be attributed to.
 * @returns The accepted key, or the reason it was refused.
 * @example
 * checkCredential("jfl_sec_…", "browser");
 * // { ok: false, reason: "…secret ingest key…" }
 */
export function checkCredential(
  apiKey: string | undefined,
  source: LogSource,
): CredentialCheck {
  if (!apiKey) {
    return { ok: false, reason: "no ingest key was configured" };
  }

  const parsed = parseIngestKey(apiKey);
  if (!parsed) {
    return { ok: false, reason: "the ingest key is not a well-formed key" };
  }

  if (parsed.kind === "secret" && source === "browser") {
    return {
      ok: false,
      reason: `a ${SECRET_KEY_PREFIX} key must never be shipped to a browser — rotate it and use a ${PUBLIC_KEY_PREFIX} key`,
    };
  }

  if (parsed.kind === "public" && source === "node") {
    return {
      ok: false,
      reason: `a ${PUBLIC_KEY_PREFIX} key is browser-only — use a ${SECRET_KEY_PREFIX} key from Node`,
    };
  }

  return { ok: true, apiKey };
}
