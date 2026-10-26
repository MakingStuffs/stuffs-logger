import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test as setup } from "@playwright/test";

import { resolveDatabaseTarget } from "../support/env";

/**
 * Brings the e2e database's schema up to date.
 *
 * `migrate deploy`, never `migrate dev`: deploy applies the committed
 * migrations and nothing else, so a run can neither invent a migration nor
 * quietly reset a database. The migration files are read and applied here;
 * they are never generated or edited by the harness.
 *
 * Its own project rather than a step inside the seeder, so "the schema is
 * wrong" and "the fixtures are wrong" are two different red lines in the
 * report.
 */

const run = promisify(execFile);

/** Prisma is slow to start and a first migration builds every index. */
const MIGRATE_TIMEOUT_MS = 120_000;

setup("apply migrations to the e2e database", async () => {
  const database = resolveDatabaseTarget(process.env);

  // `expect(...).toBe(true)` rather than a bare throw so the message is
  // attached to the failing step in the HTML report.
  expect(database.ok, database.ok ? undefined : database.message).toBe(true);
  if (!database.ok) return;

  setup.setTimeout(MIGRATE_TIMEOUT_MS);

  // An argument array, never a shell string: the connection string is
  // arbitrary text from the environment and must not be word-split or
  // interpreted by a shell.
  const { stdout, stderr } = await run(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy"],
    {
      env: {
        ...process.env,
        DATABASE_URL: database.url,
        DIRECT_DATABASE_URL: database.directUrl,
      },
    },
  );

  // Prisma reports "No pending migrations to apply." on a warm database, which
  // is a success. Only a non-zero exit — which `execFile` turns into a
  // rejection — is a failure, so the output is attached for diagnosis rather
  // than asserted on.
  setup.info().attach("prisma-migrate-deploy", {
    body: `${stdout}\n${stderr}`,
    contentType: "text/plain",
  });
});
