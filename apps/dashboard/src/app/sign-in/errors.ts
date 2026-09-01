/**
 * The failure vocabulary the sign-in page and its actions share.
 *
 * In a module of its own because `actions.ts` carries `"use server"`, and such
 * a file may export nothing but async functions — a constant exported from
 * there is a build error, not a style preference.
 */

/** The query parameter carrying a failure back to the sign-in page. */
export const SIGN_IN_ERROR_PARAM = "error";

/** Every failure the sign-in page knows how to explain. */
export const SIGN_IN_ERRORS = [
  /**
   * Wrong password, unknown address, or malformed input. ONE reason on
   * purpose: distinguishing them would confirm which addresses have accounts
   * here.
   */
  "credentials",
  /** Too many attempts against this account in the current window. */
  "throttled",
  /** Google was pressed on a deployment with no Google credentials. */
  "google_unavailable",
  /** Google is configured but would not start the handshake. */
  "google_failed",
] as const;

/** A failure the sign-in page knows how to explain. */
export type SignInError = (typeof SIGN_IN_ERRORS)[number];
