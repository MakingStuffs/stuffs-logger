/**
 * The limits user management validates against, in one place.
 *
 * Browser-safe and dependency-free: the client forms import these for their
 * `maxLength`/`minLength` courtesy attributes, and the Server Actions import
 * the same values for the checks that actually count, so the two cannot
 * disagree.
 */

/** Longest display name accepted. */
export const MAX_USER_NAME_LENGTH = 100;

/** RFC 5321's ceiling on an address. Bounded so a form cannot post a megabyte. */
export const MAX_EMAIL_LENGTH = 320;

/**
 * The shortest password a person may CHOOSE.
 *
 * Above Better Auth's own default of 8 on purpose: every account here reads
 * every application's logs, and the generated temporary password (24
 * characters) already sets the bar a chosen one should not fall far below.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** Better Auth's own maximum; longer values would be refused by the library. */
export const MAX_PASSWORD_LENGTH = 128;

/** Longest id accepted from a form field. Cuids are 25 characters. */
export const MAX_USER_ID_LENGTH = 64;
