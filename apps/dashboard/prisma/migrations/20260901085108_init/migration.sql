-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

-- CreateEnum
CREATE TYPE "LogSource" AS ENUM ('BROWSER', 'NODE');

-- CreateEnum
CREATE TYPE "LoggerKind" AS ENUM ('MANUAL', 'CONSOLE', 'ONERROR', 'UNHANDLEDREJECTION', 'UNCAUGHTEXCEPTION');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('DESKTOP', 'MOBILE', 'TABLET', 'BOT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IngestKeyType" AS ENUM ('PUBLIC', 'SECRET');

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_keys" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" "IngestKeyType" NOT NULL,
    "name" TEXT NOT NULL,
    "publicKey" TEXT,
    "keyId" TEXT,
    "secretHash" TEXT,
    "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingest_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_events" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "LogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "logger" "LoggerKind" NOT NULL,
    "context" JSONB,
    "environment" TEXT NOT NULL,
    "release" TEXT,
    "source" "LogSource" NOT NULL,
    "sessionId" TEXT,
    "url" TEXT,
    "userAgent" TEXT,
    "deviceType" "DeviceType",
    "os" TEXT,
    "browser" TEXT,
    "errorName" TEXT,
    "errorMessage" TEXT,
    "errorStack" TEXT,

    CONSTRAINT "log_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "applications_slug_key" ON "applications"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ingest_keys_publicKey_key" ON "ingest_keys"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "ingest_keys_keyId_key" ON "ingest_keys"("keyId");

-- CreateIndex
CREATE INDEX "ingest_keys_applicationId_idx" ON "ingest_keys"("applicationId");

-- CreateIndex
CREATE INDEX "log_events_applicationId_timestamp_idx" ON "log_events"("applicationId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "log_events_applicationId_level_timestamp_idx" ON "log_events"("applicationId", "level", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "log_events_applicationId_environment_timestamp_idx" ON "log_events"("applicationId", "environment", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "log_events_receivedAt_idx" ON "log_events"("receivedAt");

-- AddForeignKey
ALTER TABLE "ingest_keys" ADD CONSTRAINT "ingest_keys_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_events" ADD CONSTRAINT "log_events_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

