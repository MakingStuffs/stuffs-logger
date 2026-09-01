import { verifyApiToken } from "@journey-further/salient-auth/server";
import { NextResponse } from "next/server";

import { APP_SLUG } from "@/constants/environment";
import {
  RETENTION_DAYS,
  RETENTION_DELETE_BATCH_SIZE,
  RETENTION_MAX_BATCHES,
  RETENTION_WINDOW_MS,
} from "@/constants/retention";
import { prisma } from "@/lib/db";

/**
 * `GET /api/cron/retention` — deletes events past the retention window.
 *
 * AUTH TIER: MACHINE ONLY. There is no session here. The caller presents an
 * application API token as `Authorization: Bearer <token>` and
 * `verifyApiToken` decides — atomically — whether it is a live credential
 * bound to THIS application. Nothing about the credential is re-checked
 * afterwards: the package enforces the binding and the throttle inside one
 * claim, and a second, weaker implementation here could only disagree with it.
 *
 * Scheduled from vercel.json at 03:00 UTC daily. Vercel Cron sends the
 * deployment's `CRON_SECRET` as the bearer token, so that variable must hold a
 * raw token minted for this app's catalog entry.
 */

/** Node runtime: this talks to Postgres. */
export const runtime = "nodejs";

/** Never cached — it mutates. */
export const dynamic = "force-dynamic";

/** Seconds this handler may run for, bounded by the Vercel Pro ceiling. */
export const maxDuration = 300;

/**
 * Minimum gap between two accepted runs.
 *
 * Retention is a daily job. An hour still lets an operator re-run it by hand
 * after a failure without waiting for tomorrow, while making a leaked token
 * useless as a way to hammer the database with delete sweeps.
 */
const MIN_INTERVAL_MS = 60 * 60 * 1000;

/** Authenticated, one-off work: never cached, refusals included. */
const NO_STORE = { "cache-control": "no-store" } as const;

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

export async function GET(request: Request): Promise<NextResponse> {
  const verification = await verifyApiToken(bearerToken(request), {
    applicationSlug: APP_SLUG,
    minIntervalMs: MIN_INTERVAL_MS,
  });

  if (!verification.ok) {
    // 401 for "invalid" — one flat reason, never saying which check failed —
    // and 429 for a good credential presented too soon.
    const status = verification.reason === "rate_limited" ? 429 : 401;
    return new NextResponse(null, { status, headers: NO_STORE });
  }

  const cutoff = new Date(Date.now() - RETENTION_WINDOW_MS);

  try {
    const { deleted, complete } = await deleteExpiredEvents(cutoff);

    console.info(
      `[retention] deleted ${deleted} events received before ${cutoff.toISOString()}` +
        (complete
          ? ""
          : " (batch ceiling reached; remainder deferred to the next run)"),
    );

    return NextResponse.json(
      {
        success: true as const,
        data: {
          deleted,
          complete,
          retentionDays: RETENTION_DAYS,
          cutoff: cutoff.toISOString(),
        },
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    // One fixed shape whatever failed: a cron caller has no use for the
    // detail, and the detail is exactly what must not leave the server.
    console.error("[retention] sweep failed:", error);
    return NextResponse.json(
      {
        success: false as const,
        error: { code: "INTERNAL_ERROR", message: "Retention sweep failed." },
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
