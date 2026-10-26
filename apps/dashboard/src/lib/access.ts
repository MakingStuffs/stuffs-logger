import { ApiError } from "@/lib/api/errors";
import { isAdminUser } from "@/lib/auth/roles";
import type { AppSession } from "@/lib/auth/types";

/**
 * The access checks every data-access function runs before it reads anything.
 *
 * These take an ALREADY-RESOLVED session as an argument and never resolve one
 * themselves. A query helper that reaches for `getSession()` internally is a
 * helper whose caller cannot be reviewed for whether it gated the page — the
 * dependency becomes invisible. Passing the session in makes "who is asking"
 * part of every signature, so a call site with no session cannot compile.
 *
 * This is defence in depth, not the primary boundary: pages gate with
 * `getSessionOrRedirect` before they ever get here. It exists so that a page
 * which forgets still cannot read data.
 *
 * TWO GATES, AND THE SPLIT IS THE POLICY. The user table is now exclusively
 * this company's staff, so "signed in and active" is the right bar for reading
 * logs and applications. Ingest keys are not reads — they are write
 * credentials for the ingest endpoint — so minting and revoking them is held
 * one level higher, at ADMIN.
 */

/**
 * Asserts the session belongs to a live account.
 *
 * The gate on every LOG and APPLICATION read. Both refusals are `UNAUTHORIZED`
 * rather than `FORBIDDEN` because neither is about permission: one caller has
 * no identity and the other's identity has been switched off, and in both
 * cases signing in again is the thing that would help.
 *
 * @param session - The resolved session, from `getSessionOrRedirect` or the
 *   granted arm of `getSession`.
 * @throws {ApiError} `UNAUTHORIZED` when the caller has no identity, or the
 *   account is no longer active.
 * @example
 * assertActiveViewer(session);
 */
export function assertActiveViewer(session: AppSession): void {
  if (session.user.id.length === 0) {
    throw new ApiError("UNAUTHORIZED", "You need to sign in again.", {
      logContext: "session carried no user id",
    });
  }

  if (!session.user.isActive) {
    throw new ApiError("UNAUTHORIZED", "Your account is no longer active.", {
      logContext: `inactive user ${session.user.id}`,
    });
  }
}

/**
 * Asserts the session belongs to a live administrator.
 *
 * The gate on INGEST-KEY MANAGEMENT — listing keys, minting them and revoking
 * them. A key is a live write credential for the public ingest endpoint and a
 * revocation silently stops a production application logging, so this is the
 * one capability that is not simply "staff".
 *
 * Activity is checked FIRST, so a deactivated administrator gets the
 * "reactivate the account" refusal rather than a misleading "ask for the admin
 * role".
 *
 * @param session - The resolved session.
 * @throws {ApiError} `UNAUTHORIZED` when the account is anonymous or inactive,
 *   `FORBIDDEN` when it is live but not an administrator.
 * @example
 * assertAdminViewer(session);
 */
export function assertAdminViewer(session: AppSession): void {
  assertActiveViewer(session);

  if (!isAdminUser(session)) {
    throw new ApiError("FORBIDDEN", "Only an administrator can do this.", {
      logContext: `non-admin user ${session.user.id} refused`,
    });
  }
}
