import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { isAuthSkipped } from "@/constants/environment";

import { auth } from "./auth";
import { MOCK_SESSION } from "./mock-session";
import { buildSignInUrl } from "./return-path";
import { USER_ROLES } from "./types";
import type { AppSession, SessionAccessResult } from "./types";

/**
 * The app's session seam: the ONE place request state becomes an identity.
 *
 * Two entry points, and the difference between them is what they do with a
 * refusal, never what they check:
 *
 * - {@link getSession} never throws and never redirects. It answers the
 *   {@link SessionAccessResult} union, for route handlers, Server Actions and
 *   any surface that shapes its own refusal.
 * - {@link getSessionOrRedirect} is the per-PAGE gate: it sends an anonymous
 *   visitor to the sign-in page and otherwise hands back the session.
 *
 * Called per page and per action, never once in a layout: a layout does not
 * re-run on client-side navigation, so a check that only lives there is a
 * check a navigation can skip. The proxy (`src/proxy.ts`) is not a boundary
 * either — it does CSP nonces and nothing else.
 */

/**
 * Accepts a `Date` or an ISO string.
 *
 * The in-process adapter hands back real `Date` objects, but the contract that
 * matters is "this is a timestamp", and pinning it to one representation would
 * make a future transport change look like a signed-out user.
 */
const timestampSchema = z.union([z.date(), z.coerce.date()]);

/**
 * The shape a resolved session must have before this app will act on it.
 *
 * VALIDATED, NOT CAST. `auth.api.getSession` is loosely typed and its result
 * crosses a trust boundary — a session missing `isActive` or carrying an
 * unknown `role` is a session this app cannot make a correct access decision
 * about, so it fails CLOSED to "unauthenticated" rather than being asserted
 * into the right shape.
 */
const appSessionSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.string().min(1),
    name: z.string(),
    role: z.enum(USER_ROLES),
    image: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    isActive: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  }),
  session: z.object({
    id: z.string().min(1),
    token: z.string().min(1),
    userId: z.string().min(1),
    expiresAt: timestampSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    ipAddress: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
    userAgent: z
      .string()
      .nullish()
      .transform((value) => value ?? null),
  }),
});

/** The refusal every fail-closed path collapses to. */
const UNAUTHENTICATED: SessionAccessResult = {
  hasAccess: false,
  reason: "UNAUTHENTICATED",
  session: null,
};

/**
 * Resolves the current request's session.
 *
 * NEVER THROWS. Every failure — no cookie, an expired or malformed session, a
 * database error, being called outside a request context — resolves to
 * `UNAUTHENTICATED`, because a caller must not be able to read "yes" out of an
 * outage.
 *
 * TRUTHINESS WARNING: the refused arm is an OBJECT and therefore truthy.
 * `if (await getSession())` is not an access check — narrow on `hasAccess`.
 *
 * @returns The granted arm, or a refusal carrying the session when there is
 *   one to carry (a deactivated account) and `null` when there is not.
 * @example
 * const result = await getSession();
 * if (!result.hasAccess) return refuse(result.reason);
 * const { user } = result.session;
 */
export async function getSession(): Promise<SessionAccessResult> {
  if (isAuthSkipped()) return { hasAccess: true, session: MOCK_SESSION };

  let resolved: unknown;
  try {
    resolved = await auth.api.getSession({ headers: await headers() });
  } catch {
    // Deliberately silent about the cause: the session is unusable either way,
    // and the detail belongs in the platform's own error reporting, not in a
    // log line an anonymous caller controls the frequency of.
    return UNAUTHENTICATED;
  }

  const parsed = appSessionSchema.safeParse(resolved);
  if (!parsed.success) return UNAUTHENTICATED;

  const session = parsed.data;

  // Deactivation is reported as its OWN reason, carrying the session: this app
  // has no outside clients, so telling a colleague "your account is switched
  // off" is help rather than disclosure — and bouncing them to a sign-in they
  // have already completed would just loop.
  if (!session.user.isActive) {
    return { hasAccess: false, reason: "INACTIVE", session };
  }

  return { hasAccess: true, session };
}

/** Per-call options for {@link getSessionOrRedirect}. */
export interface GetSessionOrRedirectOptions {
  /**
   * The path on THIS app to return to after signing in, e.g.
   * `"/logs?level=error"`. Supplied by the page because a server component
   * cannot read its own pathname.
   *
   * Untrusted: a value that resolves off this app's origin, or that cannot be
   * parsed, is REFUSED and replaced with `/` (see `./return-path.ts`).
   */
  returnPath?: string;
}

/**
 * The per-page gate: resolve a session, or send the visitor to sign in.
 *
 * THIS FUNCTION REDIRECTS BY THROWING. `next/navigation`'s `redirect` unwinds
 * the component with a `NEXT_REDIRECT` error that Next catches, so never wrap
 * this call in a `try`/`catch` — you would swallow the redirect.
 *
 * A DEACTIVATED ACCOUNT IS RETURNED, NOT REDIRECTED. It is a real, current
 * session, so there is nothing for a sign-in page to fix; the data-access
 * gates in `lib/access.ts` refuse it and the page renders that refusal. This
 * is why the gate is defence in depth rather than the boundary: reaching a
 * page is not permission to read anything on it.
 *
 * @param options - See {@link GetSessionOrRedirectOptions}.
 * @returns The resolved session, for an authenticated visitor.
 * @example
 * const session = await getSessionOrRedirect({ returnPath: "/apps" });
 */
export async function getSessionOrRedirect(
  options: GetSessionOrRedirectOptions = {},
): Promise<AppSession> {
  const result = await getSession();

  if (result.hasAccess) return result.session;
  if (result.session !== null) return result.session;

  redirect(buildSignInUrl(options.returnPath));
}

/**
 * Signs the current user out, server-side.
 *
 * Revokes the session ROW, not just the cookie, so a copied cookie value is
 * dead the moment its owner signs out. Never throws: a failed sign-out must
 * still let the caller navigate away, and the session is either gone or about
 * to expire.
 *
 * @example
 * await signOut();
 * redirect("/sign-in");
 */
export async function signOut(): Promise<void> {
  if (isAuthSkipped()) return;

  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // Nothing useful to do: there is no session left to protect, and throwing
    // here would turn "signed out" into an error page.
  }
}
