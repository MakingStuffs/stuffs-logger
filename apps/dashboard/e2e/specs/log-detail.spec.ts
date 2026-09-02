import { expect, test } from "@playwright/test";

import { buildLogsHref } from "@/components/logs/search-params";

import { content } from "../support/content";
import { buildSeedLogEvents, SEED_RELEASE } from "../support/fixtures";

/**
 * One event, in full — and the path a reader takes to get there.
 *
 * READ-ONLY, and pinned to a single seeded event so nothing here depends on
 * what else the suite is doing at the time.
 *
 * THE EVENT IS A FATAL ONE, for two reasons. It is a severity the seeder only
 * puts on error-bearing rows, so the stack trace, the error name and the error
 * message are all present — an `info` row would leave half this page
 * untested. And "Fatal" appears exactly once on the rendered page, whereas
 * "Error" would also match the heading of the error card, which would make the
 * severity assertion ambiguous rather than wrong.
 */

/** Position in the seeded corpus. Index 7 is the cycle's first `FATAL`. */
const TARGET_INDEX = 7;

/**
 * The seeded row this spec reads, rebuilt from the seeder's own pure builder
 * so every expected value is derived rather than restated beside it. The
 * arguments are irrelevant — nothing read below depends on either.
 */
const target = buildSeedLogEvents({
  applicationId: "not-read-by-this-spec",
  now: new Date(0),
})[TARGET_INDEX];

if (target === undefined) {
  throw new Error(`The seeded corpus has no event at index ${TARGET_INDEX}.`);
}

/**
 * Narrows a nullable seeded field to the string this spec asserts on.
 *
 * The row type allows `null` on every optional column, and a missing value
 * here means the seeded contract changed — which should fail as that sentence
 * rather than as a locator timing out on an empty string.
 *
 * @param value - The field's value on the seeded row.
 * @param field - The column's name, for the failure message.
 * @returns The value, as a string.
 * @throws {Error} When the seeded row does not carry it.
 */
function seededField(value: string | null | undefined, field: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `The seeded event at index ${TARGET_INDEX} carries no ${field}.`,
    );
  }

  return value;
}

/** The event's message. Unique across the corpus, so it identifies one row. */
const TARGET_MESSAGE = target.message;
const TARGET_ERROR_NAME = seededField(target.errorName, "errorName");
const TARGET_ERROR_MESSAGE = seededField(target.errorMessage, "errorMessage");

test("a row opens the event's own page, with everything the stream left out", async ({
  page,
}) => {
  // Narrowed to exactly this event, so the row and the panel it opens are
  // unambiguous however the suite happens to be scheduled.
  await page.goto(buildLogsHref({ search: TARGET_MESSAGE }));

  const row = page.getByRole("row", { name: new RegExp(TARGET_MESSAGE) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Fatal");

  // A row is a summary until it is opened; the link onward exists only inside
  // the panel it reveals.
  // The control renames itself as it opens — "Show details for…" becomes
  // "Hide details for…" — so the open state has to be read from the new name
  // rather than from the locator that found the closed one.
  await expect(
    row.getByRole("button", { name: /show details for/i }),
  ).toHaveAttribute("aria-expanded", "false");
  await row.getByRole("button", { name: /show details for/i }).click();
  await expect(
    row.getByRole("button", { name: /hide details for/i }),
  ).toHaveAttribute("aria-expanded", "true");

  await page
    .getByRole("link", { name: "View full event, including context" })
    .click();

  // The event's own route rather than a panel — a specific event is the thing
  // people paste into a ticket.
  await expect(page).toHaveURL(/\/logs\/[^/?]+$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Log event" }),
  ).toBeVisible();

  // The two things the stream already showed…
  await expect(
    content(page).getByText(TARGET_MESSAGE, { exact: true }),
  ).toBeVisible();
  await expect(content(page).getByText("Fatal", { exact: true })).toBeVisible();

  // …and the three it deliberately did not, each rendered as escaped text in
  // a labelled, scrollable region rather than as markup.
  await expect(
    content(page).getByRole("group", { name: "Event context, as JSON" }),
  ).toContainText(`"seedIndex": ${TARGET_INDEX}`);
  await expect(
    content(page).getByRole("group", { name: "Stack trace" }),
  ).toContainText(TARGET_ERROR_NAME);
  // `exact` matters: the stack trace opens with this same sentence, so a
  // substring match would find two elements and fail on strict mode rather
  // than on the thing under test.
  await expect(
    content(page).getByText(TARGET_ERROR_MESSAGE, { exact: true }),
  ).toBeVisible();

  // The attribution: which build it came from, and which runtime reported it.
  // These are what make a log line actionable rather than a string.
  await expect(
    content(page).getByText(SEED_RELEASE, { exact: true }),
  ).toBeVisible();
  await expect(
    content(page).getByText("Server", { exact: true }),
  ).toBeVisible();
  await expect(
    content(page).getByText("Manual", { exact: true }),
  ).toBeVisible();

  // And the way back to this application's own stream.
  await expect(page.getByRole("link", { name: "Back to logs" })).toBeVisible();
});
