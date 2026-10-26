import type { IngestKeyActionResult } from "@/lib/apps/actions";

/**
 * The shape of an ingest-key Server Action, as the dialogs receive it.
 *
 * The dialogs take the action as a PROP rather than importing it. They are
 * client components, and a `"use server"` module imported from the client side
 * of the boundary is compiled by the bundler into a layer of its own — with a
 * second copy of everything behind it, the database client and the auth
 * instance included — beside the page's own copy. `IngestKeysSection`, a
 * server component, imports the real actions once and hands them down; this
 * type is the contract between the two.
 *
 * `useActionState` accepts a prop exactly as it accepts an import: the action
 * reference it is given is what it calls.
 */
export type IngestKeyAction = (
  previous: IngestKeyActionResult,
  formData: FormData,
) => Promise<IngestKeyActionResult>;
