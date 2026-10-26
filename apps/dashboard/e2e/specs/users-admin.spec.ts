import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

import { SIGN_IN_PATH } from "@/lib/auth/return-path";

import { SEED_ADMIN, SEED_MEMBER } from "../support/fixtures";

/**
 * User management, end to end — and the denial tests that go with it.
 *
 * THE SEEDED ACCOUNTS ARE NEVER WRITTEN TO. Other specs run in parallel as
 * `e2e-admin` and `e2e-member`; demoting, deactivating or resetting either
 * would break them mid-run. Every mutation here therefore targets a FRESH
 * user this file creates through the product, with an address unique to the
 * test, and the seeded admin is only ever the one doing the acting.
 *
 * The fresh users also keep the sign-in throttle out of the way: its windows
 * are keyed on the address signing in, so their sign-ins never draw on the
 * seeded accounts' budget (see `sign-in.spec.ts`).
 */

/** An address nobody else in this run — or any earlier one — has used. */
function freshEmail(): string {
  return `e2e-user-${randomUUID()}@stuffs-logger.test`;
}

/** A base64url temporary password, exactly as the action generates it. */
const TEMPORARY_PASSWORD_PATTERN = /^[A-Za-z0-9_-]{24}$/;

/**
 * Adds a user through the admin dialog and returns the temporary password it
 * showed once.
 */
async function addUserThroughUi(
  page: Page,
  user: { name: string; email: string },
): Promise<string> {
  await page.goto("/users");
  await page.getByRole("button", { name: "Add user" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(user.name);
  await dialog.getByLabel("Email", { exact: true }).fill(user.email);
  await dialog.getByLabel("Role").selectOption("MEMBER");
  await dialog.getByRole("button", { name: "Add user" }).click();

  const password = dialog.getByText(TEMPORARY_PASSWORD_PATTERN);
  await expect(password).toBeVisible();
  const temporaryPassword = (await password.textContent())?.trim() ?? "";
  expect(temporaryPassword).toMatch(TEMPORARY_PASSWORD_PATTERN);

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);

  return temporaryPassword;
}

/** A page in a brand-new context holding no session at all. */
async function anonymousPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  return context.newPage();
}

/** Signs in through the real form and waits for the overview. */
async function signIn(page: Page, email: string, password: string) {
  await page.goto(SIGN_IN_PATH);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview" }),
  ).toBeVisible();
}

test.describe("as the seeded ADMIN", () => {
  test("a fresh user is added, signs in, changes their password, and is deactivated", async ({
    page,
    browser,
  }) => {
    const email = freshEmail();
    const temporaryPassword = await addUserThroughUi(page, {
      name: "E2E Fresh User",
      email,
    });

    // The new row is listed as an active member who signs in with a password.
    const row = page.getByRole("row", { name: new RegExp(email) });
    await expect(row).toContainText("Member");
    await expect(row).toContainText("Active");
    await expect(row).toContainText("Password");

    // The person signs in elsewhere, with the password they were sent.
    const theirPage = await anonymousPage(browser);
    await signIn(theirPage, email, temporaryPassword);

    // ...and replaces it on their account page.
    const chosenPassword = `chosen-${randomUUID()}`;
    await theirPage.goto("/account");
    await theirPage.getByLabel("Current password").fill(temporaryPassword);
    await theirPage
      .getByLabel("New password", { exact: true })
      .fill(chosenPassword);
    await theirPage.getByLabel("Confirm new password").fill(chosenPassword);
    await theirPage.getByRole("button", { name: "Change password" }).click();
    await expect(theirPage.getByRole("main").getByRole("status")).toContainText(
      "Password changed",
    );

    // Still signed in: the change re-issued THIS browser's session cookie.
    await theirPage.goto("/logs");
    await expect(
      theirPage.getByRole("heading", { level: 1, name: "Log explorer" }),
    ).toBeVisible();

    // The administrator deactivates them, behind a typed confirmation.
    await page.reload();
    await page.getByRole("button", { name: `Deactivate ${email}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/type the user.s email address/i).fill(email);
    await dialog.getByRole("button", { name: "Deactivate" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText("Deactivated");

    // THE PART THAT MATTERS: their live session stops working at once.
    await theirPage.goto("/logs");
    await expect(theirPage).toHaveURL(`${SIGN_IN_PATH}?returnTo=%2Flogs`);
    await expect(theirPage.getByRole("table")).toHaveCount(0);

    await theirPage.context().close();
  });

  test("a confirmation that does not match deactivates nobody", async ({
    page,
  }) => {
    const email = freshEmail();
    await addUserThroughUi(page, { name: "E2E Unconfirmed", email });

    await page.getByRole("button", { name: `Deactivate ${email}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel(/type the user.s email address/i)
      .fill(`not-${email}`);
    await dialog.getByRole("button", { name: "Deactivate" }).click();

    await expect(dialog.getByRole("alert")).toContainText(
      "Type the user's email address exactly.",
    );
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("row", { name: new RegExp(email) }),
    ).toContainText("Active");
  });

  test("a duplicate address is refused on the email field", async ({
    page,
  }) => {
    await page.goto("/users");
    await page.getByRole("button", { name: "Add user" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Duplicate");
    // The seeded admin's own address, in a different case. Only READ here:
    // the action refuses before writing anything.
    await dialog
      .getByLabel("Email", { exact: true })
      .fill(SEED_ADMIN.email.toUpperCase());
    await dialog.getByRole("button", { name: "Add user" }).click();

    await expect(
      dialog.getByText("A user with this email address already exists."),
    ).toBeVisible();
  });

  test("their own row offers no admin actions", async ({ page }) => {
    await page.goto("/users");

    const ownRow = page.getByRole("row", {
      name: new RegExp(SEED_ADMIN.email),
    });
    await expect(ownRow).toContainText("You");
    await expect(ownRow.getByRole("button")).toHaveCount(0);
  });

  test("the administration links are offered", async ({ page }) => {
    await page.goto("/");

    const adminNav = page.getByRole("navigation", { name: "Administration" });
    await expect(adminNav.getByRole("link", { name: "Users" })).toBeVisible();
    await expect(
      adminNav.getByRole("link", { name: "API tokens" }),
    ).toBeVisible();
  });
});

test.describe("as the seeded MEMBER", () => {
  test.use({ storageState: SEED_MEMBER.storageStatePath });

  test("the users page is refused, and lists nobody", async ({ page }) => {
    await page.goto("/users");

    await expect(
      page.getByRole("heading", { name: "Administrators only" }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByText(SEED_ADMIN.email)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add user" })).toHaveCount(0);
  });

  test("no administration links are offered", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: "Overview" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Administration" }),
    ).toHaveCount(0);
  });
});
