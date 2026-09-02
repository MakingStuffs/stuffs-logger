import { INGEST_KEY_HEADER, INGEST_PATH } from "@stuffs-logger/core";
import { expect, test } from "@playwright/test";

import { LOGS_PATH } from "@/components/logs/search-params";
import { SIGN_IN_PATH } from "@/lib/auth/return-path";

/**
 * The post-deploy smoke suite: is the application fundamentally working?
 *
 * SAFE AGAINST PRODUCTION, and that is a hard constraint rather than a
 * preference. Everything here is read-only or refused-by-design: no fixture
 * user is created, no seeded row is assumed, no request that reaches storage
 * is made, and the project runs with no stored session at all (see
 * `playwright.config.ts`). Anything that cannot honour that belongs in the
 * full e2e suite instead.
 *
 * BREADTH, NOT DEPTH. One test per critical capability — it serves, it refuses
 * anonymous readers, ingest authenticates, the browser is protected. Branches,
 * permissions matrices and filter behaviour are the e2e suite's job; a smoke
 * failure must always mean "act now", which it stops meaning the moment the
 * suite is large enough for a red to be routine.
 *
 * SELECTED BY TAG: every test carries `@smoke` and the suite is run with
 * `playwright test --project=smoke`, which also matches the tag via
 * `--grep @smoke`. The tag is the contract; the file name is organisation.
 */

/** An ingest key of the right SHAPE and no validity, so parsing is not what refuses it. */
const INVALID_PUBLIC_KEY = "slg_pub_smoke-probe-not-a-real-key";

test.describe("smoke", () => {
  test(
    "the sign-in page serves and renders",
    { tag: "@smoke" },
    async ({ page }) => {
      const response = await page.goto(SIGN_IN_PATH);

      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { level: 1, name: "Sign in" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    },
  );

  test(
    "an anonymous visitor is sent to sign in rather than shown logs",
    { tag: "@smoke" },
    async ({ page }) => {
      await page.goto(LOGS_PATH);

      // The gate is per page (`getSessionOrRedirect`), so this asserts the
      // real boundary and not a proxy rule. The return path is carried so the
      // visitor lands back where they were headed.
      await expect(page).toHaveURL(
        new RegExp(`${SIGN_IN_PATH}\\?returnTo=%2Flogs$`),
      );

      // The redirect is only half the claim: prove no log data rendered.
      await expect(page.getByRole("table")).toHaveCount(0);
    },
  );

  test(
    "the ingest endpoint is reachable and refuses an invalid key",
    { tag: "@smoke" },
    async ({ request }) => {
      // NON-DESTRUCTIVE BY CONSTRUCTION: the key is verified before the body
      // is read (see `src/app/api/v1/ingest/route.ts`), so a refused request
      // never reaches validation, quota or storage. The body is present only
      // so this is a realistic request rather than a malformed one.
      const response = await request.post(INGEST_PATH, {
        headers: {
          [INGEST_KEY_HEADER]: INVALID_PUBLIC_KEY,
          "content-type": "application/json",
        },
        data: {
          source: "browser",
          environment: "smoke",
          sdk: { name: "smoke-probe", version: "0.0.0" },
          events: [],
        },
      });

      expect(response.status()).toBe(401);

      const body: unknown = await response.json();
      expect(body).toMatchObject({
        success: false,
        error: { code: "UNAUTHORIZED" },
      });
    },
  );

  test(
    "documents are served with their security headers",
    { tag: "@smoke" },
    async ({ request }) => {
      const response = await request.get(SIGN_IN_PATH);
      const headers = response.headers();

      // The dashboard renders log lines containing whatever a customer
      // application logged, behind a session that reads every application's
      // logs. Losing framing protection is a click-jacking hole, and losing
      // `nosniff` lets a log payload that looks like HTML be re-interpreted as
      // markup — so both are smoke-level, not review-level.
      expect(headers["content-security-policy"]).toContain(
        "frame-ancestors 'none'",
      );
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );

      // The server version is a free hint to anyone enumerating known Next
      // vulnerabilities, and `poweredByHeader: false` turns it off.
      expect(headers["x-powered-by"]).toBeUndefined();
    },
  );
});
