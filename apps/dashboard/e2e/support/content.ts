import type { Locator, Page } from "@playwright/test";

/**
 * The page's own content, excluding React's hidden streaming container.
 *
 * Once a streamed Suspense boundary has been moved into place, React leaves
 * its markup behind in a `<div hidden id="S:0">` attached to `<body>` — so a
 * page that streams its results holds TWO copies of every paragraph in it.
 * Role locators never see the second (a `hidden` subtree is out of the
 * accessibility tree) but text locators do, and would fail on strict mode
 * rather than on the thing under test. Every text assertion in a spec against
 * a streamed page is therefore scoped to `main`, which the staging container
 * sits outside of.
 *
 * @param page - The page under test.
 * @returns The `<main>` landmark.
 */
export function content(page: Page): Locator {
  return page.getByRole("main");
}
