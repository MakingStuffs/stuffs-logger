import { prisma } from "@/lib/db";
import { parseCreateAdminArgs } from "@/lib/users/create-admin-cli";
import { createUserWithTemporaryPassword } from "@/lib/users/provisioning";

/**
 * Creates an ADMIN with a temporary password — the first-administrator
 * bootstrap, with no SQL and no temporary code edit.
 *
 *   pnpm --filter @stuffs/logger-dashboard user:create-admin -- \
 *     --email you@example.com --name "Your Name"
 *
 * Reads `DATABASE_URL` as the app does: from the environment, or from the
 * `apps/dashboard/.env` file the Prisma client loads on import (values
 * already in the environment win). Note that the SKIP_AUTH refusal sees that
 * file too, so a developer `.env` with `SKIP_AUTH=true` refuses — which is
 * the point: that file describes a local sandbox, not a deployment. Uses the SAME `createUserWithTemporaryPassword`
 * as the admin screen's "Add user", so the account it makes is
 * indistinguishable from one made in the product.
 *
 * RUNS UNDER PLAIN NODE. Node strips the types itself; the only help it needs
 * is `./register-src-resolver.mjs`, which maps the `@/` alias and the
 * extensionless imports the app's bundler would otherwise resolve. No `tsx`,
 * no build step, no new dependency.
 *
 * The temporary password is printed ONCE, to stdout, and exists nowhere else
 * — the database holds only its hash. It is never written to stderr, so
 * redirecting errors to a log file cannot capture it.
 */

async function main(): Promise<number> {
  const request = parseCreateAdminArgs(process.argv.slice(2), process.env);
  if (!request.ok) {
    console.error(request.message);
    return 1;
  }

  const outcome = await createUserWithTemporaryPassword({
    email: request.email,
    name: request.name,
    role: "ADMIN",
  });

  if (outcome.status === "email_taken") {
    console.error(
      `Refusing: a user with the address ${request.email} already exists. ` +
        "Reset their password from /users instead, or choose another address.",
    );
    return 1;
  }

  console.log(
    [
      `Created administrator ${outcome.email}.`,
      "",
      `Temporary password: ${outcome.temporaryPassword}`,
      "",
      "This is shown once and cannot be recovered. Sign in with it, then",
      "change it at /account. If it is for someone else, send it to them",
      "through a private channel.",
    ].join("\n"),
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      `Failed to create the administrator: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
