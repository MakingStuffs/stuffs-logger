import { assertAdminViewer } from "@/lib/access";
import { isApiError } from "@/lib/api/errors";
import { getSession } from "@/lib/auth/session";
import type { AppSession } from "@/lib/auth/types";

/**
 * The admin gate every application and ingest-key mutation opens with.
 *
 * In a module of its own, NOT in a `"use server"` file. Every export of a
 * `"use server"` module is compiled into a callable endpoint, so exporting
 * this from one of the action files to share it would have published the
 * gate itself as an action anyone could invoke. Here it is a plain server
 * function the action files import.
 */

/** The refusal an action returns as-is. Fits every action result union. */
export interface AdminCallerRefusal {
  status: "error";
  message: string;
}

/** Whether the caller may administer, and who they are when they may. */
export type AdminCaller =
  | { ok: true; session: AppSession }
  | { ok: false; refusal: AdminCallerRefusal };

/**
 * Resolves the caller and checks they are a live administrator.
 *
 * Done inside every action rather than once at the page: the page gate
 * protects the page, and an action endpoint is reachable without it.
 *
 * The refusal is narrowed on `hasAccess`, never on the truthiness of the
 * result — the refused arm is an object and would pass a truthiness test.
 * Only the access layer's own refusal is translated; anything else is a bug
 * and is rethrown to the error boundary.
 *
 * @returns The admin's session, or the refusal to hand back to the form.
 * @example
 * const caller = await requireAdminCaller();
 * if (!caller.ok) return caller.refusal;
 */
export async function requireAdminCaller(): Promise<AdminCaller> {
  const access = await getSession();

  if (!access.hasAccess) {
    return {
      ok: false,
      refusal: {
        status: "error",
        message:
          access.reason === "INACTIVE"
            ? "Your account is no longer active."
            : "You need to sign in again.",
      },
    };
  }

  try {
    assertAdminViewer(access.session);
  } catch (error) {
    if (isApiError(error)) {
      return {
        ok: false,
        refusal: { status: "error", message: error.message },
      };
    }
    throw error;
  }

  return { ok: true, session: access.session };
}
