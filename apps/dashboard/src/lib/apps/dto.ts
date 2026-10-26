/**
 * Shapes the application pages read that the log DTOs do not already cover.
 *
 * Browser-safe: types only. Every number here is a plain `number` — the
 * database holds the byte counter as a BigInt, and a BigInt cannot cross the
 * server/client boundary, so the query converts it before it leaves.
 */

/** One application's ingest volume for the current UTC day, against its ceilings. */
export interface ApplicationUsageToday {
  /** The UTC day these counters cover, as `YYYY-MM-DD`. */
  day: string;
  /** Events counted so far today. `0` when nothing has been sent. */
  eventCount: number;
  /** Request bytes counted so far today. */
  byteCount: number;
  /** The daily event ceiling the ingest endpoint enforces. */
  eventQuota: number;
  /** The daily byte ceiling the ingest endpoint enforces. */
  byteQuota: number;
}
