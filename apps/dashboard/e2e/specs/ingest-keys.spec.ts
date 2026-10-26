import { randomUUID } from "node:crypto";

import { SECRET_KEY_PREFIX } from "@stuffs-logger/core";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  SEED_MEMBER,
  SEED_PUBLIC_KEY_NAME,
  SEED_SECRET_KEY_NAME,
} from "../support/fixtures";
import { readSeedManifest } from "../support/manifest";

/**
 * Ingest-key management: minting one, revoking one, and being refused both.
 *
 * THE MUTATING SPECS IN THIS SUITE, and the reason each of them mints its own
 * key rather than reusing a seeded one. The run is `fullyParallel`, the seeded
 * corpus is shared, and a revocation is irreversible — so a spec that revoked
 * `E2E secret key` would silently break whatever else was reading it, and a
 * spec that asserted on a key another spec created would be a spec whose
 * result depended on scheduling. Every key here is named with a
 * `randomUUID()`, which is also what makes the row locators unambiguous.
 *
 * Nothing is cleaned up afterwards, deliberately: the seeder REPLACES the
 * application's whole key set on every run (see `support/seed.ts`), so keys
 * left behind cost nothing and deleting them here would be a second write
 * racing the first.
 */

/** The heading the refusal renders in the keys section's place. */
const REFUSAL_HEADING = "Administrators only";

/** A key name no other spec, and no other run, can collide with. */
function uniqueKeyName(purpose: string): string {
  return `e2e ${purpose} ${randomUUID()}`;
}

/**
 * Mints a server key through the real dialog and returns its plaintext.
 *
 * A SERVER key rather than a browser one, because it is the case where "shown
 * once" is load-bearing: only a hash of its secret is stored, so the value
 * this returns genuinely cannot be recovered from anywhere else.
 *
 * @param page - A page already on the application's own route.
 * @param name - The key's label. Must be unique to the calling test.
 * @returns The key's plaintext, exactly as the dialog showed it.
 */
async function createServerKey(page: Page, name: string): Promise<string> {
  await page.getByRole("button", { name: "Create key" }).click();

  // Every locator below is scoped to the dialog. The trigger that opened it is
  // also named "Create key", and so is the form's submit button.
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Create an ingest key" }),
  ).toBeVisible();

  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByRole("radio", { name: /Server key/ }).check();
  await dialog.getByRole("button", { name: "Create key" }).click();

  await expect(
    dialog.getByRole("heading", { name: "Key created" }),
  ).toBeVisible();

  const plaintext = dialog.getByText(new RegExp(`^${SECRET_KEY_PREFIX}`));
  await expect(plaintext).toBeVisible();

  return (await plaintext.innerText()).trim();
}

