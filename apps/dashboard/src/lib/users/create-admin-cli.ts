import { parseArgs } from "node:util";

import { z } from "zod";

import { isAuthSkippedIn } from "@/constants/environment";
import type { EnvironmentSource } from "@/constants/environment";

import { userEmailSchema, userNameSchema } from "./schemas";

/**
 * The decision half of `scripts/create-admin.ts`: what the command line asked
 * for, and whether to run at all.
 *
 * Kept here, apart from the script, so it is unit-tested with no database and
 * no process to spawn — the script itself is then only "call this, then call
 * `createUserWithTemporaryPassword`, then print".
 */

/** How to run it, printed on any usage error. */
export const CREATE_ADMIN_USAGE =
  'Usage: pnpm --filter @stuffs-logger/dashboard user:create-admin -- --email you@example.com --name "Your Name"';

/** The parsed request, or why it was refused. */
export type CreateAdminRequest =
  { ok: true; email: string; name: string } | { ok: false; message: string };

const requestSchema = z.object({
  email: userEmailSchema,
  name: userNameSchema,
});

/**
 * Parses the script's arguments and environment.
 *
 * REFUSES UNDER `SKIP_AUTH`. With the bypass on, every visitor to the app is
 * already a mock administrator, so an operator running this is almost
 * certainly pointed at the wrong environment — and a real ADMIN created
 * beside an open dashboard is a credential nobody needed.
 *
 * @param argv - The arguments after the script path (`process.argv.slice(2)`).
 *   A bare `--`, as pnpm forwards it, is ignored.
 * @param env - The environment to check for the auth bypass.
 * @returns The validated email and name, or a message to print.
 */
export function parseCreateAdminArgs(
  argv: readonly string[],
  env: EnvironmentSource,
): CreateAdminRequest {
  if (isAuthSkippedIn(env)) {
    return {
      ok: false,
      message:
        "Refusing to run with SKIP_AUTH / NEXT_PUBLIC_SKIP_AUTH set: unset it and point DATABASE_URL at the deployment you mean to provision.",
    };
  }

  let values: { email?: string; name?: string };
  try {
    ({ values } = parseArgs({
      args: argv.filter((arg) => arg !== "--"),
      options: {
        email: { type: "string" },
        name: { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `${reason}\n${CREATE_ADMIN_USAGE}` };
  }

  const parsed = requestSchema.safeParse({
    email: values.email ?? "",
    name: values.name ?? "",
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `--${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    return { ok: false, message: `${issues}\n${CREATE_ADMIN_USAGE}` };
  }

  return { ok: true, email: parsed.data.email, name: parsed.data.name };
}
