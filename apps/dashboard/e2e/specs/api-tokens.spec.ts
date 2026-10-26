import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SEED_MEMBER } from "../support/fixtures";

/**
 * API-token management, proved end to end against the endpoint that consumes
 * the tokens.
 *
 * Each test mints its OWN token with a `randomUUID()` name: the run is
 * `fullyParallel`, a revocation is irreversible, and the retention route
 * throttles per token — so a shared token would make one spec's result depend
 * on another's scheduling.
 *
 * Calling `/api/cron/retention` for real is safe here. It deletes events
 * received more than 30 days ago, and the seeder stamps every seeded event's
 * `receivedAt` within the last three hours (see `support/fixtures.ts`), as is
 * anything a sibling spec ingests during the run.
 */

const TOKENS_PATH = "/tokens";
const RETENTION_PATH = "/api/cron/retention";
const TOKEN_PREFIX = "slg_api_";
const REFUSAL_HEADING = "Administrators only";

function uniqueTokenName(purpose: string): string {
  return `e2e token ${purpose} ${randomUUID()}`;
}

/**
 * Mints a token through the real dialog and returns its raw value.
 *
 * @param page - A page already on `/tokens`.
 * @param name - Unique to the calling test.
 * @returns The raw token exactly as the dialog showed it.
 */
async function createToken(page: Page, name: string): Promise<string> {
  await page.getByRole("button", { name: "Create token" }).click();

  // Scoped to the dialog: the trigger and the submit share a name.
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Create an API token" }),
  ).toBeVisible();

  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Create token" }).click();

  await expect(
    dialog.getByRole("heading", { name: "Token created" }),
  ).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(
    "Set this as CRON_SECRET for the retention job. It cannot be shown again.",
  );

  const raw = dialog.getByText(new RegExp(`^${TOKEN_PREFIX}`));
  await expect(raw).toBeVisible();

  return (await raw.innerText()).trim();
}

test.describe("as the seeded ADMIN", () => {
  test("a minted token is shown once, runs the retention job, and is refused once revoked", async ({
    page,
    request,
  }) => {
    const tokenName = uniqueTokenName("lifecycle");

    await page.goto(TOKENS_PATH);
    await expect(
      page.getByRole("heading", { level: 2, name: "API tokens", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "What uses these tokens" }),
    ).toContainText(RETENTION_PATH);

    const token = await createToken(page, tokenName);
    expect(token.length).toBeGreaterThan(TOKEN_PREFIX.length);

    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Done" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // ONCE: listed, but its value is gone — and still gone on a fresh render.
    const row = page.getByRole("row", { name: new RegExp(tokenName) });
    await expect(row).toContainText("Active");
    await expect(row).toContainText("Never");
    await expect(page.getByText(token)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(token)).toHaveCount(0);

    // The raw token is exactly what the retention job accepts.
    const accepted = await request.get(RETENTION_PATH, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(accepted.status()).toBe(200);
    const body: unknown = await accepted.json();
    expect(body).toMatchObject({ success: true });

    // The accepted call stamped it.
    await page.reload();
    await expect(
      page.getByRole("row", { name: new RegExp(tokenName) }),
    ).not.toContainText("Never");

    // Revoke through the typed confirmation.
    await page
      .getByRole("row", { name: new RegExp(tokenName) })
      .getByRole("button", { name: `Revoke ${tokenName}` })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Revoke this token?" }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      "answering 401 until CRON_SECRET is replaced",
    );

    await dialog
      .getByLabel(/type the token.s name to confirm/i)
      .fill(`${tokenName} but wrong`);
    await dialog.getByRole("button", { name: "Revoke token" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Type the token's name exactly.",
    );

    await dialog
      .getByLabel(/type the token.s name to confirm/i)
      .fill(tokenName);
    await dialog.getByRole("button", { name: "Revoke token" }).click();

    // The dialog closes itself after the write, so its absence is the signal.
    await expect(dialog).toHaveCount(0);
    const revoked = page.getByRole("row", { name: new RegExp(tokenName) });
    await expect(revoked).toContainText("Revoked");
    await expect(
      revoked.getByRole("button", { name: `Revoke ${tokenName}` }),
    ).toHaveCount(0);

    // 401, not 429: a revoked credential is refused before the throttle is
    // ever consulted.
    const refused = await request.get(RETENTION_PATH, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(refused.status()).toBe(401);
  });
});

test.describe("as the seeded MEMBER", () => {
  test.use({ storageState: SEED_MEMBER.storageStatePath });

  test("token management is refused, not merely hidden", async ({ page }) => {
    const response = await page.goto(TOKENS_PATH);

    await expect(
      page.getByRole("heading", { name: REFUSAL_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "API tokens", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create token" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Revoke / })).toHaveCount(0);

    // The bytes the server sent for this member's own session: no token
    // table and no token labels ever left it.
    expect(response, "the tokens page returned no response").not.toBeNull();
    if (response === null) return;

    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(REFUSAL_HEADING);
    expect(html).not.toContain("e2e token ");
    expect(html).not.toContain("What uses these tokens");
  });
});
