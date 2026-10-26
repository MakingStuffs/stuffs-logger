import {
  INGEST_KEY_HEADER,
  MAX_BODY_BYTES,
  parseIngestEnvelope,
} from "@stuffs/logger-core";
import { NextResponse } from "next/server";

import { ApiError } from "@/lib/api/errors";
import { apiSuccess } from "@/lib/api/responses";
import { withErrorHandler } from "@/lib/api/with-error-handler";
import { corsHeaders, VARY_ORIGIN } from "@/lib/ingest/cors";
import {
  recallCorsHeaders,
  rememberCorsHeaders,
} from "@/lib/ingest/cors-context";
import {
  checkInvalidKeyThrottle,
  clientIpFromHeaders,
  recordInvalidKeyRefusal,
} from "@/lib/ingest/invalid-key-throttle";
import { keyClassAllowsSource, verifyIngestKey } from "@/lib/ingest/keys";
import { normaliseBatch, type RejectedEvent } from "@/lib/ingest/normalise";
import { isOriginRegisteredCached } from "@/lib/ingest/origin-registry";
import { consumeDailyQuota } from "@/lib/ingest/quota";
import { consumeRateLimit } from "@/lib/ingest/rate-limit";
import { shouldStampLastUsed } from "@/lib/ingest/last-used";
import {
  isSecretKeyExposedToBrowser,
  shouldWarnSecretKeyExposure,
} from "@/lib/ingest/secret-key-exposure";
import {
  insertLogEvents,
  listRegisteredOrigins,
  prismaApplicationUsageStore,
  prismaIngestKeyStore,
  stampKeyLastUsed,
} from "@/lib/ingest/store";

/**
 * `POST /api/v1/ingest` — the public log intake.
 *
 * AUTH TIER: PUBLIC-ADJACENT. There is no user session here and never will be:
 * the caller is a browser bundle or a server process presenting an ingest key.
 * Everything about the request is hostile input — the key, the origin, the
 * body, the clock, the user agent, the proxy's address headers — so the order
 * below is deliberate and each step is cheap before the one after it:
 *
 *   0. client  — refuse an address that has burned its invalid-key budget (429)
 *   1. key     — parse, look up, compare in constant time (401)
 *   2. origin  — exact match against that key's allowlist (403)
 *   3. rate    — count the request against the key's in-instance window (429)
 *   4. size    — reject an oversized body before parsing it (413)
 *   5. shape   — validate the envelope, then each event (400 / partial 202)
 *   6. quota   — count the batch against the application's UTC day (429)
 *   7. write   — insert, attributing rows to the KEY's application
 *
 * The credential is checked BEFORE the body is read, so an anonymous flood
 * costs one indexed lookup rather than a buffered payload, and the rate limit
 * applies to work this endpoint has not done yet. Step 0 bounds even that
 * lookup: an address that keeps presenting keys that do not exist stops being
 * looked up at all for a minute. It also means every refusal from step 3
 * onwards carries CORS headers, so the SDK reads a real status instead of an
 * opaque network error.
 *
 * Steps 3 and 6 are two different controls, not one repeated: step 3 is
 * per-instance memory and is free, step 6 is a durable per-application ceiling
 * in Postgres and is what actually bounds a leaked key.
 *
 * The application a row lands in comes from the verified key, never from the
 * body. There is no field a caller can set to write into someone else's logs.
 */

/** Node runtime: verification uses `node:crypto`'s `timingSafeEqual`. */
export const runtime = "nodejs";

/** Never cached, never statically analysed — every request is credentialled. */
export const dynamic = "force-dynamic";

/** What a successful ingest reports back. */
interface IngestResult {
  /** Events written. */
  accepted: number;
  /** Events dropped because they failed validation. */
  rejected: number;
  /** Why each dropped event was dropped. */
  rejectedEvents: RejectedEvent[];
  /** How many accepted events had their client clock overridden. */
  clamped: number;
}

/** The parsed body, and the size of the payload it arrived in. */
interface BoundedBody {
  value: unknown;
  /** Bytes on the wire, counted against the application's daily byte quota. */
  byteLength: number;
}

/** Longest attacker-controlled header value quoted into a log line. */
const MAX_LOGGED_VALUE_LENGTH = 256;

/**
 * Quotes an attacker-controlled header value for a log line.
 *
 * `JSON.stringify` escapes control characters and quotes, so a newline in an
 * `Origin` cannot forge a second log line and a terminal escape cannot colour
 * one; the cap stops a 16 KB header from becoming a 16 KB log entry.
 */
