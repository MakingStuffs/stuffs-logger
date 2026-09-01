import type { NextResponse } from "next/server";

import { ApiError } from "@/lib/api/errors";
import { apiSuccess } from "@/lib/api/responses";
import { withErrorHandler } from "@/lib/api/with-error-handler";
import { verifyApiToken } from "@/lib/auth/api-token";
import {
  RETENTION_DAYS,
  RETENTION_DELETE_BATCH_SIZE,
  RETENTION_MAX_BATCHES,
  RETENTION_MIN_RUN_INTERVAL_MS,
  RETENTION_WINDOW_MS,
} from "@/constants/retention";
import { prisma } from "@/lib/db";

/**
 * `GET /api/cron/retention` — deletes events past the retention window.
 *
 * AUTH TIER: MACHINE ONLY. There is no session here. The caller presents an
 * API token as `Authorization: Bearer <token>` and `verifyApiToken` decides —
 * atomically — whether it is a live credential. Nothing about it is re-checked
 * afterwards: the throttle is claimed inside that same call, and a second,
 * weaker implementation here could only disagree with it.
 *
 * Scheduled from vercel.json at 03:00 UTC daily. Vercel Cron sends the
 * deployment's `CRON_SECRET` as the bearer token, so that variable must hold a
 * raw token whose digest is a live row in `api_tokens`.
 *
 * It answers in the same envelope as every other endpoint here — thrown
 * {@link ApiError}s through {@link withErrorHandler} — including on refusal. A
 * cron caller has little use for a body, but an operator debugging a failing
 * schedule at 03:00 has every use for `{ code, message }` instead of an empty
 * 401, and a second response shape in the app is a second shape to maintain.
 */

/** Node runtime: this talks to Postgres. */
export const runtime = "nodejs";

/** Never cached — it mutates. */
export const dynamic = "force-dynamic";

/** Seconds this handler may run for, bounded by the Vercel Pro ceiling. */
export const maxDuration = 300;

const BEARER_SCHEME = "bearer";

/** The presented credential, or null when the header is absent or malformed. */
function bearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  if (header === null) return "";

  const separator = header.indexOf(" ");
  if (separator === -1) return "";
  if (header.slice(0, separator).toLowerCase() !== BEARER_SCHEME) return "";

  return header.slice(separator + 1).trim();
}

/**
 * Deletes expired rows in bounded batches.
 *
 * One `DELETE` covering a month of rows would hold locks and bloat WAL for as
 * long as it ran, and could be killed part-way by the function timeout with
 * nothing committed. Batching commits progress as it goes, so an interrupted
 * run simply resumes tomorrow.
 *
 * @param cutoff - Rows received before this are deleted.
 * @returns How many rows were deleted, and whether work remains.
 */
async function deleteExpiredEvents(
  cutoff: Date,
): Promise<{ deleted: number; complete: boolean }> {
  let deleted = 0;

  for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch += 1) {
    // Selected by id first so the delete targets a bounded set: Prisma's
    // deleteMany has no LIMIT of its own.
    const expiring = await prisma.logEvent.findMany({
      where: { receivedAt: { lt: cutoff } },
      select: { id: true },
      take: RETENTION_DELETE_BATCH_SIZE,
    });

    if (expiring.length === 0) return { deleted, complete: true };

    const result = await prisma.logEvent.deleteMany({
      where: { id: { in: expiring.map((row) => row.id) } },
    });

    deleted += result.count;
  }

  return { deleted, complete: false };
}

const handleGet = async (request: Request): Promise<NextResponse> => {
  const verification = await verifyApiToken(bearerToken(request), {
    minIntervalMs: RETENTION_MIN_RUN_INTERVAL_MS,
  });

  if (!verification.ok) {
    // 401 for "invalid" — one flat reason, never saying which check failed —
    // and 429 for a good credential presented too soon.
    if (verification.reason === "rate_limited") {
      throw new ApiError(
        "RATE_LIMITED",
        "This job has already run too recently.",
        {
          logContext: `retention token presented inside ${RETENTION_MIN_RUN_INTERVAL_MS}ms`,
        },
      );
    }

    throw new ApiError("UNAUTHORIZED", "Invalid credentials.", {
      logContext: "retention token unknown, malformed or revoked",
    });
  }

  const cutoff = new Date(Date.now() - RETENTION_WINDOW_MS);
  const { deleted, complete } = await deleteExpiredEvents(cutoff);

  console.info(
    `[retention] deleted ${deleted} events received before ${cutoff.toISOString()}` +
      (complete
        ? ""
        : " (batch ceiling reached; remainder deferred to the next run)"),
  );

  // An unexpected failure is left to the wrapper: it logs the real error and
  // answers one fixed 500, which is exactly what was hand-written here before.
  return apiSuccess({
    deleted,
    complete,
    retentionDays: RETENTION_DAYS,
    cutoff: cutoff.toISOString(),
  });
};

export const GET = withErrorHandler({ context: "cron.retention" }, handleGet);
