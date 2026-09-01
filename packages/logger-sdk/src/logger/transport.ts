import { INGEST_KEY_HEADER, jsonByteLength, MAX_BODY_BYTES } from "../contract";
import { MAX_KEEPALIVE_BODY_BYTES } from "../defaults";
import type {
  DiagnosticHandler,
  Transport,
  TransportOutcome,
  TransportRequest,
} from "../types";

/**
 * The HTTP transport.
 *
 * It resolves for every outcome and rejects for none: the logger's retry and
 * backoff policy is driven by the returned {@link TransportOutcome}, and an
 * unhandled rejection escaping from here would be exactly the kind of failure
 * the SDK promises never to produce.
 *
 * `navigator.sendBeacon` is deliberately not used, despite being the usual
 * answer for unload-time delivery: a beacon cannot carry custom headers, and
 * the ingest contract authenticates with `x-jf-key`. A beacon would therefore
 * always arrive unauthenticated and be rejected. `fetch` with `keepalive`
 * gives the same outlives-the-document guarantee AND can send the header, so
 * that is what the unload path uses.
 */

/** How long a single send may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 10000;

/** Ceiling applied to a server-supplied `Retry-After`, in milliseconds. */
const MAX_RETRY_AFTER_MS = 300000;

/** Everything the HTTP transport needs to talk to one ingest endpoint. */
export interface HttpTransportOptions {
  /** Absolute ingest URL. */
  endpoint: string;
  /** The ingest key, sent in the `x-jf-key` header. */
  apiKey: string;
  /** Where swallowed failures are announced. */
  report: DiagnosticHandler;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
  }

  return undefined;
}

function abortSignal(): AbortSignal | undefined {
  const constructor = (globalThis as { AbortSignal?: { timeout?: unknown } })
    .AbortSignal;
  const timeout = constructor?.timeout;
  if (typeof timeout !== "function") return undefined;
  return (timeout as (ms: number) => AbortSignal)(REQUEST_TIMEOUT_MS);
}

/**
 * Maps a failing response onto a policy.
 *
 * `401`/`403` mean the key will never work, so retrying is pure noise;
 * `400`/`413` condemn this batch but not the next one; the rest are transient
 * and worth a backed-off retry. Anything unrecognised drops the batch rather
 * than retrying it, because an unknown refusal repeated is still a refusal.
 */
function classify(response: Response): TransportOutcome {
  const { status } = response;

  switch (status) {
    case 401:
    case 403:
      return {
        kind: "disabled",
        reason: `ingest rejected the key (status ${status})`,
      };
    case 400:
    case 413:
      return {
        kind: "dropped",
        reason: `ingest refused the batch (${status})`,
      };
    case 408:
    case 425:
    case 429:
      break;
    default:
      if (status < 500) {
        return {
          kind: "dropped",
          reason: `unexpected ingest status ${status}`,
        };
      }
  }

  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  return { kind: "retry", ...(retryAfterMs !== undefined && { retryAfterMs }) };
}

/**
 * Builds the transport used unless the caller injects their own.
 *
 * @param options - Endpoint, key and diagnostics sink.
 * @returns A transport that never rejects.
 */
export function createHttpTransport(options: HttpTransportOptions): Transport {
  const { endpoint, apiKey, report } = options;

  return {
    async send({ batch, urgent }: TransportRequest): Promise<TransportOutcome> {
      let body: string;
      try {
        body = JSON.stringify(batch);
      } catch (error) {
        report(error, "transport.serialize");
        return { kind: "dropped", reason: "batch could not be serialized" };
      }

      // Measured in UTF-8 BYTES, which is what the server measures and what
      // the browser's keepalive cap counts. A UTF-16 length would let a batch
      // of CJK text through at three times the real size, to be refused with a
      // `413` this transport can only read as "condemned". The caller sizes
      // batches to the same budget, so reaching this guard means one event
      // alone is too big — the last resort, not the routine path.
      const bytes = jsonByteLength(batch);
      const limit = urgent ? MAX_KEEPALIVE_BODY_BYTES : MAX_BODY_BYTES;
      if (bytes > limit) {
        // Only the keepalive cap refused it, and that cap is four times
        // smaller than the server's. Saying so lets the caller put the batch
        // back for an ordinary flush instead of destroying an event that a
        // tab switch — not even a real unload — happened to catch in flight.
        if (urgent && bytes <= MAX_BODY_BYTES) {
          return {
            kind: "dropped",
            reason: "batch exceeded the keepalive body limit",
            cause: "urgent-body-limit",
          };
        }
        return { kind: "dropped", reason: "batch exceeded the body limit" };
      }

      if (typeof fetch !== "function") {
        return { kind: "disabled", reason: "fetch is unavailable" };
      }

      const signal = abortSignal();

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          // The ingest endpoint authenticates on the key alone. Sending the
          // caller's cookies to it would attach ambient authority to every
          // batch and, on a cross-origin endpoint, leak a session to a host
          // the application never intended to authenticate against.
          credentials: "omit",
          cache: "no-store",
          keepalive: urgent,
          headers: {
            "content-type": "application/json",
            [INGEST_KEY_HEADER]: apiKey,
          },
          body,
          ...(signal !== undefined && { signal }),
        });

        if (response.ok) {
          return { kind: "sent", accepted: batch.events.length };
        }
        return classify(response);
      } catch (error) {
        // A network failure, an abort, or — in the browser — any pre-auth
        // rejection, which arrives without CORS headers and is therefore
        // indistinguishable from the network being down. Both are retried
        // under the caller's backoff, which is what stops the opaque case
        // becoming a spin.
        report(error, "transport.send");
        return { kind: "retry" };
      }
    },
  };
}