function quoteForLog(value: string | null): string {
  if (value === null) return "<none>";
  return JSON.stringify(value.slice(0, MAX_LOGGED_VALUE_LENGTH));
}

/** The one error every oversized body is answered with. */
function payloadTooLarge(logContext: string): ApiError {
  return new ApiError("PAYLOAD_TOO_LARGE", "Request body is too large.", {
    logContext,
  });
}

/**
 * Reads the body as bytes, refusing anything over the limit WHILE it arrives.
 *
 * `request.arrayBuffer()` would buffer the entire body before its length could
 * be compared, and on plain Node the body is the raw socket stream with no cap
 * of its own: a chunked upload with no `content-length` could stream gigabytes
 * into one connection before the check ever ran. So the stream is read chunk
 * by chunk with a running total, and the moment the total passes the limit
 * the reader is cancelled — the rest of the upload is never received, let
 * alone held in memory.
 */
async function readBoundedBody(request: Request): Promise<BoundedBody> {
  // The advertised length is checked first so an honestly oversized upload is
  // refused before a single byte is read. It is a claim, not a fact, so the
  // real size is counted below regardless.
  const advertised = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(advertised) && advertised > MAX_BODY_BYTES) {
    throw payloadTooLarge(
      `content-length ${advertised} exceeds ${MAX_BODY_BYTES}`,
    );
  }

  if (request.body === null) {
    throw new ApiError("INVALID_INPUT", "Request body is required.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        // Cancelling tells the source to stop producing; a failure to cancel
        // changes nothing about the refusal, so it is not allowed to mask it.
        await reader.cancel().catch(() => undefined);
        throw payloadTooLarge(
          `body exceeded ${MAX_BODY_BYTES} bytes after ${byteLength} received`,
        );
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // Decoded once, from one contiguous buffer: a multi-byte character split
  // across two chunks would otherwise decode as two replacement characters.
  const buffer = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(buffer);

  try {
    return { value: JSON.parse(text), byteLength };
  } catch {
    throw new ApiError("INVALID_INPUT", "Request body must be valid JSON.");
  }
}

const handlePost = async (request: Request): Promise<NextResponse> => {
  const origin = request.headers.get("origin");
  const clientIp = clientIpFromHeaders(request.headers);

  // Consulted BEFORE the key is even parsed, so a throttled address costs
  // nothing. No origin has been granted yet, so the refusal carries only
  // `Vary: Origin` — which is the recall fallback — and the retry hint goes
  // in the body rather than a header the browser could not read anyway.
  if (clientIp !== null) {
    const throttle = checkInvalidKeyThrottle(clientIp);
    if (throttle.throttled) {
      throw new ApiError(
        "RATE_LIMITED",
        "Too many failed requests from this client.",
        {
          details: { retryAfterSeconds: throttle.retryAfterSeconds },
          logContext: `client ${quoteForLog(clientIp)} exceeded the invalid-key window`,
        },
      );
    }
  }

  const verification = await verifyIngestKey(
    request.headers.get(INGEST_KEY_HEADER),
    {
      origin,
      store: prismaIngestKeyStore,
    },
  );

  if (!verification.ok) {
    // Two distinct statuses, one deliberately uninformative message each. The
    // caller learns whether their ORIGIN was the problem — which they control
    // and must be able to fix — but never whether the key exists.
    if (verification.reason === "origin_not_allowed") {
      throw new ApiError(
        "FORBIDDEN",
        "This origin is not allowed to use this key.",
        {
          logContext: `origin ${quoteForLog(origin)} not on key allowlist`,
        },
      );
    }

    // Only an invalid KEY counts towards the throttle. An origin refusal
    // above needed a live key to reach, and is a developer to be helped, not
    // a guesser to be slowed.
    if (clientIp !== null) recordInvalidKeyRefusal(clientIp);

    throw new ApiError("UNAUTHORIZED", "Invalid ingest key.", {
      logContext: "key unknown, malformed, revoked or mismatched",
    });
  }

  const key = verification.key;

  // From here on the caller has proved possession of a live key, so failures
  // may carry CORS headers and be readable by their browser.
  rememberCorsHeaders(request, corsHeaders(key.matchedOrigin));

  const rateLimit = consumeRateLimit(key.id);
  if (!rateLimit.allowed) {
    // Re-recorded with Retry-After, so the refusal carries the standard header
    // as well as the machine-readable detail.
    rememberCorsHeaders(request, {
      ...corsHeaders(key.matchedOrigin),
      "retry-after": String(rateLimit.retryAfterSeconds),
    });

    throw new ApiError(
      "RATE_LIMITED",
      "Too many requests for this ingest key.",
      {
        details: { retryAfterSeconds: rateLimit.retryAfterSeconds },
        logContext: `key ${key.id} exceeded its window`,
      },
    );
  }

  const body = await readBoundedBody(request);
  const envelope = parseIngestEnvelope(body.value);
  if (!envelope.ok) {
    throw new ApiError("VALIDATION_FAILED", "Invalid ingest payload.", {
      details: { issues: envelope.issues },
    });
  }

  if (!keyClassAllowsSource(key.type, envelope.envelope.source)) {
    throw new ApiError(
      "FORBIDDEN",
      "This key cannot be used from a server-side source.",
      {
        logContext: `public key ${key.id} presented for source ${envelope.envelope.source}`,
      },
    );
  }

  // The inverse mistake is accepted but not silent: a secret key arriving
  // from a browser means a customer shipped it in a bundle, where anyone can
  // read it. Once a minute per key is enough to be noticed.
  if (
    isSecretKeyExposedToBrowser(key.type, origin, envelope.envelope.source) &&
    shouldWarnSecretKeyExposure(key.id)
  ) {
    console.warn(
      `[ingest.post] secret key ${key.id} presented from a browser (origin ${quoteForLog(origin)}): secret keys must never ship in client bundles — rotate it and issue a public key`,
    );
  }

  // The durable ceiling. One write, once per batch — never once per event.
  const quota = await consumeDailyQuota(
    key.applicationId,
    { events: envelope.envelope.events.length, bytes: body.byteLength },
    { store: prismaApplicationUsageStore },
  );

  if (!quota.allowed) {
    rememberCorsHeaders(request, {
      ...corsHeaders(key.matchedOrigin),
      "retry-after": String(quota.retryAfterSeconds),
    });

    throw new ApiError(
      "QUOTA_EXCEEDED",
      "This application has reached its daily ingest quota.",
      {
        details: { retryAfterSeconds: quota.retryAfterSeconds },
        logContext: `application ${key.applicationId} hit ${quota.reason} (${quota.totals.eventCount} events, ${quota.totals.byteCount} bytes today)`,
      },
    );
  }

  const receivedAt = new Date();
  const batch = normaliseBatch(envelope.envelope, {
    applicationId: key.applicationId,
    receivedAt,
    fallbackUserAgent: request.headers.get("user-agent"),
  });

  const accepted = await insertLogEvents(batch.rows);

  if (shouldStampLastUsed(key.id)) await stampKeyLastUsed(key.id, receivedAt);

  const result: IngestResult = {
    accepted,
    rejected: batch.rejected.length,
    rejectedEvents: batch.rejected,
    clamped: batch.clampedCount,
  };

  // 202, not 201: the batch is accepted for storage and the caller is not
  // waiting on a resource to address afterwards.
  return apiSuccess(result, {
    status: 202,
    headers: corsHeaders(key.matchedOrigin),
  });
};

export const POST = withErrorHandler(
  { context: "ingest.post", errorHeaders: recallCorsHeaders },
  handlePost,
);

/**
 * The CORS preflight.
 *
 * A preflight cannot carry `x-slg-key` — browsers send only the method and the
 * requested headers — so the exact key cannot be identified here. The origin
 * is therefore checked against the union of every live public key's allowlist,
 * which is the same list the POST will judge it against, and an unregistered
 * origin gets a bare 204 with no grant at all.
 *
 * This grants nothing by itself: a browser that passes preflight still has to
 * present a valid key on the POST, and that POST re-checks the origin against
 * that specific key's own allowlist.
 *
 * AUTH TIER: PUBLIC. A preflight carries no credential and cannot, so the
 * answer comes from a snapshot of the whole registry refreshed once per TTL
 * (see `lib/ingest/origin-registry`) rather than a query per request.
 */
const handleOptions = async (request: Request): Promise<NextResponse> => {
  const origin = request.headers.get("origin");

  const registered =
    origin !== null &&
    (await isOriginRegisteredCached(origin, listRegisteredOrigins));

  if (!registered) {
    return new NextResponse(null, { status: 204, headers: VARY_ORIGIN });
  }

  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
};

/**
 * Wrapped like every other handler here.
 *
 * The snapshot already fails closed on a database failure, so the wrapper is
 * the backstop for anything else: without it an unexpected throw would leave
 * Next to answer an unshaped 500 with no `Vary: Origin` on a response whose
 * cacheability depends on exactly that header.
 */
export const OPTIONS = withErrorHandler(
  { context: "ingest.options", errorHeaders: () => VARY_ORIGIN },
  handleOptions,
);
