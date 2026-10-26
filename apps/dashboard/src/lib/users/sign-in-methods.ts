import { CREDENTIAL_PROVIDER_ID } from "./credential-account";
import type { SignInMethods } from "./dto";

/** The provider id Better Auth gives the Google social provider. */
export const GOOGLE_PROVIDER_ID = "google";

/**
 * Summarises a user's linked accounts as the ways they can sign in.
 *
 * Reads `providerId` alone — the one column that says what KIND of credential
 * a row is without revealing anything about the credential itself.
 *
 * WHY THIS MATTERS TO AN OPERATOR: a Google row on an account nobody
 * provisioned is the trace of a sign-up that should have been impossible, and
 * a user with no rows at all cannot sign in by any route.
 *
 * @param providerIds - `accounts.providerId` for each of the user's rows.
 * @returns Which methods are present.
 * @example
 * toSignInMethods(["credential", "google"]); // { password: true, google: true, other: [] }
 */
export function toSignInMethods(providerIds: readonly string[]): SignInMethods {
  const distinct = [...new Set(providerIds)];

  return {
    password: distinct.includes(CREDENTIAL_PROVIDER_ID),
    google: distinct.includes(GOOGLE_PROVIDER_ID),
    other: distinct
      .filter(
        (id) => id !== CREDENTIAL_PROVIDER_ID && id !== GOOGLE_PROVIDER_ID,
      )
      .sort(),
  };
}
