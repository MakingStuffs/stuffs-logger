import type { ApplicationActionResult } from "@/lib/apps/application-actions";

/**
 * The shape of an application Server Action, as the dialogs receive it.
 *
 * A PROP, never an import, for the reason `./ingest-key-action.ts` gives: a
 * `"use server"` module imported from a `"use client"` file is compiled into
 * a client-side layer of its own, with a second copy of the database client
 * and the auth instance behind it. `./application-admin-controls.tsx`, a
 * server component, imports the real actions once and hands them down.
 */
export type ApplicationAction = (
  previous: ApplicationActionResult,
  formData: FormData,
) => Promise<ApplicationActionResult>;
