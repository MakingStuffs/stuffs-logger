/**
 * The durable per-application ingest ceiling.
 *
 * The in-instance limiter in `./rate-limit` is the fast first line: it costs
 * nothing, it catches the accidental `console.log` in a render loop, and it
 * resets on every cold start. That last property is why it cannot be the whole
 * control — on a serverless host the real ceiling it imposes is
 * `limit x live instances`, which an attacker with a scraped key raises simply
 * by sending more traffic.
 *
 * This is the control that actually bounds the damage. One row per application
 * per UTC day in Postgres, incremented ONCE per batch, checked against a named
 * ceiling. It survives instances, regions and restarts, and because retention
 * is time-based (nothing sheds attacker volume early) it is also what stops a
 * flood filling the table for the next thirty days.
 *
 * The counters are advanced for every batch that reaches this check, accepted
 * or refused. That is deliberate: a caller who has already crossed the ceiling
 * should not be able to keep the day's total pinned just under it by having
 * their batches rejected.
 */

/**
 * Events one application may send per UTC day.
 *
 * Sized against the stated scale target — ~5M events/month across ALL
 * applications, i.e. ~167k/day in total — so a single application at 250k/day
 * is already far outside normal and worth refusing.
 *
 * TO RAISE IT: change this number. It is a product decision, not a technical
 * limit; the storage cost of a day at the ceiling is roughly
 * `DAILY_EVENT_QUOTA x average row size`, held for the retention window.
 */
export const DAILY_EVENT_QUOTA = 250_000;

/**
 * Request bytes one application may send per UTC day.
 *
 * A second ceiling because events are not the only cost: 250k events of 32KB
 * context each is 8GB. 1GiB/day is generous for the event ceiling above and
 * still bounds the write volume. Raise it the same way.
 */
export const DAILY_BYTE_QUOTA = 1024 * 1024 * 1024;

/** A day's counters for one application. */
export interface ApplicationUsageTotals {
  /** Events counted so far today, INCLUDING the batch just added. */
  eventCount: number;
  /** Request bytes counted so far today, including the batch just added. */
  byteCount: number;
}

/** What one batch adds to the day's counters. */
export interface UsageDelta {
  /** Events in the batch. */
  events: number;
  /** Bytes of the request body that carried it. */
  bytes: number;
}

/** The durable counter store. Injected so the policy below is testable. */
export interface ApplicationUsageStore {
  /**
   * Adds a batch to an application's counters for a day and returns the new
   * totals.
   *
   * Must be atomic: two instances writing the same row concurrently have to
   * both be counted, or the ceiling is advisory.
   */
  increment(input: {
    applicationId: string;
    day: Date;
    delta: UsageDelta;
  }): Promise<ApplicationUsageTotals>;
}

/** Why a batch was refused by the quota. */
export type QuotaDenialReason = "daily_event_quota" | "daily_byte_quota";

/** The outcome of counting a batch against the day's quota. */
export type QuotaResult =
  | { allowed: true; totals: ApplicationUsageTotals }
  | {
      allowed: false;
      reason: QuotaDenialReason;
      totals: ApplicationUsageTotals;
      /** Seconds until the UTC day rolls over and the quota resets. */
      retryAfterSeconds: number;
    };

/** Milliseconds in a day, for the reset calculation. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Midnight UTC of the day a moment falls in.
 *
 * UTC rather than local time so every instance, in every region, agrees on
 * which row it is incrementing.
 *
 * @param now - The moment to bucket.
 * @returns The start of its UTC day.
 * @example
 * utcDayStart(new Date("2026-09-01T23:30:00Z")); // 2026-09-01T00:00:00Z
 */
export function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Seconds until the UTC day containing `now` ends. */
function secondsUntilUtcMidnight(now: Date): number {
  const elapsed = now.getTime() - utcDayStart(now).getTime();
  return Math.max(1, Math.ceil((DAY_MS - elapsed) / 1000));
}

/**
 * Counts a batch against its application's daily quota.
 *
 * The batch that crosses a ceiling is the last one accepted: the totals are
 * advanced first and compared afterwards, so the check costs exactly one write
 * and a caller is never refused for volume it has not yet sent.
 *
 * @param applicationId - The application from the VERIFIED key, never the body.
 * @param delta - What this batch adds.
 * @param options - The counter store, and the clock (injected for tests).
 * @returns Whether the batch may be stored, plus the day's totals.
 */
export async function consumeDailyQuota(
  applicationId: string,
  delta: UsageDelta,
  options: { store: ApplicationUsageStore; now?: Date },
): Promise<QuotaResult> {
  const now = options.now ?? new Date();

  const totals = await options.store.increment({
    applicationId,
    day: utcDayStart(now),
    delta,
  });

  // Compared against the totals BEFORE this batch: a caller under the ceiling
  // when they hit send is served, and the next batch is the one refused.
  const priorEvents = totals.eventCount - delta.events;
  const priorBytes = totals.byteCount - delta.bytes;

  if (priorEvents >= DAILY_EVENT_QUOTA) {
    return {
      allowed: false,
      reason: "daily_event_quota",
      totals,
      retryAfterSeconds: secondsUntilUtcMidnight(now),
    };
  }

  if (priorBytes >= DAILY_BYTE_QUOTA) {
    return {
      allowed: false,
      reason: "daily_byte_quota",
      totals,
      retryAfterSeconds: secondsUntilUtcMidnight(now),
    };
  }

  return { allowed: true, totals };
}
