import { describe, expect, it } from "vitest";

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./constants";
import {
  generateTemporaryPassword,
  TEMPORARY_PASSWORD_BYTES,
} from "./temporary-password";

describe("generateTemporaryPassword", () => {
  it("draws at least 18 bytes of randomness", () => {
    expect(TEMPORARY_PASSWORD_BYTES).toBeGreaterThanOrEqual(18);
  });

  it("is 24 base64url characters, safe to paste anywhere", () => {
    expect(generateTemporaryPassword()).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it("is a password the account form would itself accept", () => {
    const password = generateTemporaryPassword();

    expect(password.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(password.length).toBeLessThanOrEqual(MAX_PASSWORD_LENGTH);
  });

  it("never repeats", () => {
    const passwords = new Set(
      Array.from({ length: 50 }, () => generateTemporaryPassword()),
    );

    expect(passwords.size).toBe(50);
  });
});
