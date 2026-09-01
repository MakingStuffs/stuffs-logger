"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth, isGoogleConfigured } from "@/lib/auth/auth";
import {
  RETURN_TO_PARAM,
  resolveReturnPath,
  SIGN_IN_PATH,
} from "@/lib/auth/return-path";
import { consumeSignInAttempt } from "@/lib/auth/sign-in-throttle";

import { SIGN_IN_ERROR_PARAM, type SignInError } from "./errors";

/**
 * The sign-in mutations.
 *
 * WHY SERVER ACTIONS AND NOT A PLAIN FORM POST to `/api/auth/sign-in/email`:
 * Better Auth answers that endpoint with `200` and a JSON body, so a native
 * form submission would leave the browser staring at JSON. Going through an
 * action keeps the page working without client-side JavaScript — the form
 * posts, the action redirects, and the result is a URL you can bookmark or
 * reload.
 *
 * THE PRICE, AND HOW IT IS PAID: `auth.api.*` calls skip Better Auth's HTTP
 * router, and the router is where its rate limiting lives. Every password
 * attempt is therefore counted through `consumeSignInAttempt` before it is
 * tried, or this would be an unthrottled guessing endpoint.
 *
 * FAILURES REDIRECT BACK RATHER THAN RETURNING STATE, so the page needs no
 * client component to render them and a reload cannot resubmit a password.
 * `redirect` signals by THROWING, so every call sits outside a `try`.
 *
 * A `"use server"` file may export ONLY async functions, which is why the
 * shared failure vocabulary lives in `./errors.ts`.
 */

/** Bounded so a form cannot make the server hash a megabyte. */
const MAX_EMAIL_LENGTH = 320;

/**
 * Better Auth's own maximum. Longer values are rejected here rather than
 * being sent on to fail.
 */
const MAX_PASSWORD_LENGTH = 128;

const credentialsSchema = z.object({
  email: z.string().trim().min(1).max(MAX_EMAIL_LENGTH),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/**
 * Reads the untrusted return path off the submitted form.
 *
 * It is a hidden field, so it is exactly as attacker-controlled as the query
 * parameter it came from — `resolveReturnPath` is what makes it safe.
 */
function submittedReturnPath(formData: FormData): string {
  const raw = formData.get(RETURN_TO_PARAM);

  return resolveReturnPath(typeof raw === "string" ? raw : undefined);
}

/** Builds the URL that re-renders the sign-in page with a failure on it. */
function failureUrl(error: SignInError, returnPath: string): string {
  const params = new URLSearchParams({
    [SIGN_IN_ERROR_PARAM]: error,
    [RETURN_TO_PARAM]: returnPath,
  });

  return `${SIGN_IN_PATH}?${params.toString()}`;
}

/**
 * Signs in with an email address and a password.
 *
 * @param formData - The submitted form. Entirely untrusted.
 * @returns Never: every path redirects.
 */
export async function signInWithPasswordAction(
  formData: FormData,
): Promise<void> {
  const returnPath = submittedReturnPath(formData);

  const parsed = credentialsSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) redirect(failureUrl("credentials", returnPath));

  // Counted BEFORE the credential is tried, so a guessing loop is refused
  // without ever reaching the password hash.
  const attempt = consumeSignInAttempt(parsed.data.email);
  if (!attempt.allowed) redirect(failureUrl("throttled", returnPath));

  let signedIn = false;
  try {
    await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
    signedIn = true;
  } catch {
    // Better Auth throws an APIError for a bad credential, an unverified
    // address and a missing user alike. All of them are one answer here: the
    // difference is exactly the thing an enumeration attack wants.
    signedIn = false;
  }

  if (!signedIn) redirect(failureUrl("credentials", returnPath));

  redirect(returnPath);
}

/**
 * Starts the Google handshake.
 *
 * The provider's redirect URL is produced by Better Auth — it carries the
 * state parameter the callback verifies — so nothing here builds a URL from
 * request input.
 *
 * @param formData - The submitted form, carrying only the return path.
 * @returns Never: every path redirects.
 */
export async function signInWithGoogleAction(
  formData: FormData,
): Promise<void> {
  const returnPath = submittedReturnPath(formData);

  if (!isGoogleConfigured()) {
    redirect(failureUrl("google_unavailable", returnPath));
  }

  let providerUrl: string | undefined;
  try {
    const started = await auth.api.signInSocial({
      body: {
        provider: "google",
        // Already reduced to a path on this app, so the value Better Auth
        // validates and later redirects to cannot leave this origin.
        callbackURL: returnPath,
        errorCallbackURL: failureUrl("google_failed", returnPath),
      },
      headers: await headers(),
    });
    providerUrl = started.url;
  } catch {
    providerUrl = undefined;
  }

  if (providerUrl === undefined) {
    redirect(failureUrl("google_failed", returnPath));
  }

  redirect(providerUrl);
}
