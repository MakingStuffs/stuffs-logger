import { assertAdminViewer } from "@/lib/access";
import { isApiError } from "@/lib/api/errors";
import { getSession } from "@/lib/auth/session";

/**
 * The gate at the top of every API-token mutation.
 *
 * A Server Action is a public endpoint, reachable without the page that
 * renders its form, so each action resolves the caller itself rather than
 * trusting that the page did. Kept out of the `"use server"` module so it is
 * not itself exposed as an action.
 *
 * Narrowed on `hasAccess`, never on truthiness: the refused arm is an object
 * and would pass a truthiness test.
 */

/** Whether the caller may manage API tokens, or the message to refuse with. */
export type AdminCallerCheck = { ok: true } | { ok: false; message: string };

/**
 * Resolves the session and asserts an active administrator.
 *
 * Never throws for a refusal; only an unexpected failure propagates.
 *
 * @returns `ok`, or a refusal message safe to show the caller.
 * @example
 * const caller = await checkAdminCaller();
 * if (!caller.ok) return { status: "error", message: caller.message };
 */
export async function checkAdminCaller(): Promise<AdminCallerCheck> {
  const access = await getSession();

  if (!access.hasAccess) {
    return {
      ok: false,
      message:
        access.reason === "INACTIVE"
          ? "Your account is no longer active."
          : "You need to sign in again.",
    };
  }

  try {
    assertAdminViewer(access.session);
  } catch (error) {
    if (isApiError(error)) return { ok: false, message: error.message };
    throw error;
  }

  return { ok: true };
}
