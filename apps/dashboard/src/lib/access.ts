import { isInternalUser } from "@journey-further/salient-auth/server";
import type { SalientSession } from "@journey-further/salient-auth/server";

import { ApiError } from "@/lib/api/errors";

/**
 * The access checks every data-access function runs before it reads anything.
 *
 * These take an ALREADY-RESOLVED session as an argument and never resolve one
 * themselves. A query helper that reaches for `getSession()` internally is a
 * helper whose caller cannot be reviewed for whether it gated the page — the
 * dependency becomes invisible. Passing the session in makes "who is asking"
 * part of every signature, so a call site that has no session cannot compile.
 *
 * This is defence in depth, not the primary boundary: pages gate with
 * `getSessionOrRedirect` before they ever get here. It exists so that a page
 * which forgets still cannot read data.
 */

/**
 * Asserts the session belongs to a live account.
 *
 * @param session - The resolved session, from `getSessionOrRedirect` or the
 *   granted arm of `getSession`.
 * @throws {ApiError} `UNAUTHORIZED` when the account is not active.
 */
export function assertActiveViewer(session: SalientSession): void {
  if (!session.user.isActive) {
    throw new ApiError("UNAUTHORIZED", "Your account is no longer active.", {
      logContext: `inactive user ${session.user.id}`,
    });
  }
}

/**
 * Asserts the session belongs to an internal Journey Further user.
 *
 * Ingest keys are credentials that can write into any application's logs, so
 * managing them is deliberately narrower than reading logs. Internality is
 * derived from SCOPE via the package's `isInternalUser` — never from the email
 * domain, which is not revocable.
 *
 * @param session - The resolved session.
 * @throws {ApiError} `FORBIDDEN` when the caller is not internal.
 */
export function assertInternalViewer(session: SalientSession): void {
  assertActiveViewer(session);

  if (!isInternalUser(session)) {
    throw new ApiError(
      "FORBIDDEN",
      "Only Journey Further staff can manage ingest keys.",
      {
        logContext: `non-internal user ${session.user.id} attempted key management`,
      },
    );
  }
}
