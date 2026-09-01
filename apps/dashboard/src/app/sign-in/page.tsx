import type { Metadata } from "next";
import { redirect } from "next/navigation";

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
 * DELIBERATELY PLAIN. Every element here is raw HTML with Tailwind classes and
 * no client-side JavaScript: the form posts to a Server Action, the action
 * redirects, and failures come back as a query parameter this page renders.
 * That means it works before hydration, cannot double-submit a password into a
 * stale client state, and is trivial to restyle — the design-system pass is a
 * separate piece of work and should not have to unpick behaviour to do it.
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

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/20";

const LABEL_CLASS = "block text-sm font-medium text-neutral-900";

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
    <main className="flex min-h-svh items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">
          Sign in to Stuffs Logger
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Accounts are created by whoever runs this deployment.
        </p>

        {error === undefined ? null : (
          <p
            role="alert"
            className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {ERROR_MESSAGES[error]}
          </p>
        )}

        <form action={signInWithPasswordAction} className="mt-6 space-y-4">
          <input type="hidden" name={RETURN_TO_PARAM} value={returnPath} />

          <div className="space-y-1">
            <label className={LABEL_CLASS} htmlFor="email">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className={FIELD_CLASS}
            />
          </div>

          <div className="space-y-1">
            <label className={LABEL_CLASS} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={FIELD_CLASS}
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 focus:ring-2 focus:ring-neutral-900/30 focus:outline-none"
          >
            Sign in
          </button>
        </form>

        {/* Offered only when the credentials are actually configured: a button
            that can only fail is worse than no button. */}
        {googleAvailable ? (
          <>
            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-neutral-200" />
              <span className="text-xs text-neutral-500 uppercase">or</span>
              <span className="h-px flex-1 bg-neutral-200" />
            </div>

            <form action={signInWithGoogleAction}>
              <input type="hidden" name={RETURN_TO_PARAM} value={returnPath} />
              <button
                type="submit"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 focus:ring-2 focus:ring-neutral-900/20 focus:outline-none"
              >
                Continue with Google
              </button>
            </form>
          </>
        ) : null}
      </div>
    </main>
  );
}
