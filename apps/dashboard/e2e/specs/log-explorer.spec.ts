import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { formatCount } from "@/components/logs/format";
import { buildLogsHref } from "@/components/logs/search-params";
import { DEFAULT_PAGE_SIZE } from "@/lib/logs/filters";

import { content } from "../support/content";
import {
  buildSeedLogEvents,
  SEED_APPLICATION,
  SEED_EVENT_COUNT,
  SEED_MESSAGE_MARKER,
} from "../support/fixtures";

/**
 * The log explorer: the table, every filter that narrows it, and the paging
 * that walks it.
 *
 * READ-ONLY. Nothing here writes, so every test is safe beside every other —
 * but the corpus is SHARED, and the round-trip spec ingests an event of its
 * own into the same application while these run. That is why every test starts
 * from `?search=e2e-seed`: the marker matches the whole seeded corpus and
 * nothing else, so counts are exact and stable no matter what else the suite
 * is doing. Asserting on an unfiltered stream would be asserting on a moving
 * target.
 *
 * EVERY ASSERTION NAMES SOMETHING PRESENT AND SOMETHING ABSENT. A filter that
 * returned the whole corpus would satisfy "the rows I expected are there", so
 * on its own that proves nothing about filtering.
 */

/**
 * The seeded corpus, rebuilt from the seeder's own builder.
 *
 * The builder is pure — it takes an instant and an id and returns rows — so
 * calling it here costs nothing and means the expected messages and counts are
 * DERIVED from what the seeder writes rather than restated beside it. The
 * arguments are irrelevant: only the messages and the environment split are
 * read, and neither depends on either.
 */
const SEED_ROWS = buildSeedLogEvents({
  applicationId: "not-read-by-this-spec",
  now: new Date(0),
});

/** How many seeded events carry `staging`, as the seeder actually splits them. */
const STAGING_COUNT = SEED_ROWS.filter(
  (row) => row.environment === "staging",
).length;

/** How many seeded events are `fatal`. */
const FATAL_COUNT = SEED_ROWS.filter((row) => row.level === "FATAL").length;

/**
 * The message the seeder writes at a given position in the corpus.
 *
 * @param index - Position, newest first, from `0` to `SEED_EVENT_COUNT - 1`.
 * @returns That event's message.
 * @throws {Error} When the index is outside the corpus.
 */
function seedMessage(index: number): string {
  const row = SEED_ROWS[index];
  if (row === undefined) {
    throw new Error(
      `No seeded event at index ${index}; the corpus is ${SEED_EVENT_COUNT} events.`,
    );
  }

  return row.message;
}

/** The row carrying one seeded event, addressed by the text a reader sees. */
function seedRow(page: Page, index: number): Locator {
  // The messages contain `#` and spaces but no regular-expression
  // metacharacters, and every one of the 120 is unique.
  return page.getByRole("row", { name: new RegExp(seedMessage(index)) });
}

/** The explorer, already narrowed to the seeded corpus. */
const SEEDED_VIEW = buildLogsHref({ search: SEED_MESSAGE_MARKER });

test("the seeded corpus renders in the table", async ({ page }) => {
  await page.goto(SEEDED_VIEW);

  await expect(
    page.getByRole("heading", { level: 1, name: "Log explorer" }),
  ).toBeVisible();

  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  for (const column of [
    "Time (UTC)",
    "Level",
    "Application",
    "Environment",
    "Message",
  ]) {
    await expect(
      table.getByRole("columnheader", { name: column }),
    ).toBeVisible();
  }

  // The newest seeded event is the first row, because the stream is ordered
  // newest first and the seeder builds it that way.
  const newest = seedRow(page, 0);
  await expect(newest).toBeVisible();
  await expect(newest).toContainText(SEED_APPLICATION.name);
  await expect(newest).toContainText("production");
  await expect(newest).toContainText("Info");

  // A full page, and the corpus is larger than one — so paging exists.
  await expect(
    content(page).getByText(
      `Showing ${formatCount(DEFAULT_PAGE_SIZE)} events.`,
    ),
  ).toBeVisible();
});

test("filtering by level narrows the stream", async ({ page }) => {
  await page.goto(SEEDED_VIEW);

  // Driven through the panel rather than by hand-writing a URL: the chips are
  // visually-hidden checkboxes behind visible labels, so clicking the label is
  // both what a person does and the only thing that works — the input itself
  // is 1px behind its own chip and never receives the click.
  await page
    .getByRole("group", { name: "Level" })
    .getByText("Fatal", { exact: true })
    .click();
  await page.getByRole("button", { name: "Apply filters" }).click();

  // The filter is URL state, which is what makes the view shareable.
  await expect(page).toHaveURL(/level=fatal/);
  await expect(page).toHaveURL(/search=e2e-seed/);

  // Present: a fatal event. Absent: the info event that led the unfiltered
  // page a moment ago.
  await expect(seedRow(page, 7)).toBeVisible();
  await expect(seedRow(page, 0)).toHaveCount(0);
  await expect(
    content(page).getByText(`Showing all ${formatCount(FATAL_COUNT)} events.`),
  ).toBeVisible();

  // The applied filter is echoed back into the panel, so a shared link opens
  // with the controls in the state that produced it.
  await expect(page.getByRole("checkbox", { name: "Fatal" })).toBeChecked();
});

