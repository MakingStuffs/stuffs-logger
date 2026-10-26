import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SEED_APPLICATION, SEED_MEMBER } from "../support/fixtures";
import { readSeedManifest } from "../support/manifest";

/**
 * Application administration: creating, editing and deleting an application,
 * and being shown none of it as a member.
 *
 * EVERY MUTATION HERE ACTS ON AN APPLICATION THIS SPEC CREATED ITSELF. The
 * run is `fullyParallel` and the seeded `e2e-checkout` application is read by
 * nearly every other spec, so editing or deleting it would break them
 * mid-run. The seeded application is only ever used here as a slug to
 * collide with (which writes nothing) and as a page for the member to look
 * at. Names carry a `randomUUID()`, so no two runs or workers can collide.
 *
 * The lifecycle test deletes what it creates. One that fails part-way leaves
 * an application behind; it is uniquely named and harmless, and the next run
 * does not depend on its absence.
 */

/** A name — and so a suggested slug — no other spec or run can collide with. */
function uniqueApplicationName(): string {
  return `E2E admin ${randomUUID()}`;
}

/** The slug the dialog suggests for a name built by `uniqueApplicationName`. */
function expectedSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Opens the create dialog from `/apps` and returns it. */
async function openCreateDialog(page: Page) {
  await page.goto("/apps");
  await page.getByRole("button", { name: "New application" }).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Create an application" }),
  ).toBeVisible();
  return dialog;
}

test.describe("as the seeded ADMIN", () => {
  // No `test.use`: the chromium project's default storage state is the admin.

  test("an application is created, edited and deleted", async ({ page }) => {
    const name = uniqueApplicationName();
    const slug = expectedSlug(name);
    const renamed = `${name} renamed`;

    // CREATE. The slug is suggested from the name; the server validates it.
    const createDialog = await openCreateDialog(page);
    await createDialog.getByLabel("Name", { exact: true }).fill(name);
    await expect(createDialog.getByLabel("Slug", { exact: true })).toHaveValue(
      slug,
    );
    await createDialog
      .getByLabel(/description/i)
      .fill("Created by the admin e2e spec.");
    await createDialog
      .getByRole("button", { name: "Create application" })
      .click();

    // The action redirects to the new application's own page.
    await expect(page).toHaveURL(`/apps/${slug}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Usage today" }),
    ).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: "Events" }),
    ).toHaveAttribute("aria-valuenow", "0");

    // EDIT. The slug is shown but cannot be changed.
    await page.getByRole("button", { name: "Edit details" }).click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog.getByLabel("Slug", { exact: true })).toHaveValue(
      slug,
    );
    await expect(
      editDialog.getByLabel("Slug", { exact: true }),
    ).not.toBeEditable();
    await editDialog.getByLabel("Name", { exact: true }).fill(renamed);
    await editDialog.getByLabel(/description/i).fill("Edited by the spec.");
    await editDialog.getByRole("button", { name: "Save changes" }).click();

    // The dialog closes itself once the action has saved and revalidated.
    await expect(editDialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 1, name: renamed }),
    ).toBeVisible();
    await expect(page).toHaveURL(`/apps/${slug}`);

    // Persisted, not just reflected in the component that submitted it.
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: renamed }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByText("Edited by the spec."),
    ).toBeVisible();

    // DELETE, from its separated danger zone, behind the retyped slug.
    const dangerZone = page.getByRole("region", { name: "Danger zone" });
    await dangerZone
      .getByRole("button", { name: "Delete application" })
      .click();

    const deleteDialog = page.getByRole("dialog");
    await expect(
      deleteDialog.getByRole("heading", { name: `Delete ${renamed}?` }),
    ).toBeVisible();
    await expect(deleteDialog).toContainText("every log line");

    // A wrong confirmation — here the NAME, a plausible slip — is refused, and
    // the dialog staying open is the refusal.
    const confirm = deleteDialog.getByLabel(
      /type the application.s slug to confirm/i,
    );
    await confirm.fill(renamed);
    await deleteDialog
      .getByRole("button", { name: "Delete permanently" })
      .click();
    await expect(deleteDialog.getByRole("alert")).toContainText(
      "Type the application's slug exactly.",
    );
    await expect(deleteDialog).toBeVisible();

    await confirm.fill(slug);
    await deleteDialog
      .getByRole("button", { name: "Delete permanently" })
      .click();

    await expect(page).toHaveURL("/apps");
    await expect(
      page.getByRole("main").getByRole("listitem").filter({ hasText: slug }),
    ).toHaveCount(0);

    // Gone for real: its page is now a 404.
    const response = await page.goto(`/apps/${slug}`);
    expect(response === null ? 0 : response.status()).toBe(404);
  });

  test("a slug another application holds is a field error, not a failure", async ({
    page,
  }) => {
    // Collides with the seeded application's slug. The unique index refuses
    // the insert, so nothing is written and the seeded app is untouched.
    const dialog = await openCreateDialog(page);
    await dialog
      .getByLabel("Name", { exact: true })
      .fill(uniqueApplicationName());
    await dialog
      .getByLabel("Slug", { exact: true })
      .fill(SEED_APPLICATION.slug);
    await dialog.getByRole("button", { name: "Create application" }).click();

    await expect(dialog.getByRole("alert")).toContainText(
      "Another application already uses this slug.",
    );
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL("/apps");
  });
});

test.describe("as the seeded MEMBER", () => {
  test.use({ storageState: SEED_MEMBER.storageStatePath });

  test("the list offers no way to create an application", async ({ page }) => {
    await page.goto("/apps");

    await expect(
      page.getByRole("heading", { level: 1, name: "Applications" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New application" }),
    ).toHaveCount(0);
  });

  test("an application's page shows its usage but no admin controls", async ({
    page,
  }) => {
    const seeded = await readSeedManifest();

    const response = await page.goto(`/apps/${seeded.applicationSlug}`);

    await expect(
      page.getByRole("heading", { level: 1, name: seeded.applicationName }),
    ).toBeVisible();

    // Usage is a read, so a member sees it.
    await expect(
      page.getByRole("heading", { level: 2, name: "Usage today" }),
    ).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: "Events" }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Edit details" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Delete application" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Danger zone" }),
    ).toHaveCount(0);

    // The bytes the server sent for the member's own session — not merely a
    // DOM that a client component could have edited.
    expect(
      response,
      "the application page returned no response",
    ).not.toBeNull();
    if (response === null) return;
    const html = await response.text();
    expect(html).not.toContain("Danger zone");
    expect(html).not.toContain("Edit details");
  });
});
