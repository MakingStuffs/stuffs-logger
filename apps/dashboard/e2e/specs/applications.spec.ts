import { expect, test } from "@playwright/test";

import { applicationLogsHref } from "@/components/logs/search-params";

import { SEED_APPLICATION } from "../support/fixtures";
import { readSeedManifest } from "../support/manifest";

/**
 * The applications section: the list, and the way from it into one
 * application's own page.
 *
 * READ-ONLY and safe beside anything else. The one mutation this section
 * offers — minting and revoking ingest keys — lives in `ingest-keys.spec.ts`,
 * which creates everything it touches.
 */

test("the seeded application is listed, and its page opens from the list", async ({
  page,
}) => {
  const seeded = await readSeedManifest();

  await page.goto("/apps");

  await expect(
    page.getByRole("heading", { level: 1, name: "Applications" }),
  ).toBeVisible();

  // Scoped to `main`: the sidebar lists the same sections, and "Applications"
  // is one of them.
  const card = page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ hasText: SEED_APPLICATION.slug });

  await expect(card).toBeVisible();
  await expect(card).toContainText(SEED_APPLICATION.description);

  // The card's shortcut into the explorer, already scoped to this
  // application — the same href the overview card offers.
  await expect(
    card.getByRole("link", { name: `View logs for ${seeded.applicationName}` }),
  ).toHaveAttribute("href", applicationLogsHref(seeded.applicationSlug));

  // The journey: the card's title is the link into the application's own page.
  // `exact` is load-bearing — accessible-name matching is a substring search
  // by default, and the card's other link is named "View logs for E2E
  // Checkout", which contains this one.
  await card
    .getByRole("link", { name: seeded.applicationName, exact: true })
    .click();

  await expect(page).toHaveURL(`/apps/${seeded.applicationSlug}`);
  await expect(
    page.getByRole("heading", { level: 1, name: seeded.applicationName }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText(SEED_APPLICATION.description),
  ).toBeVisible();

  // And the way on to this application's own log stream.
  await expect(
    page.getByRole("link", { name: "View logs", exact: true }),
  ).toHaveAttribute("href", applicationLogsHref(seeded.applicationSlug));
});

test("an application that does not exist is a real 404, not an empty page", async ({
  page,
}) => {
  // A slug nobody registered. `notFound()` must answer with the status, not
  // with a soft 404 that renders chrome around nothing — a 200 here would make
  // every mistyped link look like a working page.
  const response = await page.goto("/apps/no-such-application");

  expect(response, "the application page returned no response").not.toBeNull();
  expect(response === null ? 0 : response.status()).toBe(404);
});
