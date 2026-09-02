import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { buildLogsHref } from "@/components/logs/search-params";

import { readSeedManifest } from "../support/manifest";
import type { StuffsLoggerStats } from "../support/sdk-global";

/**
 * SDK → ingest → dashboard. The test that proves the product works.
 *
 * Nothing here is stubbed. The real `<script>` build of `@stuffs-logger/sdk`
 * runs in a real browser, authenticates with a real seeded PUBLIC key, POSTs
 * to the real ingest endpoint, which writes to a real Postgres — and then the
 * event is found through the dashboard's own UI, signed in as a real seeded
 * user. Every seam the product is made of is crossed once.
 *
 * WHY THE `<script>` BUILD AND NOT THE NODE ENTRY POINT. Three reasons, and
 * the third is the one that decided it:
 *
 *  1. It is the artefact a consumer with no build step actually gets —
 *     `dist/stuffs-logger.global.js`, minified, IIFE, core inlined. Testing it
 *     tests what ships.
 *  2. A PUBLIC key is gated on nothing but its origin allowlist, so exercising
 *     it in a browser exercises the CORS and `Origin` path a server-side
 *     caller would skip entirely.
 *  3. It creates no compile-time dependency on the SDK's `dist`. Importing
 *     `@stuffs-logger/sdk/node` from a typechecked spec would make
 *     `pnpm typecheck` fail on a clean checkout until something had built the
 *     package first — a build-order trap for every future contributor. Loading
 *     the bundle as a FILE at run time keeps the dependency where it belongs.
 *
 * THE PAGE IS SERVED FROM THE DASHBOARD'S OWN ORIGIN, which is what makes the
 * seeded key's allowlist match: the SDK defaults its endpoint to
 * `window.location.origin`, and the browser attaches that origin to the POST.
 */

/** Where the built `<script>` bundle lives, relative to `apps/dashboard`. */
const GLOBAL_BUNDLE_PATH = resolve(
  process.cwd(),
  "../../packages/logger-sdk/dist/stuffs-logger.global.js",
);

/** The environment this spec's own events are tagged with. */
const ROUND_TRIP_ENVIRONMENT = "e2e-round-trip";

/** The release stamped on this spec's own events. */
const ROUND_TRIP_RELEASE = "e2e-round-trip-1.0.0";

/** What the in-page SDK run reports back. */
type RoundTripResult =
  | { readonly ok: true; readonly stats: StuffsLoggerStats }
  | { readonly ok: false; readonly reason: string };

test("an SDK batch reaches the dashboard", async ({ page }) => {
  const seeded = await readSeedManifest();

  // UNIQUE PER RUN, so the assertion below is about this batch and nothing
  // else. Parallel workers and leftover rows from an earlier run therefore
  // cannot make it pass or fail for the wrong reason.
  const message = `round-trip ${randomUUID()}`;

  await expectBundleBuilt();

  // Any page on the dashboard's origin will do; the overview is the one a
  // signed-in visitor lands on, so it is also the cheapest to reach.
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview" }),
  ).toBeVisible();

  await page.addScriptTag({ path: GLOBAL_BUNDLE_PATH });

  const result = await page.evaluate<
    RoundTripResult,
    {
      apiKey: string;
      message: string;
      environment: string;
      release: string;
    }
  >(
    async (input) => {
      const sdk = window.StuffsLogger;
      if (sdk === undefined) {
        return {
          ok: false,
          reason:
            "the global bundle loaded but did not define window.StuffsLogger",
        };
      }

      // Collected rather than thrown: the SDK swallows its own failures by
      // contract, so without this a refused batch would show up only as
      // `sent: 0` with no explanation.
      const diagnostics: string[] = [];

      const logger = sdk.createLogger({
        apiKey: input.apiKey,
        environment: input.environment,
        release: input.release,
        // One event per batch, so `flush` is a single round trip rather than a
        // race against the idle timer.
        batchSize: 1,
        onError: (error, context) => {
          diagnostics.push(
            `${context}: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      });

      if (!logger.enabled) {
        return {
          ok: false,
          reason: `the logger refused its configuration: ${diagnostics.join("; ")}`,
        };
      }

      logger.error(input.message, { probe: "round-trip" });
      await logger.flush();

      if (logger.stats.sent === 0) {
        return {
          ok: false,
          reason:
            `ingest accepted nothing (queued ${logger.stats.queued}, ` +
            `dropped ${logger.stats.dropped}, failed ${logger.stats.failed}): ` +
            (diagnostics.join("; ") || "the SDK reported no diagnostics"),
        };
      }

      return { ok: true, stats: logger.stats };
    },
    {
      apiKey: seeded.publicKey,
      message,
      environment: ROUND_TRIP_ENVIRONMENT,
      release: ROUND_TRIP_RELEASE,
    },
  );

  expect(result.ok, result.ok ? undefined : result.reason).toBe(true);
  if (!result.ok) return;

  expect(result.stats.sent).toBe(1);
  expect(result.stats.dropped).toBe(0);

  // THE OTHER END OF THE ROUND TRIP. Filtering by the unique message rather
  // than reading the top of an unfiltered stream, so a parallel spec ingesting
  // its own events cannot displace this one.
  await page.goto(buildLogsHref({ search: message }));

  const row = page.getByRole("row", {
    name: new RegExp(escapeForRegExp(message)),
  });
  await expect(row).toBeVisible();

  // The row is not merely present — it carries what the SDK actually sent, so
  // this fails if the level, the environment or the message were mangled
  // anywhere between the browser and the table.
  await expect(row).toContainText(ROUND_TRIP_ENVIRONMENT);
  await expect(row).toContainText("Error");

  // The event is attributed to the application the KEY belongs to, never to
  // anything the caller named — the SDK has no `app` option at all.
  await expect(row).toContainText(seeded.applicationName);
});

/**
 * Fails early, and with the command to run, when the bundle is missing.
 *
 * Without this the failure is `page.addScriptTag` complaining about a path,
 * several steps after the thing that was actually wrong.
 */
async function expectBundleBuilt(): Promise<void> {
  try {
    await access(GLOBAL_BUNDLE_PATH);
  } catch {
    throw new Error(
      `The SDK's <script> build is missing at ${GLOBAL_BUNDLE_PATH}. ` +
        "Build it first:\n\n  pnpm --filter @stuffs-logger/sdk build\n\n" +
        "`pnpm test:e2e` from the repository root does this for you.",
    );
  }
}

/** Escapes a UUID-bearing message for use inside an accessible-name regex. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
