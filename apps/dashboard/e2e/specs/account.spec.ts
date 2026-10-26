import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

import { SIGN_IN_PATH } from "@/lib/auth/return-path";

import { SEED_ADMIN, SEED_MEMBER } from "../support/fixtures";

/**
 * The personal account page.
 *
 * Read-only for the seeded accounts — other specs run in parallel as them, so
 * nothing here submits a form while signed in as `e2e-admin` or
 * `e2e-member`. Every write happens to a FRESH user the seeded admin adds
 * through `/users` first.
 */

const TEMPORARY_PASSWORD_PATTERN = /^[A-Za-z0-9_-]{24}$/;

/** Adds a fresh member through the admin dialog; returns their credentials. */
async function addFreshUser(
  adminPage: Page,
): Promise<{ email: string; password: string }> {
  const email = `e2e-account-${randomUUID()}@stuffs-logger.test`;

  await adminPage.goto("/users");
  await adminPage.getByRole("button", { name: "Add user" }).click();
  const dialog = adminPage.getByRole("dialog");
  await dialog.getByLabel("Name").fill("E2E Account User");
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByRole("button", { name: "Add user" }).click();

  const shown = dialog.getByText(TEMPORARY_PASSWORD_PATTERN);
  await expect(shown).toBeVisible();
  const password = (await shown.textContent())?.trim() ?? "";
  await dialog.getByRole("button", { name: "Done" }).click();

  return { email, password };
}

/** Signs in through the real form, in a context of its own. */
async function signedInPage(
  browser: Browser,
  credentials: { email: string; password: string },
): Promise<Page> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();

  await page.goto(SIGN_IN_PATH);
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");

  return page;
}

test.describe("as the seeded ADMIN", () => {
  test("the account page shows who they are, linked from the rail", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Account" }).click();

    await expect(page).toHaveURL("/account");
    await expect(
      page.getByRole("heading", { level: 1, name: "Account" }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toContainText(SEED_ADMIN.email);
    await expect(page.getByRole("main")).toContainText("Administrator");
    await expect(page.getByLabel("Current password")).toBeVisible();
  });
});

test.describe("as the seeded MEMBER", () => {
  test.use({ storageState: SEED_MEMBER.storageStatePath });

  test("the account page is theirs too", async ({ page }) => {
    await page.goto("/account");

    await expect(page.getByRole("main")).toContainText(SEED_MEMBER.email);
    await expect(page.getByRole("main")).toContainText("Member");
  });
});

test.describe("a fresh user", () => {
  test("a wrong current password changes nothing and says so generically", async ({
    page,
    browser,
  }) => {
    const credentials = await addFreshUser(page);
    const theirPage = await signedInPage(browser, credentials);

    await theirPage.goto("/account");
    await theirPage
      .getByLabel("Current password")
      .fill("not-my-password-at-all");
    await theirPage
      .getByLabel("New password", { exact: true })
      .fill("a-new-password-123");
    await theirPage
      .getByLabel("Confirm new password")
      .fill("a-new-password-123");
    await theirPage.getByRole("button", { name: "Change password" }).click();

    await expect(theirPage.getByRole("main").getByRole("alert")).toContainText(
      "Your password was not changed.",
    );

    // The temporary password still works: nothing was changed.
    await theirPage.context().close();
    const again = await signedInPage(browser, credentials);
    await again.context().close();
  });

  test("signing out other sessions ends them and keeps this one", async ({
    page,
    browser,
  }) => {
    const credentials = await addFreshUser(page);
    const here = await signedInPage(browser, credentials);
    const elsewhere = await signedInPage(browser, credentials);

    await here.goto("/account");
    await here.getByRole("button", { name: "Sign out other sessions" }).click();
    await expect(here.getByRole("main").getByRole("status")).toContainText(
      "Every other session has been signed out.",
    );

    await elsewhere.goto("/logs");
    await expect(elsewhere).toHaveURL(`${SIGN_IN_PATH}?returnTo=%2Flogs`);

    await here.goto("/logs");
    await expect(
      here.getByRole("heading", { level: 1, name: "Log explorer" }),
    ).toBeVisible();

    await here.context().close();
    await elsewhere.context().close();
  });
});
