/**
 * The outcome of an API-token action, shared by the actions and the dialogs.
 *
 * `created` is the ONLY shape that ever carries a raw token, and it is never
 * persisted anywhere the UI can read it back. Browser-safe: types only.
 */
export type ApiTokenActionResult =
  | { status: "idle" }
  | {
      status: "created";
      tokenName: string;
      /** Shown once. Only its digest is stored, so it is unrecoverable. */
      token: string;
    }
  | { status: "revoked"; tokenName: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[] | undefined>;
    };

/**
 * The shape of an API-token Server Action as the dialogs receive it.
 *
 * Passed as a PROP from a server component, never imported by the client
 * dialogs: a `"use server"` module on the client graph is compiled into a
 * second server layer with its own copy of the database and auth clients.
 */
export type ApiTokenAction = (
  previous: ApiTokenActionResult,
  formData: FormData,
) => Promise<ApiTokenActionResult>;
