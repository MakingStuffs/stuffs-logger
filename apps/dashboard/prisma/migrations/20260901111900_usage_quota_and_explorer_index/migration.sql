-- Daily per-application ingest quota, the unfiltered-explorer index, and a GIN
-- index for the CORS preflight's origin containment test.
--
-- Generated offline with:
--   prisma migrate diff --from-schema-datamodel <previous schema>
--                       --to-schema-datamodel prisma/schema.prisma --script
-- (`--from-migrations` needs a shadow database; there is none here.)
--
-- NOTE for a large deployment: both CREATE INDEX statements take an ACCESS
-- SHARE-blocking lock for the duration of the build. At the current row counts
-- that is seconds. Past a few million rows, run them by hand as
-- CREATE INDEX CONCURRENTLY (which cannot run inside a migration transaction)
-- and then mark this migration applied.

-- CreateTable
CREATE TABLE "application_usage" (
    "applicationId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "byteCount" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_usage_pkey" PRIMARY KEY ("applicationId","day")
);

-- CreateIndex
CREATE INDEX "ingest_keys_allowedOrigins_idx" ON "ingest_keys" USING GIN ("allowedOrigins" array_ops);

-- CreateIndex
CREATE INDEX "log_events_timestamp_id_idx" ON "log_events"("timestamp" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "application_usage" ADD CONSTRAINT "application_usage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

