"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import {
  clearSignInAttempts,
  consumeSignInAttempt,
  resolveClientIp,
} from "@/lib/auth/sign-in-throttle";
import { prisma } from "@/lib/db";

import type { AccountActionResult, ActionError } from "./action-result";
import { requireActiveCaller } from "./caller";
import { CREDENTIAL_PROVIDER_ID } from "./credential-account";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./constants";

/**
 * The signed-in user's own account mutations, for `/account`. Any live user.
 *
 * THE CHANGE-PASSWORD FORM IS A PASSWORD ORACLE unless it is throttled: it
 * answers "was that your current password?" for whoever holds the session —
 * including someone who walked up to an unlocked laptop. `auth.api.*` calls
 * bypass Better Auth's router and therefore its rate limiter, so every attempt
 * is counted through the SAME throttle as sign-in, keyed on the account's
 * address and the client address. Sharing the windows is deliberate: a guesser
 * cannot get one allowance from the sign-in form and a second from here.
 *
 * Verified against the installed better-auth 1.7.2:
 * - `disabledPaths` is applied in the ROUTER's `onRequest`
 *   (`dist/api/index.mjs`), so `auth.api.changePassword` and
 *   `auth.api.revokeOtherSessions` — direct endpoint calls — are unaffected.
 * - `changePassword` with `revokeOtherSessions: true` deletes EVERY session of
 *   the user, the current one included, and sets a cookie for a new one
 *   (`dist/api/routes/update-user.mjs`). That is NOT used here. Setting a
 *   cookie makes Next re-render the page inside the action's response, and
 *   `getSession` reads the ORIGINAL request headers, which still carry the
 *   token that was just deleted — so the re-render redirects to sign-in and
 *   the result is lost. Instead the password is changed in place and
 *   `revokeOtherSessions` (`dist/api/routes/session.mjs`) deletes every
 *   session except the current one, which sets no cookie at all.
 *
 * Failures return ONE generic message: which check failed (wrong current
 * password, a library refusal) is exactly what a guesser wants to learn.
 */

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
    newPassword: z
      .string()
      .min(
        MIN_PASSWORD_LENGTH,
        `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      )
      .max(
        MAX_PASSWORD_LENGTH,
        `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
      ),
    confirmPassword: z.string().max(MAX_PASSWORD_LENGTH),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two new passwords do not match.",
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from your current one.",
  });

const GENERIC_FAILURE: ActionError = {
  status: "error",
  message:
    "Your password was not changed. Check your current password and try again.",
};

/**
 * Whether the user has a local password at all.
 *
 * Reads `providerId` only — never the hash.
 */
async function hasPassword(userId: string): Promise<boolean> {
  const credential = await prisma.account.findFirst({
    where: { userId, providerId: CREDENTIAL_PROVIDER_ID },
    select: { id: true },
  });

  return credential !== null;
}

/** Minutes, rounded up, for the throttle message. */
function minutesFrom(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * Changes the signed-in user's password and signs out their other sessions.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - `currentPassword`, `newPassword`, `confirmPassword`.
 * @returns Success, or a generic failure. Never echoes a password back.
 */
export async function changeOwnPasswordAction(
  _previous: AccountActionResult,
  formData: FormData,
): Promise<AccountActionResult> {
  const caller = await requireActiveCaller();
  if (!caller.ok) return { status: "error", message: caller.message };
  const { user } = caller.session;

  const parsed = changePasswordSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the new password and try again.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  if (!(await hasPassword(user.id))) {
    return {
      status: "error",
      message:
        "You sign in with Google, so there is no password to change here.",
    };
  }

  const requestHeaders = await headers();
  const clientIp = resolveClientIp(requestHeaders);

  // Counted BEFORE the current password is tried, so a guessing loop is
  // refused without ever reaching the hash.
  const attempt = consumeSignInAttempt(user.email, clientIp);
  if (!attempt.allowed) {
    return {
      status: "error",
      message: `Too many attempts. Try again in ${minutesFrom(attempt.retryAfterSeconds)} minutes.`,
    };
  }

  let changed = false;
  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: false,
      },
      headers: requestHeaders,
    });
    changed = true;
  } catch {
    // A wrong current password, a vanished session and a library refusal are
    // all one answer: the difference is what an oracle would sell.
    changed = false;
  }

  if (!changed) return GENERIC_FAILURE;

  // The owner just proved the attempts before this one were theirs.
  clearSignInAttempts(user.email, clientIp);

  // Every OTHER device is signed out; this one keeps its session and cookie.
  // A failure here is reported rather than hidden: the password did change,
  // but a stolen session elsewhere would still be live.
  try {
    await auth.api.revokeOtherSessions({ headers: requestHeaders });
  } catch {
    return {
      status: "error",
      message:
        "Your password was changed, but other sessions could not be signed out. Use Sign out other sessions below.",
    };
  }

  return {
    status: "success",
    message: "Password changed. Every other session has been signed out.",
  };
}

/**
 * Signs the user out everywhere except this browser.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param _formData - Carries nothing; the session says whose sessions these are.
 * @returns Success, or a generic failure.
 */
export async function revokeOtherSessionsAction(
  _previous: AccountActionResult,
  _formData: FormData,
): Promise<AccountActionResult> {
  const caller = await requireActiveCaller();
  if (!caller.ok) return { status: "error", message: caller.message };

  try {
    await auth.api.revokeOtherSessions({ headers: await headers() });
  } catch {
    return {
      status: "error",
      message: "Your other sessions could not be signed out. Try again.",
    };
  }

  return {
    status: "success",
    message: "Every other session has been signed out.",
  };
}
