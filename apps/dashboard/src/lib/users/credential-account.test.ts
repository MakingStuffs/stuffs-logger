import { createLocalAccountIssuer } from "better-auth/db";
import { describe, expect, it } from "vitest";

import {
  CREDENTIAL_PROVIDER_ID,
  credentialAccountFor,
} from "./credential-account";

/**
 * The contract that makes a seeded user signable.
 *
 * Asserted against the INSTALLED Better Auth rather than against remembered
 * values, so an upgrade that changes the namespacing scheme fails here — one
 * clear unit test — instead of failing as "user not found" in every e2e sign-in.
 */

describe("credentialAccountFor", () => {
  it("uses the provider id sign-in looks for", () => {
    expect(credentialAccountFor("user-1", "hash").providerId).toBe(
      "credential",
    );
    expect(CREDENTIAL_PROVIDER_ID).toBe("credential");
  });

  it("takes the issuer from the library, never from a literal", () => {
    expect(credentialAccountFor("user-1", "hash").issuer).toBe(
      createLocalAccountIssuer("credential"),
    );
  });

  it("uses the user's own id as the account id", () => {
    // `signInEmail` matches on `account.accountId === userRecord.user.id`, so
    // any other value makes the account invisible to sign-in.
    expect(credentialAccountFor("user-1", "hash").accountId).toBe("user-1");
    expect(credentialAccountFor("user-1", "hash").userId).toBe("user-1");
  });

  it("carries the hash it was given and nothing else", () => {
    expect(credentialAccountFor("user-1", "scrypt:hash").password).toBe(
      "scrypt:hash",
    );
  });

  it("declares no field beyond the credential contract", () => {
    expect(Object.keys(credentialAccountFor("user-1", "hash")).sort()).toEqual([
      "accountId",
      "issuer",
      "password",
      "providerId",
      "userId",
    ]);
  });
});
