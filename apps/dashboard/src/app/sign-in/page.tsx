import { Terminal, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { APP_DISPLAY_NAME } from "@/constants/environment";
import { isGoogleConfigured } from "@/lib/auth/auth";
import { RETURN_TO_PARAM, resolveReturnPath } from "@/lib/auth/return-path";
import { getSession } from "@/lib/auth/session";

import { signInWithGoogleAction, signInWithPasswordAction } from "./actions";
import {
  SIGN_IN_ERROR_PARAM,
  SIGN_IN_ERRORS,
  type SignInError,
} from "./errors";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * The sign-in page.
 *
 * ZERO CLIENT JAVASCRIPT, which is the property to protect when editing it.
 * The form posts to a Server Action, the action redirects, and failures come
 * back as a query parameter this page renders. It therefore works before
 * hydration and cannot double-submit a password into a stale client state.
 * `Input` and `Button` are styling over native elements with no `"use client"`
 * of their own, so composing them keeps that property intact.
 *
 * NO SIGN-UP LINK, because there is no sign-up. A `MEMBER` reads every
 * application's logs, so self-service registration would hand the contents of
 * every log line to anyone with an email address. Accounts are provisioned by
 * whoever runs the deployment.
 */

/** Untrusted query input. Every value is a string or an array of them. */
interface SignInSearchParams {
  [RETURN_TO_PARAM]?: string | string[];
  [SIGN_IN_ERROR_PARAM]?: string | string[];
}

/** The copy for each failure, written for the person reading it. */
const ERROR_MESSAGES: Readonly<Record<SignInError, string>> = {
  // One message for wrong password, unknown address and deactivated account
  // alike: saying which would confirm who has an account here.
  credentials: "That email address and password did not match. Try again.",
  throttled:
    "Too many sign-in attempts for this account. Wait a few minutes and try again.",
  google_unavailable:
    "Google sign-in is not configured on this deployment. Use your email address and password.",
  google_failed:
    "Google sign-in could not be started. Try again, or use your email address and password.",
};

/** Takes the first value of a repeated parameter, ignoring the rest. */
function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];

  return value;
}

/** Narrows the untrusted `error` parameter to one this page has copy for. */
function toSignInError(value: string | undefined): SignInError | undefined {
  return SIGN_IN_ERRORS.find((known) => known === value);
}

/** Field labels, styled once so the two fields cannot drift apart. */
const LABEL_CLASS = "block text-sm leading-none font-medium";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SignInSearchParams>;
}) {
  const params = await searchParams;

  // Sanitised before it is used anywhere: as the hidden field the actions read
  // back, and as the destination below.
  const returnPath = resolveReturnPath(firstValue(params[RETURN_TO_PARAM]));
  const error = toSignInError(firstValue(params[SIGN_IN_ERROR_PARAM]));

  // Someone already signed in has nothing to do here, and leaving them on a
  // sign-in form is how a "why can't I log in?" loop starts.
  const session = await getSession();
  if (session.hasAccess) redirect(returnPath);

  const googleAvailable = isGoogleConfigured();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-12">
      <div className="flex items-center gap-2">
        <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
          <Terminal className="size-5" aria-hidden="true" />
        </span>
        <span className="text-base font-semibold tracking-tight">
          {APP_DISPLAY_NAME}
        </span>
      </div>

      <div className="bg-card w-full max-w-sm rounded-lg border p-8">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Accounts are created by whoever runs this deployment.
        </p>

        {error === undefined ? null : (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive mt-6 flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>{ERROR_MESSAGES[error]}</span>
          </p>
        )}

        <form
          action={signInWithPasswordAction}
          className="mt-6 flex flex-col gap-4"
        >
          <input type="hidden" name={RETURN_TO_PARAM} value={returnPath} />

          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLASS} htmlFor="email">
              Email address
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={LABEL_CLASS} htmlFor="password">
              Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          <Button type="submit" className="mt-2 w-full">
            Sign in
          </Button>
        </form>

        {/* Offered only when the credentials are actually configured: a button
            that can only fail is worse than no button. */}
        {googleAvailable ? (
          <>
            <div className="my-6 flex items-center gap-3">
              <span className="bg-border h-px flex-1" />
              <span className="text-muted-foreground text-xs uppercase">
                or
              </span>
              <span className="bg-border h-px flex-1" />
            </div>

            <form action={signInWithGoogleAction}>
              <input type="hidden" name={RETURN_TO_PARAM} value={returnPath} />
              <Button type="submit" variant="outline" className="w-full">
                Continue with Google
              </Button>
            </form>
          </>
        ) : null}
      </div>
    </main>
  );
}
