import { expect, test as setup } from "@playwright/test";

import { resolveSmokeTarget } from "../support/env";

/**
 * Refuses a smoke run that has no target.
 *
 * The smoke suite is the only one that runs against a deployed environment, so
 * "which origin" is the one fact it must never guess. A default would let a
 * mis-set pipeline variable produce a green run that checked localhost — or
 * nothing — while reporting a healthy deployment.
 *
 * A setup project rather than a throw in the config, because the config is
 * loaded for every run: refusing there would also refuse the local e2e run,
 * which has no business needing a deployed URL.
 */

setup("a smoke target is configured", async () => {
  const smoke = resolveSmokeTarget(process.env);

  expect(smoke.ok, smoke.ok ? undefined : smoke.message).toBe(true);
});
