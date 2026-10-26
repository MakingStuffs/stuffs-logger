import { test as teardown } from "@playwright/test";

import { resolveDatabaseTarget } from "../support/env";
import { SEED_USERS } from "../support/fixtures";

/**
 * Deactivates the seeded accounts once the browser projects have finished.
 *
 * WHY. The seed force-creates an ADMIN whose password is a public literal in
 * this repository (`../support/fixtures.ts`). On the throwaway CI database
 * that account dies with the runner; on a developer's long-lived local
 * Postgres it would otherwise stay signable-in through the ordinary sign-in
 * form, with a password anyone can read, until the next run. Flipping
 * `isActive` off closes that window: `getSession` refuses an inactive user
 * (`src/lib/auth/session.ts`), so the account is inert, and the next seed's
 * `setRoleAndActivate` turns it back on — the deactivation is reversible and
 * the seed stays idempotent.
 *
 * WHEN. Named as the `teardown` of every browser project in
 * `playwright.config.ts`, so Playwright runs it after those projects and
 * everything that depends on them, whether or not their tests passed. The
 * smoke chain never reaches it: it has no database and no project in it
 * names this teardown.
 *
 * ONE WRITE, BY EMAIL. The seeded users are addressed by the emails the
 * fixtures declare, lower-cased the way `createUserWithPassword` stores them,
 * and nothing else in the table is touched.
 */

/** Two rows, one statement; the pool is the slow part. */
const TEARDOWN_TIMEOUT_MS = 60_000;

teardown("deactivate the seeded accounts", async () => {
  const database = resolveDatabaseTarget(process.env);

  // Nothing was seeded if the target was refused, and the `seed` project has
  // already said why — a second red line here would only repeat it.
  teardown.skip(
    !database.ok,
    "no e2e database was accepted, so nothing was seeded",
  );
  if (!database.ok) return;

  teardown.setTimeout(TEARDOWN_TIMEOUT_MS);

  // IMPORTED LAZILY, for the same reason `seed.setup.ts` does: the module
  // graph reaches `src/lib/db.ts`, which constructs its Prisma client at
  // import time, and that must not happen before the target has been checked.
  const [{ prisma }, { disconnectSeedStore }] = await Promise.all([
    import("@/lib/db"),
    import("../support/seed-store"),
  ]);

  try {
    const { count } = await prisma.user.updateMany({
      where: {
        email: { in: SEED_USERS.map((user) => user.email.toLowerCase()) },
      },
      data: { isActive: false },
    });

    teardown.info().attach("deactivated-seed-users", {
      body: `${count} of ${SEED_USERS.length} seeded account(s) deactivated`,
      contentType: "text/plain",
    });
  } finally {
    await disconnectSeedStore();
  }
});
