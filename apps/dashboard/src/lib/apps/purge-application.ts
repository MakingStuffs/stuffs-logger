import {
  RETENTION_DELETE_BATCH_SIZE,
  RETENTION_MAX_BATCHES,
} from "@/constants/retention";
import { prisma } from "@/lib/db";

/**
 * Deleting an application and everything it ever wrote.
 *
 * The schema cascades from `applications` to ingest keys, usage rows and log
 * events, so a single `DELETE` of the application row would be CORRECT. It
 * would also be one statement over every event the application has sent in
 * the retention window — potentially millions of rows — holding locks and
 * bloating WAL for as long as it ran, and liable to be killed by the request
 * timeout with nothing committed.
 *
 * So the events go first, in the same bounded `ctid` batches the retention
 * sweep uses (`app/api/cron/retention/route.ts`), each its own committed
 * statement. Only once a batch comes back short is the application row
 * deleted, and its cascade is then left with the keys, the usage rows and at
 * most a handful of events that arrived during the sweep.
 */

/**
 * Wall-clock budget for one delete request's event batches.
 *
 * Under the `maxDuration` of 60 s exported by `/apps/[slug]`, whose Server
 * Actions inherit it, with room for the final cascade and the response. A
 * larger application simply takes more than one request: every batch already
 * deleted stays deleted, so a retry carries on from where this one stopped.
 */
export const APPLICATION_DELETE_TIME_BUDGET_MS = 45_000;

/** What one attempt to delete an application achieved. */
export interface PurgeApplicationResult {
  /** Whether the application row itself is gone. */
  complete: boolean;
  /** Log events deleted by this attempt's batches. */
  deletedEvents: number;
}

/** Options for {@link purgeApplication}. */
export interface PurgeApplicationOptions {
  /** Milliseconds the event batches may run for. */
  budgetMs?: number;
  /** The clock, injected for tests. */
  clock?: () => number;
}

/**
 * Deletes an application's log events in batches, then the application.
 *
 * @param applicationId - The application to delete. Already authorised and
 *   confirmed by the caller; this function makes no access decision.
 * @param options - The time budget and clock.
 * @returns Whether the application was deleted, and how many events went.
 *   `complete: false` means the budget ran out first and the application
 *   still exists, with fewer events than before.
 */
export async function purgeApplication(
  applicationId: string,
  options: PurgeApplicationOptions = {},
): Promise<PurgeApplicationResult> {
  const budgetMs = options.budgetMs ?? APPLICATION_DELETE_TIME_BUDGET_MS;
  const clock = options.clock ?? Date.now;
  const startedAt = clock();

  let deletedEvents = 0;
  let batches = 0;
  let eventsCleared = false;

  while (batches < RETENTION_MAX_BATCHES) {
    // The inner select walks the `(applicationId, timestamp)` index, so each
    // batch is an index range plus a Tid Scan — the same shape the retention
    // sweep measured at a few milliseconds per 5,000 rows.
    const count = await prisma.$executeRaw`
      DELETE FROM "log_events"
      WHERE ctid = ANY (ARRAY(
        SELECT ctid FROM "log_events"
        WHERE "applicationId" = ${applicationId}
        LIMIT ${RETENTION_DELETE_BATCH_SIZE}
      ))
    `;

    batches += 1;
    deletedEvents += count;

    if (count < RETENTION_DELETE_BATCH_SIZE) {
      eventsCleared = true;
      break;
    }
    if (clock() - startedAt >= budgetMs) break;
  }

  if (!eventsCleared) return { complete: false, deletedEvents };

  // `deleteMany` rather than `delete`: an application removed by a concurrent
  // request is the outcome this call wanted anyway, not an error to report.
  await prisma.application.deleteMany({ where: { id: applicationId } });

  return { complete: true, deletedEvents };
}
