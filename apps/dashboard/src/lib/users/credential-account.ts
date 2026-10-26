import { createLocalAccountIssuer } from "better-auth/db";

/**
 * The exact shape of the `accounts` row that makes an email-and-password
 * sign-in succeed.
 *
 * CREATING A SIGNABLE USER IS THE PART THAT HAS TO BE EXACTLY RIGHT, so this is
 * its own module with no application imports — it can therefore be unit-tested
 * directly against the installed Better Auth, and the test fails the moment
 * the library changes the contract underneath it.
 *
 * ONE COPY, THREE CALLERS: the admin "Add user" and "Reset password" actions
 * (via `./provisioning.ts`), the `user:create-admin` bootstrap script, and the
 * e2e seeder (`e2e/support/seed-store.ts`). A second copy would be a second
 * place for the triple below to drift.
 *
 * The three columns below are not a guess. `signInEmail` in better-auth
 * (`dist/api/routes/sign-in.mjs`) selects the credential account with:
 *
 * ```js
 * const credentialIssuer = createLocalAccountIssuer("credential");
 * userRecord.accounts.find((account) =>
 *   account.providerId === "credential" &&
 *   account.issuer === credentialIssuer &&
 *   account.accountId === userRecord.user.id);
 * ```
 *
 * — so a row that differs in any one of them is invisible to sign-in and the
 * user is reported as "not found". `signUpEmail` writes exactly this triple,
 * and `internalAdapter.findCredentialAccount` and `updatePassword` match on
 * exactly this triple. Reproducing it here is what lets this app create an
 * account while `emailAndPassword.disableSignUp` stays `true`.
 *
 * `issuer` is taken from the library rather than written out as
 * `"local:credential"`, so a change to the namespacing scheme moves this file
 * with it instead of silently producing rows nothing can sign in to.
 */

/** The provider id Better Auth gives local email-and-password credentials. */
export const CREDENTIAL_PROVIDER_ID = "credential";

/** The credential account row, minus the columns the adapter fills in. */
export interface CredentialAccountInput {
  userId: string;
  accountId: string;
  providerId: string;
  issuer: string;
  /** Better Auth's own scrypt hash. NEVER a plaintext password. */
  password: string;
}

/**
 * Builds the credential account row for a user.
 *
 * @param userId - The user the credential belongs to. Also its `accountId`:
 *   for a local credential the "account at the provider" is the user itself.
 * @param passwordHash - The hash produced by `auth.$context`'s
 *   `password.hash`, never a hand-rolled digest.
 * @returns The row to hand to `internalAdapter.linkAccount`.
 * @example
 * const ctx = await auth.$context;
 * await ctx.internalAdapter.linkAccount(
 *   credentialAccountFor(user.id, await ctx.password.hash(password)),
 * );
 */
export function credentialAccountFor(
  userId: string,
  passwordHash: string,
): CredentialAccountInput {
  return {
    userId,
    accountId: userId,
    providerId: CREDENTIAL_PROVIDER_ID,
    issuer: createLocalAccountIssuer(CREDENTIAL_PROVIDER_ID),
    password: passwordHash,
  };
}
