/**
 * The results the user-management and account Server Actions return.
 *
 * In their own module rather than beside the actions: a `"use server"` file
 * may export only async functions at runtime, and the client components that
 * render these results need the types without touching the action module.
 * Browser-safe: types only.
 */

/** A failure the form can render. */
export interface ActionError {
  status: "error";
  message: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

/**
 * The outcome of an admin user action.
 *
 * `created` and `password_issued` are the ONLY shapes that ever carry a
 * plaintext password, and only the one-time temporary password that action
 * just generated. It lives in the dialog's state until the dialog closes and
 * is never persisted anywhere the UI can read it back.
 */
export type UserActionResult =
  | { status: "idle" }
  | {
      status: "created";
      name: string;
      email: string;
      /** Shown once. Unrecoverable afterwards. */
      temporaryPassword: string;
    }
  | {
      status: "password_issued";
      email: string;
      /** `added` when the user had no password before (Google-only). */
      mode: "reset" | "added";
      /** Shown once. Unrecoverable afterwards. */
      temporaryPassword: string;
    }
  | { status: "updated"; message: string }
  | ActionError;

/** The outcome of an `/account` action. Never carries a password. */
export type AccountActionResult =
  { status: "idle" } | { status: "success"; message: string } | ActionError;

/** The shape of a user-management Server Action, as client forms receive it. */
export type UserAction = (
  previous: UserActionResult,
  formData: FormData,
) => Promise<UserActionResult>;

/** The shape of an `/account` Server Action, as client forms receive it. */
export type AccountAction = (
  previous: AccountActionResult,
  formData: FormData,
) => Promise<AccountActionResult>;
