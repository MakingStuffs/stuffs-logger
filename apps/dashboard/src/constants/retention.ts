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

/** Ceiling on batches per invocation, so the handler always finishes in time. */
export const RETENTION_MAX_BATCHES = 40;
