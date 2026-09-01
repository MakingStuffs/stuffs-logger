import { PrismaClient } from "@prisma/client";

import { IS_PROD } from "@/constants/environment";

/**
 * The application's Prisma client.
 *
 * Cached on `globalThis` outside production because Next's dev server reloads
 * modules on every edit, and a fresh client per reload exhausts the database's
 * connection limit within minutes.
 */

const globalForPrisma = globalThis as unknown as {
  jfLoggerPrisma?: PrismaClient;
};

function createClient(): PrismaClient {
  return new PrismaClient({
    log: IS_PROD ? ["error"] : ["error", "warn"],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.jfLoggerPrisma ?? createClient();

if (!IS_PROD) globalForPrisma.jfLoggerPrisma = prisma;
