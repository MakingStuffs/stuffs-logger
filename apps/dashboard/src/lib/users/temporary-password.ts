import { randomBytes } from "node:crypto";

/**
 * The one-time password an administrator hands to a new (or reset) user.
 *
 * There is no email sending in this product, so a temporary password is the
 * whole provisioning handshake: it is generated here, returned ONCE in the
 * action's result, and the administrator passes it on through a private
 * channel. It is never stored in plaintext and never logged — only Better
 * Auth's hash of it reaches the database.
 *
 * Server-only: uses `node:crypto`.
 */

/**
 * Bytes of CSPRNG output per password. 18 bytes is 144 bits of entropy, which
 * base64url-encodes to exactly 24 characters with no padding — comfortably
 * inside Better Auth's 8..128 length window and well past anything guessable
 * in the throttle's allowance.
 */
export const TEMPORARY_PASSWORD_BYTES = 18;

/**
 * Generates a temporary password.
 *
 * base64url rather than hex or base64: it carries 6 bits per character, and
 * its alphabet has no `+`, `/` or `=` to be mangled by a chat client or a
 * shell when the administrator pastes it on.
 *
 * @returns A fresh 24-character password.
 * @example
 * const temporaryPassword = generateTemporaryPassword();
 */
export function generateTemporaryPassword(): string {
  return randomBytes(TEMPORARY_PASSWORD_BYTES).toString("base64url");
}
