import { PrismaClient } from "@prisma/client";

import { IS_PROD } from "@/constants/environment";

/**
 * The application's Prisma client.
 *
 * ONE PER PROCESS, cached on `globalThis` in every environment. Two separate
 * things make the cache necessary, and only one of them is about development:
 *
 * - Next's dev server reloads modules on every edit. A fresh client per reload
 *   exhausts the database's connection limit within minutes.
 * - A production bundle can hold this module MORE THAN ONCE. When a client
 *   component imports a Server Action, webpack compiles the action into its
 *   own "action-browser" layer, and everything the action reaches — this file,
 *   `lib/auth/auth.ts` behind it — is compiled again inside that layer beside
 *   the page's own copy. Each copy would construct its own client and its own
 *   connection pool. How the module graph is arranged is the bundler's
 *   business; the process has exactly one `globalThis`, so that is where the
 *   single client lives.
 *
 * The actions are now imported only from server components, which removes the
 * second copy — but a cache that depends on nobody ever importing them from
 * the other side of the boundary is a cache that fails on the next refactor.
 */
const globalForPrisma = globalThis as unknown as {
  stuffsLoggerPrisma?: PrismaClient;
};

function createClient(): PrismaClient {
  return new PrismaClient({
    log: IS_PROD ? ["error"] : ["error", "warn"],
  });
}

export const prisma: PrismaClient = (globalForPrisma.stuffsLoggerPrisma ??=
  createClient());