test("filtering by environment narrows the stream", async ({ page }) => {
  await page.goto(SEEDED_VIEW);

  // The environment facet lives behind "More filters", which is collapsed
  // until one of the filters inside it is applied.
  await content(page).getByText("More filters").click();
  await page
    .getByRole("group", { name: "Environment" })
    .getByText("staging", { exact: true })
    .click();
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page).toHaveURL(/environment=staging/);

  // Index 3 is the first staging event; index 0 is production.
  await expect(seedRow(page, 3)).toBeVisible();
  await expect(seedRow(page, 0)).toHaveCount(0);
  await expect(
    content(page).getByText(
      `Showing all ${formatCount(STAGING_COUNT)} events.`,
    ),
  ).toBeVisible();
});

test("filtering by free text narrows the stream to one event", async ({
  page,
}) => {
  await page.goto(SEEDED_VIEW);

  const target = seedMessage(2);
  await page.getByLabel("Message contains").fill(target);
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(seedRow(page, 2)).toBeVisible();
  await expect(seedRow(page, 0)).toHaveCount(0);
  await expect(content(page).getByText("Showing all 1 event.")).toBeVisible();
});

test("scoping to an application narrows the stream to that application", async ({
  page,
}) => {
  await page.goto(SEEDED_VIEW);

  await page
    .getByLabel("Application")
    .selectOption({ label: SEED_APPLICATION.name });
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page).toHaveURL(
    new RegExp(`applicationSlug=${SEED_APPLICATION.slug}`),
  );
  await expect(seedRow(page, 0)).toBeVisible();

  // The other half of the claim, which the single seeded application cannot
  // show on its own: scoped to an application that has logged nothing, the
  // same corpus disappears entirely.
  await page.goto(
    buildLogsHref({
      search: SEED_MESSAGE_MARKER,
      applicationSlug: "no-such-application",
    }),
  );
  await expect(seedRow(page, 0)).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("a quick time range narrows the stream to recent events", async ({
  page,
}) => {
  await page.goto(SEEDED_VIEW);

  // The corpus steps back 90 seconds per event, so it spans just under three
  // hours: the newest event is inside the last hour and the oldest is well
  // outside it, whenever within the run this happens to execute.
  await page.getByRole("link", { name: "Last hour" }).click();

  await expect(page).toHaveURL(/from=/);
  await expect(content(page).getByText(/^Showing events from /)).toBeVisible();

  await expect(seedRow(page, 0)).toBeVisible();
  await expect(seedRow(page, SEED_EVENT_COUNT - 1)).toHaveCount(0);

  // And the range is cleared again by the link that says so: the bound leaves
  // the URL, the applied-range line goes with it, and the stream is a full
  // page again rather than the hour's worth it had been cut to.
  await page.getByRole("link", { name: "All time" }).click();
  await expect(page).not.toHaveURL(/from=/);
  await expect(content(page).getByText(/^Showing events from /)).toHaveCount(0);
  await expect(
    content(page).getByText(
      `Showing ${formatCount(DEFAULT_PAGE_SIZE)} events.`,
    ),
  ).toBeVisible();
  await expect(seedRow(page, 0)).toBeVisible();
});

test("paging walks the corpus, and the URL carries the position", async ({
  page,
}) => {
  await page.goto(SEEDED_VIEW);

  // Page one: the newest events, and nothing from further down the stream.
  await expect(seedRow(page, 0)).toBeVisible();
  await expect(seedRow(page, DEFAULT_PAGE_SIZE - 1)).toBeVisible();
  await expect(seedRow(page, DEFAULT_PAGE_SIZE)).toHaveCount(0);

  await page.getByRole("link", { name: "Go to next page" }).click();

  // Paging is a cursor in the URL, so the second page is a link a colleague
  // can be sent — not a scroll position held in a component.
  await expect(page).toHaveURL(/cursor=/);
  await expect(page).toHaveURL(/search=e2e-seed/);
  await expect(seedRow(page, DEFAULT_PAGE_SIZE)).toBeVisible();
  await expect(seedRow(page, DEFAULT_PAGE_SIZE * 2 - 1)).toBeVisible();
  await expect(seedRow(page, 0)).toHaveCount(0);
  await expect(seedRow(page, DEFAULT_PAGE_SIZE * 2)).toHaveCount(0);
  await expect(
    content(page).getByText(
      `Showing ${formatCount(DEFAULT_PAGE_SIZE)} events on this page.`,
    ),
  ).toBeVisible();

  // The last page is short, and offers no next.
  await page.getByRole("link", { name: "Go to next page" }).click();
  await expect(seedRow(page, SEED_EVENT_COUNT - 1)).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to next page" })).toHaveCount(
    0,
  );

  // And the way back to the top keeps the filter but drops the cursor.
  await page.getByRole("link", { name: "Newest" }).click();
  await expect(page).toHaveURL(SEEDED_VIEW);
  await expect(seedRow(page, 0)).toBeVisible();
});

test("a filter that matches nothing shows the empty state, not a broken table", async ({
  page,
}) => {
  // Unique to this test run, so it cannot start matching because something
  // else in the suite ingested an event.
  await page.goto(buildLogsHref({ search: `no-such-message-${randomUUID()}` }));

  await expect(
    page.getByRole("heading", { name: "No events match these filters" }),
  ).toBeVisible();
  await expect(content(page).getByText(/Widen the time range/)).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});
