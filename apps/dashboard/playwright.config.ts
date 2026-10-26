import { randomBytes } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

import {
  resolveDatabaseTarget,
  resolveE2eTarget,
  resolveSmokeTarget,
} from "./e2e/support/env";
import { SEED_ADMIN } from "./e2e/support/fixtures";

/**
 * The end-to-end and smoke harness.
 *
 * COLLECTION BOUNDARY — the one rule every spec author must know. Vitest owns
 * `*.test.{ts,tsx}` and Playwright owns `*.spec.ts` and `*.setup.ts`, and
 * neither ever sees the other's files:
 *
 *   - `vitest.config.mts` includes `src/**\/*.test.{ts,tsx}` and
 *     `e2e/**\/*.test.ts` — so the harness's own pure logic is unit-tested
 *     alongside the app's, with no database.
 *   - this config's `testDir` is `./e2e` and its `testMatch` accepts only
 *     `*.spec.ts` and `*.setup.ts`.
 *
 * A Playwright spec named `*.test.ts` would be run by Vitest in jsdom and fail
 * incomprehensibly, so the extension is not a style preference — it is what
 * keeps the two runners apart.
 *
 * PROJECT CHAIN. Each stage is its own project so a failure names the stage
 * that failed rather than surfacing three steps later:
 *
 *   migrate → seed → auth → chromium → teardown
 *   smoke-guard → smoke
 *
 * The smoke chain is deliberately separate and unauthenticated: it runs
 * against deployed environments, where there are no fixture users and nothing
 * may be written. `teardown` deactivates the seeded accounts once the browser
 * projects are done, so the ADMIN with a repository-readable password does not
 * outlive the run on a long-lived local database.
 */

/** Truthy in every CI provider that sets it, including GitHub Actions. */
const isCI = process.env.CI !== undefined && process.env.CI !== "false";

const e2eTarget = resolveE2eTarget(process.env);
const database = resolveDatabaseTarget(process.env);
const smoke = resolveSmokeTarget(process.env);

/**
 * The e2e database, published to every worker before a test file is imported.
 *
 * `src/lib/db.ts` constructs its Prisma client at module load, so the seed
 * project would pick up whatever `DATABASE_URL` happened to be in the ambient
 * environment — a developer's own `.env.local`, for instance. Config modules
 * are evaluated in each worker before its test files, which makes this the one
 * place the override can still take effect.
 *
 * Absent on purpose whenever `E2E_DATABASE_URL` is missing or names a database
 * that does not look disposable: the `migrate` project fails with an
 * explanation instead, which is a far better error than Prisma's. It is also
 * why nothing here reads the ambient `DATABASE_URL` — see
 * `resolveDatabaseTarget`.
 */
if (database.ok) {
  process.env.DATABASE_URL = database.url;
  process.env.DIRECT_DATABASE_URL = database.directUrl;
}

/**
 * The origin Better Auth builds its own URLs from, for the WORKER processes.
 *
 * The seeder constructs the same `betterAuth` instance the app does, and
 * without this it warns on every run that it is deriving the origin from a
 * request it does not have. Nothing in the seed path builds a URL, so the
 * value only has to be truthful — it is the same origin the server is given.
 */
process.env.BETTER_AUTH_URL ??= e2eTarget.baseUrl;

/**
 * The session-signing secret for a run-managed server.
 *
 * Generated per run rather than written down. Better Auth THROWS on its
 * built-in default when `NODE_ENV=production`, and `next start` is a
 * production build, so a server without one cannot resolve a single session —
 * every sign-in would fail for a reason that looks nothing like its cause.
 *
 * Only the main process computes it, and only the server it starts receives
 * it. Worker processes never need one: the seeder uses the context's password
 * hasher, which does not involve the secret.
 */
const managedServerSecret =
  process.env.BETTER_AUTH_SECRET ?? randomBytes(32).toString("base64");

/**
 * The browsers the suite runs on.
 *
 * ONE, deliberately — Chromium — because every journey here is server-rendered
 * HTML and the value of a second engine is far below its cost on every pull
 * request. Adding one is appending an entry: the project list below is built
 * from this array, so nothing else has to change.
 */
