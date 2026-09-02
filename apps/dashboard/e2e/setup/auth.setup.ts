import { expect, test as setup } from "@playwright/test";

import { SEED_USERS } from "../support/fixtures";

/**
 * Signs in through the REAL form, once per role, and saves the cookies.
 *
 * No `SKIP_AUTH` anywhere in this path. The mock-admin bypass would make the
 * whole suite prove nothing about authentication — and `getSession` returns
 * the mock to every visitor when it is on, so a suite that used it could not
 * tell an admin from a member either.
 *
 * The result is a Playwright storage state per role. Every other project
 * starts already signed in, which is not merely faster: the sign-in throttle
 * allows ten attempts per address per fifteen minutes, so a suite that drove
 * this form once per test would throttle itself into failure.
 */

for (const user of SEED_USERS) {
  setup(`authenticate as the seeded ${user.role}`, async ({ page }) => {
    await page.goto("/sign-in");

    // Located the way a person or a screen reader would find them. The form is
    // deliberately zero-JavaScript (see `src/app/sign-in/page.tsx`), so this
    // is a plain submission with no hydration to wait for.
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The hidden return path defaults to `/`, so a successful sign-in lands on
    // the overview. Asserting on the heading as well as the URL is what
    // distinguishes "signed in" from "bounced back to the form", which also
    // ends on a URL without `/sign-in` in some failure modes.
    await expect(
      page.getByRole("heading", { level: 1, name: "Overview" }),
    ).toBeVisible();

    await page.context().storageState({ path: user.storageStatePath });
  });
}
