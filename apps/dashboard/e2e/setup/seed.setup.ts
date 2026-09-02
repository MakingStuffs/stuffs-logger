import { expect, test as setup } from "@playwright/test";

import {
  resolveDatabaseTarget,
  resolveE2eTarget,
  seedAllowedOrigins,
} from "../support/env";
import { writeSeedManifest } from "../support/manifest";
import { seedDatabase } from "../support/seed";

/**
 * Creates the fixtures every spec runs against, and records what it created.
 *
 * The seeding LOGIC lives in `../support/seed.ts` behind an injected store and
 * is unit-tested without a database; this file is only the wiring — resolve
 * the environment, run it, write the manifest.
 */

/** Inserting the log corpus and hashing two passwords is not instant. */
const SEED_TIMEOUT_MS = 120_000;

setup("seed the e2e database", async () => {
  const database = resolveDatabaseTarget(process.env);
  expect(database.ok, database.ok ? undefined : database.message).toBe(true);
  if (!database.ok) return;

  setup.setTimeout(SEED_TIMEOUT_MS);

  // IMPORTED LAZILY, and this is load-bearing: the store's module graph
  // reaches `src/lib/db.ts`, which constructs its Prisma client at import
  // time. A static import would run that before the check above and turn a
  // missing connection string into a Prisma stack trace instead of the
  // sentence that explains how to fix it.
  const { disconnectSeedStore, prismaSeedStore } =
    await import("../support/seed-store");

  const { baseUrl } = resolveE2eTarget(process.env);

  try {
    const seeded = await seedDatabase({
      store: prismaSeedStore,
      allowedOrigins: seedAllowedOrigins(
        baseUrl,
        process.env.E2E_SEED_ALLOWED_ORIGINS,
      ),
      now: new Date(),
    });

    await writeSeedManifest(seeded);
  } finally {
    // Released even on failure: the worker would otherwise be held open by the
    // connection pool long after the run had given up.
    await disconnectSeedStore();
  }
});
