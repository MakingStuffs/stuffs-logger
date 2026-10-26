import { assertAdminViewer } from "@/lib/access";
import { isApiError } from "@/lib/api/errors";
import { getSession } from "@/lib/auth/session";
import type { AppSession } from "@/lib/auth/types";

/**
 * Who is calling a user-management or account action, and whether they may.
 *
 * Every Server Action under `lib/users` starts here. An action is a public
 * HTTP endpoint, so the page gate in front of the form is not a control: the
 * session is re-derived from the request, narrowed on `hasAccess` (never on
 * truthiness — the refused arm is an object), and — for the admin actions —
 * run through the same `assertAdminViewer` every admin read uses.
 *
 * The acting user's id is ONLY ever taken from the session this returns.
 * Nothing a form submits can name who is acting.
 *
 * Mirrors `requireAdminCaller` in `lib/apps/actions.ts`, which is private to
 * that module; this one returns the session too, because the user actions
 * need the actor's id for the self guard.
 */

/** A caller who may proceed, or the message to refuse them with. */
export type ActionCaller =
  { ok: true; session: AppSession } | { ok: false; message: string };

/** The refusals, worded for a person rather than an API client. */
export const CALLER_MESSAGES = {
  UNAUTHENTICATED: "You need to sign in again.",
  INACTIVE: "Your account is no longer active.",
} as const;

/**
 * Resolves a caller whose account is live.
 *
 * @returns The session, or a refusal for an anonymous or deactivated caller.
 */
export async function requireActiveCaller(): Promise<ActionCaller> {
  const access = await getSession();

  if (!access.hasAccess) {
    return {
      ok: false,
      message:
        access.reason === "INACTIVE"
          ? CALLER_MESSAGES.INACTIVE
          : CALLER_MESSAGES.UNAUTHENTICATED,
    };
  }

  return { ok: true, session: access.session };
}

/**
 * Resolves a caller who is a live administrator.
 *
 * @returns The session, or a refusal for an anonymous, deactivated or
 *   non-admin caller. The non-admin message is `assertAdminViewer`'s own.
 */
export async function requireAdminCaller(): Promise<ActionCaller> {
  const caller = await requireActiveCaller();
  if (!caller.ok) return caller;

  try {
    assertAdminViewer(caller.session);
  } catch (error) {
    if (isApiError(error)) return { ok: false, message: error.message };
    throw error;
  }

  return caller;
}
