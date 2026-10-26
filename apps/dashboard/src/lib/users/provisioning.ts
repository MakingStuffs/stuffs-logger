import { auth } from "@/lib/auth/auth";
import type { UserRole } from "@/lib/auth/types";
import { prisma } from "@/lib/db";

import { credentialAccountFor } from "./credential-account";
import { generateTemporaryPassword } from "./temporary-password";

/**
 * Creating users and setting their passwords — the writes sign-up would make,
 * made by an operator instead.
 *
 * Shared by the admin Server Actions and the `user:create-admin` bootstrap
 * script, so the two cannot create subtly different users. It therefore does
 * NO access checks of its own: every caller has already decided who is
 * allowed (an admin session for the actions, shell access to the database for
 * the script). It also imports nothing request-scoped — no `next/headers`, no
 * session — which is what lets the script load it outside Next.
 *
 * WHY BETTER AUTH'S CONTEXT AND NOT RAW PRISMA for users and credentials.
 * Sign-up is closed (`emailAndPassword.disableSignUp`, and `/sign-up/email`
 * is off the router), so there is no endpoint to call. `auth.$context` is the
 * same `AuthContext` every endpoint handler receives: `password.hash` is the
 * configured hasher, so a password set here verifies exactly like one set
 * through the product, and `internalAdapter` writes the rows with the
 * library's own defaults and hooks. The approach — and `credentialAccountFor`
 * — is the one the e2e seeder has proved against better-auth 1.7.2.
 *
 * PRISMA ONLY FOR WHAT BETTER AUTH REFUSES: `role` and `isActive` are
 * `input: false`, so they are set on the row after it exists.
 *
 * SECRECY. The temporary password exists in plaintext only in the value these
 * functions return. It is never logged, never stored, and never put in an
 * error message.
 */

/** The auth context the library hands every endpoint. */
type AuthContext = Awaited<typeof auth.$context>;

/** How Better Auth is told the user was provisioned. Same as the seeder. */
const PROVISIONING_SOURCE = { method: "email-password" } as const;

/** Prisma's unique-constraint violation code. */
const UNIQUE_VIOLATION_CODE = "P2002";

/** What to create. Already validated by the caller. */
export interface NewUserInput {
  name: string;
  email: string;
  role: UserRole;
}

/** The outcome of {@link createUserWithTemporaryPassword}. */
export type CreateUserOutcome =
  | {
      status: "created";
      userId: string;
      email: string;
      /** Shown once, then gone. */
      temporaryPassword: string;
    }
  | { status: "email_taken" };

/** The outcome of {@link issueTemporaryPassword}. */
export interface IssuedPassword {
  /**
   * `reset` replaced an existing password; `added` gave a password to a user
   * who had none (a Google-only account).
   */
  mode: "reset" | "added";
  /** Shown once, then gone. */
  temporaryPassword: string;
}

/** Whether an error is Prisma's unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === UNIQUE_VIOLATION_CODE
  );
}

/**
 * Normalises an address the way Better Auth stores it.
 *
 * @param email - The address as entered.
 * @returns It trimmed and lower-cased.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether any user already holds this address, ignoring case.
 *
 * Case-insensitive on purpose even though Better Auth lower-cases what it
 * writes: a row written by hand (the old SQL provisioning path) may not be,
 * and `Ada@x` beside `ada@x` would be two accounts for one inbox.
 *
 * @param email - The address to look for.
 * @returns Whether it is taken.
 */
export async function isEmailTaken(email: string): Promise<boolean> {
  const existing = await prisma.user.findFirst({
    where: { email: { equals: normaliseEmail(email), mode: "insensitive" } },
    select: { id: true },
  });

  return existing !== null;
}

/**
 * Creates a user who can sign in with a generated temporary password.
 *
 * The user row, the role and the credential are three writes that Better
 * Auth's adapter cannot put in one transaction with Prisma's, so a failure
 * after the user row exists DELETES it again: a half-made account — no
 * password, or the default role where ADMIN was asked for — is worse than
 * none, because the retry would then hit "email taken".
 *
 * @param input - The validated name, address and role.
 * @returns The new user and their temporary password, or `email_taken`.
 * @example
 * const outcome = await createUserWithTemporaryPassword({ name, email, role });
 * if (outcome.status === "email_taken") return refuse();
 */
export async function createUserWithTemporaryPassword(
  input: NewUserInput,
): Promise<CreateUserOutcome> {
  const email = normaliseEmail(input.email);
  if (await isEmailTaken(email)) return { status: "email_taken" };

  const ctx: AuthContext = await auth.$context;
  const temporaryPassword = generateTemporaryPassword();

  // Hashed before the user row exists, exactly as `signUpEmail` does it, so a
  // hasher that rejects the value fails before anything is written.
  const passwordHash = await ctx.password.hash(temporaryPassword);

  let userId: string;
  try {
    const created = await ctx.internalAdapter.createUser(
      {
        email,
        name: input.name.trim(),
        // An operator is vouching for the address, and there is no
        // verification email to send — the app sends no email at all. Marked
        // verified so the account keeps working if `requireEmailVerification`
        // is ever switched on.
        emailVerified: true,
      },
      PROVISIONING_SOURCE,
    );
    userId = created.id;
  } catch (error) {
    // Lost a race with another provisioning of the same address.
    if (isUniqueViolation(error)) return { status: "email_taken" };
    throw error;
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { role: input.role, isActive: true },
      select: { id: true },
    });
    await ctx.internalAdapter.linkAccount(
      credentialAccountFor(userId, passwordHash),
    );
  } catch (error) {
    await prisma.user.delete({ where: { id: userId }, select: { id: true } });
    throw error;
  }

  return { status: "created", userId, email, temporaryPassword };
}

/**
 * Gives a user a fresh temporary password, replacing any they had.
 *
 * A Google-only user has no credential row, and `updatePassword` silently
 * updates nothing when there is none — so the row is looked up first and
 * LINKED when missing ("add a password"), exactly as the e2e seeder's reset
 * does it.
 *
 * Does not end the user's sessions; callers do that with
 * {@link endAllSessions} so the order of the two is visible at the call site.
 *
 * @param userId - The user, already confirmed to exist.
 * @returns The new temporary password and whether it replaced one.
 */
export async function issueTemporaryPassword(
  userId: string,
): Promise<IssuedPassword> {
  const ctx: AuthContext = await auth.$context;
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await ctx.password.hash(temporaryPassword);

  const existing = await ctx.internalAdapter.findCredentialAccount(userId);

  if (existing === null) {
    await ctx.internalAdapter.linkAccount(
      credentialAccountFor(userId, passwordHash),
    );
    return { mode: "added", temporaryPassword };
  }

  await ctx.internalAdapter.updatePassword(userId, passwordHash);
  return { mode: "reset", temporaryPassword };
}

/**
 * Signs a user out everywhere.
 *
 * Through Better Auth's adapter rather than a Prisma `deleteMany`, so a
 * deployment that later adds secondary session storage still has its cached
 * sessions dropped too.
 *
 * @param userId - The user whose sessions to end.
 */
export async function endAllSessions(userId: string): Promise<void> {
  const ctx: AuthContext = await auth.$context;

  await ctx.internalAdapter.deleteUserSessions(userId);
}
