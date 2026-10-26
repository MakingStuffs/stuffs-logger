/**
 * How long ingested events are kept.
 *
 * The retention sweep deletes on `receivedAt` — the server's own clock — so a
 * client reporting a false timestamp can neither make its rows immortal nor
 * have them deleted early.
 */
export const RETENTION_DAYS = 30;

/** The retention window in milliseconds. */
export const RETENTION_WINDOW_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Rows deleted per statement by the retention sweep.
 *
 * Batched rather than one big `DELETE`: a single statement over a month of
 * expired rows holds locks and bloats WAL for as long as it runs, and on a
 * serverless function it risks being killed part-way with nothing committed.
 */
export const RETENTION_DELETE_BATCH_SIZE = 5000;

/**
 * Wall-clock budget for one invocation's batches.
 *
 * The sweep keeps going while batches come back full and this much time has
 * not elapsed, then defers the remainder to the next run. Four minutes sits
 * under the route's `maxDuration` of 300 s with room for the batch in flight
 * and the response. The fixed ceiling it replaces (40 batches, 200k rows)
 * could never clear a backlog larger than a day's ingest, while using — at
 * 2.3 ms per batch measured — a fraction of a second of the function's time.
 */
export const RETENTION_TIME_BUDGET_MS = 240_000;

/**
 * Hard ceiling on batches per invocation, behind the time budget.
 *
 * Never the operative limit: at 5,000 rows a batch it is 50M rows, ten times
 * the table's steady state. It exists so the loop provably terminates even if
 * the clock the budget reads stood still.
 */
export const RETENTION_MAX_BATCHES = 10_000;

/**
 * Minimum gap between two accepted retention runs.
 *
 * Retention is a daily job. An hour still lets an operator re-run it by hand
 * after a failure without waiting for tomorrow, while making a leaked cron
 * token useless as a way to hammer the database with delete sweeps. Claimed
 * atomically inside `verifyApiToken`, never by the route.
 */
export const RETENTION_MIN_RUN_INTERVAL_MS = 60 * 60 * 1000;
