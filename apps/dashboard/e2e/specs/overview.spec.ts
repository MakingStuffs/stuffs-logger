import { ERROR_LEVELS } from "@stuffs-logger/core";
import { expect, test } from "@playwright/test";

import { applicationLogsHref } from "@/components/logs/search-params";
import { OVERVIEW_WINDOW_HOURS } from "@/components/overview/activity";

import {
  SEED_APPLICATION,
  SEED_EVENT_COUNT,
  seedLevelCounts,
} from "../support/fixtures";

/**
 * The overview: does the landing page actually report the seeded traffic?
 *
 * READ-ONLY, and written to stay true while other specs run beside it. The
 * seeder places the whole corpus inside the overview's 24-hour window on
 * purpose, so every seeded event is counted here — but the round-trip spec
 * ingests one more event into the same application, so every count assertion
 * below is a FLOOR rather than an equality. Asserting `=== 120` would be a
 * test that fails depending on which worker finished first.
 */

/** Seeded events the overview counts as failures. */
const SEEDED_ERROR_COUNT =
  (seedLevelCounts().ERROR ?? 0) + (seedLevelCounts().FATAL ?? 0);

/**
 * Reads the two totals out of the overview's summary line.
 *
 * The counts are rendered with thousands separators, and separately from any
 * element that could carry them as an attribute, so this is the honest way to
 * get at the numbers rather than at the sentence.
 *
 * @param summary - The summary line's text.
 * @returns The two figures, or `null` when the sentence has changed shape.
 */
function parseTotals(
  summary: string,
): { events: number; errors: number } | null {
  const match =
    /^([\d,]+) events? received in the last \d+ hours, ([\d,]+) of them at error or fatal\.$/.exec(
      summary.trim(),
    );
  if (match === null) return null;

  const [, events, errors] = match;
  if (events === undefined || errors === undefined) return null;

  return {
    events: Number(events.replaceAll(",", "")),
    errors: Number(errors.replaceAll(",", "")),
  };
}

test("the seeded application's activity is reported on the overview", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Overview" }),
  ).toBeVisible();

  // Scoped to `main`: the overview streams its grid through Suspense, and
  // React leaves a second copy of the streamed markup in a hidden staging
  // container attached to `<body>`. Role locators never see it — a `hidden`
  // subtree is out of the accessibility tree — but text locators do.
  const summary = page
    .getByRole("main")
    .getByText(
      new RegExp(`events received in the last ${OVERVIEW_WINDOW_HOURS} hours`),
    );
  await expect(summary).toBeVisible();

  // `expect.poll` rather than a single read, because the grid is streamed into
  // the page through Suspense and the counts arrive after the shell. It
  // retries like a web-first assertion and, unlike a sleep, stops the moment
  // the condition holds. `-1` for an unparseable sentence, so a change to the
  // copy fails the count assertion rather than silently passing it.
  await expect
    .poll(async () => parseTotals(await summary.innerText())?.events ?? -1)
    .toBeGreaterThanOrEqual(SEED_EVENT_COUNT);
  await expect
    .poll(async () => parseTotals(await summary.innerText())?.errors ?? -1)
    .toBeGreaterThanOrEqual(SEEDED_ERROR_COUNT);

  // The card itself. Scoped to `main` so the sidebar's own list of sections
  // cannot satisfy a listitem locator.
  const card = page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ hasText: SEED_APPLICATION.slug });

  await expect(card).toBeVisible();
  await expect(card).toContainText(SEED_APPLICATION.name);
  await expect(card).toContainText("Events");
  await expect(card).toContainText("Errors");
  await expect(card).toContainText("Error rate");

  // Both jumping-off points land in the explorer already filtered, which is
  // the whole point of the card. The errors link is rendered only when the
  // application has errors at all, so its presence is itself a claim about
  // the counts above.
  await expect(
    card.getByRole("link", {
      name: `View logs for ${SEED_APPLICATION.name}`,
    }),
  ).toHaveAttribute("href", applicationLogsHref(SEED_APPLICATION.slug));
  await expect(
    card.getByRole("link", {
      name: `View errors for ${SEED_APPLICATION.name}`,
    }),
  ).toHaveAttribute(
    "href",
    applicationLogsHref(SEED_APPLICATION.slug, ERROR_LEVELS),
  );
});
