import { z } from "zod";

import { MAX_EMAIL_LENGTH, MAX_USER_NAME_LENGTH } from "./constants";

/**
 * Field schemas shared by every way a user is created — the admin "Add user"
 * action and the `user:create-admin` script — so the two cannot accept
 * different shapes of name or address.
 *
 * Not a `"use server"` module, so it can export values.
 */

/** A display name: trimmed, present, bounded. */
export const userNameSchema = z
  .string()
  .trim()
  .min(1, "Enter the person's name.")
  .max(MAX_USER_NAME_LENGTH, `Use at most ${MAX_USER_NAME_LENGTH} characters.`);

/** An email address, normalised the way Better Auth stores it. */
export const userEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(MAX_EMAIL_LENGTH, "That address is too long.")
  .pipe(z.email("Enter a valid email address."));
