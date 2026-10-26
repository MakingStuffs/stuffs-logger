import { expect, test } from "@playwright/test";

import { buildLogsHref } from "@/components/logs/search-params";
import { SIGN_IN_PATH } from "@/lib/auth/return-path";

import {
  SEED_ADMIN,
  SEED_MEMBER,
  SEED_MESSAGE_MARKER,
} from "../support/fixtures";
import { readSeedManifest } from "../support/manifest";

/**
 * The sign-in journey, and the three refusals that go with it.
 *
 * THE ONLY FILE IN THE SUITE THAT DRIVES THE SIGN-IN FORM. Every other spec
 * starts from the storage state the `auth` setup project saved, for a reason
 * that is a hard constraint rather than a preference: `sign-in-throttle.ts`
 * allows ten password attempts per ADDRESS per fifteen minutes, and a suite
 * that signed in per test would throttle itself into red. The budget spent
 * here is deliberately small and split across the two accounts, so neither
 * comes near the ceiling even when CI retries every test twice:
 *
 *   ADMIN   1 (the auth setup) + 1 success + 1 deliberate failure = 3
 *   MEMBER  1 (the auth setup) + 1 success                        = 2
 *
 * That is also why the member's success is tested THROUGH the return-path
 * journey rather than as a second bare sign-in: one submission proves two
 * things, and it is the journey a real visitor takes — follow a link, get
 * bounced to sign in, arrive where you were going.
 *
 * NO STORED SESSION IN THIS FILE, and the form below is the one that actually
 * clears it. `test.use({ storageState: undefined })` does NOT: an `undefined`
 * option override reads as "not overridden" and falls back to the chromium
 * project's ADMIN state, which would make every assertion here pass for the
 * wrong reason. Verified against the installed Playwright 1.62.1.
 */
test.use({ storageState: { cookies: [], origins: [] } });

/** A password of the right shape belonging to nobody. */
const WRONG_PASSWORD = "not-the-seeded-password-0000";

/** The copy shown for every credential failure, whatever the cause. */
const CREDENTIALS_ERROR = "That email address and password did not match.";

/** Redirect statuses `redirect()` may answer a document request with. */
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

test("an administrator signs in and lands on the overview", async ({
  page,
}) => {
  await page.goto(SIGN_IN_PATH);

  await page.getByLabel("Email address").fill(SEED_ADMIN.email);
  await page.getByLabel("Password").fill(SEED_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // The heading as well as the URL: several failure modes also end on a URL
  // without `/sign-in` in it, so only the rendered overview tells "signed in"
  // apart from "bounced".
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview" }),
  ).toBeVisible();
});

test("a member is sent to sign in and lands back on the view they asked for", async ({
  page,
}) => {
  // A FILTERED explorer URL rather than a bare path, because the query string
  // is the part of a return path that is easy to lose: it is percent-encoded
  // into a parameter of the sign-in URL, then decoded, sanitised and written
  // back into a hidden field before it is ever redirected to.
  const destination = buildLogsHref({ search: SEED_MESSAGE_MARKER });

  await page.goto(destination);

  // Refused, not merely redirected — no log data may render on the way past.
  await expect(page).toHaveURL(
    `${SIGN_IN_PATH}?returnTo=${encodeURIComponent(destination)}`,
  );
  await expect(page.getByRole("table")).toHaveCount(0);

  await page.getByLabel("Email address").fill(SEED_MEMBER.email);
  await page.getByLabel("Password").fill(SEED_MEMBER.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(destination);
  await expect(
    page.getByRole("heading", { level: 1, name: "Log explorer" }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
});

test("the wrong password is refused, and leaves no session behind", async ({
  page,
}) => {
  await page.goto(SIGN_IN_PATH);

  await page.getByLabel("Email address").fill(SEED_ADMIN.email);
  await page.getByLabel("Password").fill(WRONG_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/sign-in\?.*error=credentials/);
  // Scoped to `main`: Next renders its own route announcer as a page-level
  // `role="alert"`, so an unscoped alert locator matches two elements.
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    CREDENTIALS_ERROR,
  );

  // THE PART THAT MATTERS. A visible error is not proof that nothing was
  // issued: the refusal is only real if the browser still holds no session,
  // so the next request for gated data has to be turned away as well.
  await page.goto("/logs");
  await expect(page).toHaveURL(`${SIGN_IN_PATH}?returnTo=%2Flogs`);
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("an anonymous visitor is refused an application's page", async ({
  page,
}) => {
  const seeded = await readSeedManifest();
  const destination = `/apps/${seeded.applicationSlug}`;

  // UNFOLLOWED, deliberately. `page.goto` would report the sign-in page it
  // ended on, which cannot distinguish "the server refused" from "the page
  // rendered and something redirected afterwards". Stopping at the first
  // response asserts the gate itself: the application page is never served.
  const refusal = await page.request.get(destination, { maxRedirects: 0 });

  expect(REDIRECT_STATUSES).toContain(refusal.status());
  // `toContain` rather than `toBe`: the framework is free to answer with an
  // absolute location, and which of the two it picks is not what is under
  // test — where it points is.
  expect(refusal.headers()["location"]).toContain(
    `${SIGN_IN_PATH}?returnTo=${encodeURIComponent(destination)}`,
  );

  // And the refusal carries nothing: neither the application's name nor, above
  // all, the live ingest credential its page would have shown an admin.
  const body = await refusal.text();
  expect(body).not.toContain(seeded.publicKey);
  expect(body).not.toContain(seeded.applicationName);

  // The visitor themselves lands on a usable sign-in form.
  await page.goto(destination);
  await expect(
    page.getByRole("heading", { level: 1, name: "Sign in" }),
  ).toBeVisible();
});
