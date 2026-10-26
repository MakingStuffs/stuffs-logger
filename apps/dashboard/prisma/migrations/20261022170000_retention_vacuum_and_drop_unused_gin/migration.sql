-- Retention-aware autovacuum for `log_events`, and the removal of an index no
-- query uses.
--
-- The DropIndex was generated offline with:
--   prisma migrate diff --from-schema-datamodel <schema at HEAD>
--                       --to-schema-datamodel prisma/schema.prisma --script
-- The ALTER TABLE is hand-written: Prisma has no datamodel syntax for storage
-- parameters, so they live only here (and are noted on the model in
-- schema.prisma). Both statements are metadata-only and take effect
-- immediately; neither rewrites the table.

-- Autovacuum thresholds for the one table whose churn is one-directional.
--
-- The retention sweep deletes at the OLDEST end of the table and ingest
-- inserts at the NEWEST. With the defaults (vacuum at 20% dead tuples, insert
-- vacuum at 20% new rows) a 5M-row table would carry ~1M dead tuples before
-- autovacuum ran — a fifth of the heap unreclaimed, the visibility map stale
-- across the pages the sweep just emptied, and the explorer's index-only
-- scans falling back to heap fetches on exactly the newest pages (which the
-- insert threshold would leave unvacuumed for a day's ingest). 2% dead and
-- 5% inserted are ~100k and ~250k rows: roughly one retention run and one
-- hour of ingest respectively, so vacuum keeps pace with both ends.
ALTER TABLE "log_events" SET (
    autovacuum_vacuum_scale_factor = 0.02,
    autovacuum_vacuum_insert_scale_factor = 0.05
);

-- DropIndex
--
-- The CORS preflight reads every live public key's origins in one query
-- filtered on `type` and `revokedAt` (`listRegisteredOrigins`) and tests
-- containment in memory; nothing asks Postgres `allowedOrigins @> ...`, so
-- the GIN index built for that shape has never been read. The table holds a
-- handful of rows.
DROP INDEX "ingest_keys_allowedOrigins_idx";
