import {
  INGEST_KEY_HEADER,
  MAX_BODY_BYTES,
  parseIngestEnvelope,
} from "@jf-logger/core";
import { NextResponse } from "next/server";

import { ApiError } from "@/lib/api/errors";
import { apiSuccess } from "@/lib/api/responses";
import { withErrorHandler } from "@/lib/api/with-error-handler";
import { corsHeaders, VARY_ORIGIN } from "@/lib/ingest/cors";
import {
  recallCorsHeaders,
  rememberCorsHeaders,
} from "@/lib/ingest/cors-context";
import { keyClassAllowsSource, verifyIngestKey } from "@/lib/ingest/keys";
import { normaliseBatch, type RejectedEvent } from "@/lib/ingest/normalise";
import { isOriginRegisteredCached } from "@/lib/ingest/origin-registry";
import { consumeDailyQuota } from "@/lib/ingest/quota";
import { consumeRateLimit } from "@/lib/ingest/rate-limit";
import { shouldStampLastUsed } from "@/lib/ingest/last-used";
import {
  insertLogEvents,
  isOriginRegistered,
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
 * body, the clock, the user agent — so the order below is deliberate and each
 * step is cheap before the one after it:
 *
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
 * applies to work this endpoint has not done yet. It also means every refusal
 * from step 3 onwards carries CORS headers, so the SDK reads a real status
 * instead of an opaque network error.
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

/** Reads the body as bytes, refusing anything over the limit. */
async function readBoundedBody(request: Request): Promise<BoundedBody> {
  // The advertised length is checked first so an oversized upload is refused
  // before it is buffered. It is a claim, not a fact, so the real size is
  // checked again below.
  const advertised = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(advertised) && advertised > MAX_BODY_BYTES) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "Request body is too large.", {
      logContext: `content-length ${advertised} exceeds ${MAX_BODY_BYTES}`,
    });
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "Request body is too large.", {
      logContext: `body ${buffer.byteLength} bytes exceeds ${MAX_BODY_BYTES}`,
    });
  }

  const text = new TextDecoder().decode(buffer);

  try {
    return { value: JSON.parse(text), byteLength: buffer.byteLength };
  } catch {
    throw new ApiError("INVALID_INPUT", "Request body must be valid JSON.");
  }
}

const handlePost = async (request: Request): Promise<NextResponse> => {
  const origin = request.headers.get("origin");
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
          logContext: `origin ${origin ?? "<none>"} not on key allowlist`,
        },
      );
    }
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
 * A preflight cannot carry `x-jf-key` — browsers send only the method and the
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
 * lookup behind it is cached and budgeted (see `lib/ingest/origin-registry`)
 * rather than issued per request.
 */
export async function OPTIONS(request: Request): Promise<NextResponse> {
  const origin = request.headers.get("origin");

  // Cached and budgeted: this path is unauthenticated, so it must not be a way
  // to make an anonymous request cost a database query.
  const registered =
    origin !== null &&
    (await isOriginRegisteredCached(origin, isOriginRegistered));

  if (!registered) {
    return new NextResponse(null, { status: 204, headers: VARY_ORIGIN });
  }

  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}