test.describe("as the seeded ADMIN", () => {
  // No `test.use`: the chromium project's default storage state is the admin.

  test("a new key's plaintext is shown once, and never again", async ({
    page,
  }) => {
    const seeded = await readSeedManifest();
    const keyName = uniqueKeyName("mint");

    await page.goto(`/apps/${seeded.applicationSlug}`);
    await expect(
      page.getByRole("heading", { level: 2, name: "Ingest keys" }),
    ).toBeVisible();

    const dialog = page.getByRole("dialog");
    const plaintext = await createServerKey(page, keyName);

    // The value is a real secret key, not a placeholder or an id.
    expect(plaintext.startsWith(SECRET_KEY_PREFIX)).toBe(true);
    expect(plaintext.length).toBeGreaterThan(SECRET_KEY_PREFIX.length);

    // And the dialog says plainly that this is the only time it will be shown.
    await expect(dialog.getByRole("alert")).toContainText(
      "cannot be shown again",
    );

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);

    // ONCE, AND ONLY ONCE. The key is now listed, but the value the dialog
    // showed is gone from the page — for a server key only a hash was stored,
    // so there is nothing left to render.
    const row = page.getByRole("row", { name: new RegExp(keyName) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Server");
    await expect(row).toContainText("Shown once at creation");
    await expect(row).toContainText("Active");
    await expect(page.getByText(plaintext)).toHaveCount(0);

    // A reload is the same page from scratch — the value is not merely hidden
    // by a client component that unmounted.
    await page.reload();
    await expect(
      page.getByRole("row", { name: new RegExp(keyName) }),
    ).toBeVisible();
    await expect(page.getByText(plaintext)).toHaveCount(0);
  });

  test("a key is revoked through its confirmation dialog", async ({ page }) => {
    const seeded = await readSeedManifest();
    // Its OWN key, minted in this test: revoking a seeded one would stop
    // whatever else is using it mid-run, and revocation cannot be undone.
    const keyName = uniqueKeyName("revoke");

    await page.goto(`/apps/${seeded.applicationSlug}`);
    await expect(
      page.getByRole("heading", { level: 2, name: "Ingest keys" }),
    ).toBeVisible();

    await createServerKey(page, keyName);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Done" })
      .click();

    const row = page.getByRole("row", { name: new RegExp(keyName) });
    await expect(row).toContainText("Active");

    await row.getByRole("button", { name: `Revoke ${keyName}` }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Revoke this key?" }),
    ).toBeVisible();

    // The typed confirmation is an INTENT check: a valid session already
    // satisfies every framework-level protection, so retyping the name is the
    // only thing that distinguishes a person reading the row from a script
    // running under their cookie. A wrong value must be refused.
    //
    // Nothing outside the dialog is asserted on while it is open: it is a
    // modal, so Radix marks the rest of the document `aria-hidden`, and a
    // role-based locator correctly refuses to see anything in there. The
    // dialog staying open IS the refusal — it closes itself on success.
    await dialog
      .getByLabel(/type the key.s name to confirm/i)
      .fill(`${keyName} but wrong`);
    await dialog.getByRole("button", { name: "Revoke key" }).click();

    await expect(dialog.getByRole("alert")).toContainText(
      "Type the key's name exactly.",
    );
    await expect(dialog).toBeVisible();

    // The real confirmation.
    await dialog.getByLabel(/type the key.s name to confirm/i).fill(keyName);
    await dialog.getByRole("button", { name: "Revoke key" }).click();

    // The dialog closes itself once the page has revalidated, so its absence
    // is the signal that the write landed rather than a race with it.
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText("Revoked");
    await expect(
      row.getByRole("button", { name: `Revoke ${keyName}` }),
    ).toHaveCount(0);

    // Still true on a fresh render of the page: the revocation was persisted,
    // not just reflected in the component that submitted it.
    await page.reload();
    const revoked = page.getByRole("row", { name: new RegExp(keyName) });
    await expect(revoked).toContainText("Revoked");
    await expect(
      revoked.getByRole("button", { name: `Revoke ${keyName}` }),
    ).toHaveCount(0);
  });
});

test.describe("as the seeded MEMBER", () => {
  test.use({ storageState: SEED_MEMBER.storageStatePath });

  test("key management is refused, not merely hidden", async ({ page }) => {
    const seeded = await readSeedManifest();

    // The navigation's own response is kept, because the bytes it carries are
    // the strongest assertion available here — see the end of this test.
    const response = await page.goto(`/apps/${seeded.applicationSlug}`);

    // The page itself is not refused — any live account reads applications.
    await expect(
      page.getByRole("heading", { level: 1, name: seeded.applicationName }),
    ).toBeVisible();

    // The keys section is replaced by a designed refusal that names the rule,
    // rather than by an error page or by nothing at all.
    await expect(
      page.getByRole("heading", { name: REFUSAL_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Ingest keys" }),
    ).toHaveCount(0);

    // No control for either mutation. This is the WEAKEST of the assertions
    // here, and on its own it would only prove something was hidden.
    await expect(page.getByRole("button", { name: "Create key" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /^Revoke / })).toHaveCount(0);

    // THE ONE THAT MAKES THIS AN AUTHORIZATION TEST rather than a test that
    // something was hidden. Everything above reads the DOM, which a client
    // component could in principle have edited; this reads the bytes the
    // server actually sent for this member's own session. The credentials —
    // and even the labels, which would reveal how many exist — never left it.
    //
    // The NAVIGATION's response, not a fresh `page.request.get`: an
    // `APIRequestContext` request does not carry the context's session cookie
    // here, so it would be answered with the sign-in page and the assertions
    // below would pass without ever exercising the member's session.
    expect(
      response,
      "the application page returned no response",
    ).not.toBeNull();
    if (response === null) return;

    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).not.toContain(seeded.publicKey);
    expect(html).not.toContain(seeded.secretKey);
    expect(html).not.toContain(SEED_PUBLIC_KEY_NAME);
    expect(html).not.toContain(SEED_SECRET_KEY_NAME);
    expect(html).toContain(REFUSAL_HEADING);
  });
});