const BROWSER_PROJECTS = [
  { name: "chromium", device: devices["Desktop Chrome"] },
] as const;

/**
 * Whether the smoke suite is pointed at the dashboard THIS run starts.
 *
 * True in `verify.yml`, where one Playwright invocation runs the e2e and the
 * smoke projects against the same managed server rather than building and
 * starting it twice. That server boots against an EMPTY database — the
 * `migrate` project is what gives it a schema — and the smoke suite's ingest
 * probe looks its key up in that schema, so in this one case the smoke
 * project must wait for `migrate`. Against a deployed origin (`smoke.yml`, or
 * `E2E_BASE_URL` set locally) there is no database in play and no migrate
 * project to wait for, which is why the dependency is conditional rather
 * than permanent: a permanent one would drag a database into the suite that
 * is defined by not needing one.
 */
const smokeTargetsManagedServer =
  smoke.ok && e2eTarget.managesServer && smoke.baseUrl === e2eTarget.baseUrl;

export default defineConfig({
  testDir: "./e2e",

  // The other half of the collection boundary described above.
  testMatch: /.*\.(spec|setup)\.ts$/,

  // A stray `.only` in CI silently reduces the suite to one test and reports
  // green, which is the worst possible failure mode for a gate.
  forbidOnly: isCI,

  // Retries exist to SURFACE flake as the `flaky` status, not to hide it. Any
  // test that passes on a retry is a bug to triage, not a result to accept.
  retries: isCI ? 2 : 0,

  fullyParallel: true,
  workers: isCI ? 2 : undefined,

  reporter: isCI
    ? [
        ["github"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
        ["list"],
      ]
    : [
        ["html", { outputFolder: "playwright-report", open: "never" }],
        ["list"],
      ],

  use: {
    baseURL: e2eTarget.baseUrl,
    // Everything needed to diagnose a failure from the uploaded artifact
    // rather than by re-running it locally against different data.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "migrate",
      testMatch: /migrate\.setup\.ts$/,
    },
    {
      name: "seed",
      testMatch: /seed\.setup\.ts$/,
      dependencies: ["migrate"],
    },
    {
      // Signs in ONCE per role through the real form and saves the cookies.
      // The sign-in throttle allows ten attempts per address per fifteen
      // minutes (`src/lib/auth/sign-in-throttle.ts`), so a suite that drove
      // the form per test would throttle itself into red.
      name: "auth",
      testMatch: /auth\.setup\.ts$/,
      dependencies: ["seed"],
      use: { ...devices["Desktop Chrome"] },
    },

    ...BROWSER_PROJECTS.map((browser) => ({
      name: browser.name,
      use: {
        ...browser.device,
        // The default role. A spec runs as the member instead by declaring
        // `test.use({ storageState: SEED_MEMBER.storageStatePath })`.
        storageState: SEED_ADMIN.storageStatePath,
      },
      dependencies: ["auth"],
      // Deactivates the seeded accounts once this project has finished — see
      // `e2e/setup/teardown.setup.ts`. Named here, on the consumer of the
      // seeded state, rather than on `seed`: Playwright runs a teardown after
      // every project that names it AND their dependents, so a second browser
      // appended to BROWSER_PROJECTS is covered by this same line.
      teardown: "teardown",
      testMatch: /specs\/.*\.spec\.ts$/,
      testIgnore: /smoke\.spec\.ts$/,
    })),
    {
      // Runs after the browser projects whether their tests passed or not,
      // and is selected automatically by `--project=chromium`.
      name: "teardown",
      testMatch: /teardown\.setup\.ts$/,
      // Never retried: a failed `updateMany` is a connectivity problem, and
      // the seed will re-promote the accounts next run regardless.
      retries: 0,
    },

    {
      // Fails the smoke run with an explanation when it has no target, rather
      // than letting it point somewhere by accident.
      name: "smoke-guard",
      testMatch: /smoke-guard\.setup\.ts$/,
      // Never retried: an absent environment variable will still be absent on
      // the second attempt, and three copies of the same message is noise on
      // top of a failure that is already unambiguous.
      retries: 0,
    },
    {
      name: "smoke",
      testMatch: /smoke\.spec\.ts$/,
      // `migrate` joins the list only when the target is the server this run
      // manages — see `smokeTargetsManagedServer`.
      dependencies: smokeTargetsManagedServer
        ? ["smoke-guard", "migrate"]
        : ["smoke-guard"],
      use: {
        ...devices["Desktop Chrome"],
        // Falls back to the e2e target only so the project can be constructed;
        // `smoke-guard` refuses the run before any test uses it.
        baseURL: smoke.ok ? smoke.baseUrl : e2eTarget.baseUrl,

        // NO STORED SESSION. The smoke suite must hold no credential for the
        // environment it checks, which is what makes it safe against
        // production.
        //
        // AN EMPTY STATE, NOT `undefined`. In the installed Playwright 1.62.1
        // an `undefined` option value means "not overridden" and resolves to
        // the nearest enclosing value — so this would be a no-op the day
        // anyone adds a top-level `use.storageState`, silently handing a live
        // session to the one suite that runs against production. The same trap
        // is documented in `e2e/specs/sign-in.spec.ts`, which proved it.
        storageState: { cookies: [], origins: [] },

        // NO TRACE, NO VIDEO, NO SCREENSHOT — the opposite of the top-level
        // defaults, and deliberately. This project points at a DEPLOYED origin
        // that may be production, and a Playwright trace records request and
        // response headers and bodies while a video records the rendered
        // pages. On a public repository, a workflow artifact is downloadable
        // by anyone for its retention period. The e2e projects keep all three:
        // they run against a throwaway database this run seeded itself.
        trace: "off",
        video: "off",
        screenshot: "off",
      },
    },
  ],

  /**
   * The dashboard, when this run owns it.
   *
   * Skipped entirely when `E2E_BASE_URL` names a server, because naming one is
   * how a caller says it is already running.
   *
   * IT IS GLOBAL TO THE CONFIG, NOT PER PROJECT — Playwright starts it before
   * any project runs and `--project` filtering does not reach it. So a SMOKE
   * run against a deployed origin must set `E2E_BASE_URL` as well as
   * `SMOKE_BASE_URL`, or it will build and start a whole local dashboard it
   * never visits (and fail, in a job with no database). Both are set together
   * in `.github/workflows/smoke.yml`. The one place that deliberately does not
   * is `verify.yml`, where the managed server IS the smoke target and both
   * suites run in one invocation (`--project=chromium --project=smoke`).
   *
   * A PRODUCTION BUILD, not `next dev`: dev-mode compilation timing hides the
   * races a real deployment has, and the security headers the smoke suite
   * asserts on differ between the two. The readiness probe is `/sign-in`
   * rather than `/` because it renders before the database has been migrated,
   * which is the state the server boots into.
   */
  webServer: e2eTarget.managesServer
    ? {
        command: "pnpm run build && pnpm run start",
        url: `${e2eTarget.baseUrl}/sign-in`,
        reuseExistingServer: !isCI,
        // `next build` from cold is minutes, not seconds.
        timeout: 300_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...(database.ok
            ? {
                DATABASE_URL: database.url,
                DIRECT_DATABASE_URL: database.directUrl,
              }
            : {}),
          BETTER_AUTH_SECRET: managedServerSecret,
          // Its own origin, so no auth URL is derived from a request header.
          BETTER_AUTH_URL: e2eTarget.baseUrl,
          // Pinned off. Next loads the developer's own `.env.local`, and a
          // local `SKIP_AUTH=true` there would make the production build
          // refuse to start — and would mean the suite was not testing real
          // sign-in if it did. Process env wins over dotenv files.
          SKIP_AUTH: "false",
          NEXT_PUBLIC_SKIP_AUTH: "false",
          // `next start` reads PORT. Kept in step with the base URL every
          // spec navigates against, so `E2E_PORT` moves both together.
          ...(e2eTarget.port === undefined
            ? {}
            : { PORT: String(e2eTarget.port) }),
        },
      }
    : undefined,
});
