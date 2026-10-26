import { expect, test } from "@playwright/test";

import { SEED_MEMBER, SEED_PUBLIC_KEY_NAME } from "../support/fixtures";
import { readSeedManifest } from "../support/manifest";

/**
 * The role mechanism, proven — and the denial test that goes with it.
 *
 * Two jobs, and both are the harness's rather than the product's:
 *
 *  1. It proves `test.use({ storageState: SEED_MEMBER.storageStatePath })`
 *     actually selects a different signed-in user. Every spec written against
 *     this harness relies on that one line; handing it on unproven would mean
 *     a role-scoped assertion could pass because it was silently running as
 *     the admin all along.
 *  2. It is the cross-role DENIAL test for the tightest gate in the product.
 *     An ingest key is a live write credential for the public ingest endpoint,
 *     and a revocation silently stops a production application logging, so
 *     `assertAdminViewer` holds key management above "signed in". An
 *     authorization rule with no test proving refusal is an unverified rule.
 *
 * Read-only, and safe to run in parallel with anything else: both tests visit
 * the seeded application's page and neither writes.
 */

/** The heading `IngestKeysSection` renders when a caller may see the keys. */
const KEYS_HEADING = "Ingest keys";

/** The heading `AccessRefused` renders for a FORBIDDEN outcome. */
const REFUSAL_HEADING = "Administrators only";

test.describe("as the seeded ADMIN", () => {
  // No `test.use` — the chromium project's default storage state is the admin.
  test("the ingest keys are visible", async ({ page }) => {
    const seeded = await readSeedManifest();

    await page.goto(`/apps/${seeded.applicationSlug}`);

    await expect(
      page.getByRole("heading", { level: 2, name: KEYS_HEADING }),
    ).toBeVisible();
    await expect(page.getByText(SEED_PUBLIC_KEY_NAME)).toBeVisible();
  });
});

test.describe("as the seeded MEMBER", () => {
  // THIS IS THE LINE PASS 3 COPIES to run a spec as the other role.
  test.use({ storageState: SEED_MEMBER.storageStatePath });

  test("the application is readable but its ingest keys are refused", async ({
    page,
  }) => {
    const seeded = await readSeedManifest();

    await page.goto(`/apps/${seeded.applicationSlug}`);

    // The page itself is not refused: any live account reads applications.
    await expect(
      page.getByRole("heading", { level: 1, name: seeded.applicationName }),
    ).toBeVisible();

    // The keys section is, and the refusal is a designed state rather than an
    // error page.
    await expect(
      page.getByRole("heading", { name: REFUSAL_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: KEYS_HEADING }),
    ).toHaveCount(0);

    // The strongest form of the assertion: the credential itself never reached
    // the page, not merely that a section was hidden.
    await expect(page.getByText(seeded.publicKey)).toHaveCount(0);
    await expect(page.getByText(SEED_PUBLIC_KEY_NAME)).toHaveCount(0);
  });
});
