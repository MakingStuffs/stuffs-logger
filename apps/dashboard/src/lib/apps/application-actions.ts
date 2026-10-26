"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { prisma } from "@/lib/db";

import { requireAdminCaller } from "./admin-caller";
import {
  MAX_APPLICATION_DESCRIPTION_LENGTH,
  MAX_APPLICATION_NAME_LENGTH,
} from "./limits";
import {
  isPrismaError,
  RECORD_NOT_FOUND,
  UNIQUE_CONSTRAINT_VIOLATION,
} from "./prisma-errors";
import { purgeApplication } from "./purge-application";
import { applicationSlugSchema } from "./queries";

/**
 * Application mutations: create, edit, delete.
 *
 * Same contract as the ingest-key actions in `./actions.ts`. A Server Action
 * is a public HTTP endpoint, so each one re-derives the session, re-checks the
 * ADMIN role through {@link requireAdminCaller}, and validates its FormData
 * against a schema that names every field it accepts — before anything else
 * happens. Expected failures come back as an {@link ApplicationActionResult};
 * only genuine faults throw, and those reach the error boundary rather than
 * the form.
 *
 * Create and delete end in `redirect()` — to the new application, and back to
 * the list — so their success arm is a navigation, not a returned value.
 * `redirect` signals by throwing, which is why both calls sit outside every
 * `try` below.
 */

/** Longest id accepted from a form field. */
const MAX_ID_LENGTH = 64;

/** The list page, revalidated by every mutation that changes what it shows. */
const APPLICATIONS_PATH = "/apps";

/**
 * The outcome of an application action.
 *
 * `updated` is the only success a form ever receives: create and delete
 * navigate away instead.
 */
export type ApplicationActionResult =
  | { status: "idle" }
  | { status: "updated"; name: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[] | undefined>;
    };

const idSchema = z.string().trim().min(1).max(MAX_ID_LENGTH);

const nameSchema = z
  .string()
  .trim()
  .min(1, "Give the application a name.")
  .max(MAX_APPLICATION_NAME_LENGTH);

/**
 * An optional description: blank means "none", stored as `null`.
 *
 * Absent from the form entirely (a hand-built request) is `undefined`, which
 * the edit action reads as "leave it alone" rather than "clear it".
 */
const descriptionSchema = z
  .string()
  .trim()
  .max(MAX_APPLICATION_DESCRIPTION_LENGTH)
  .optional()
  .transform((value) =>
    value === undefined ? undefined : value.length === 0 ? null : value,
  );

const createApplicationSchema = z.object({
  name: nameSchema,
  slug: applicationSlugSchema,
  description: descriptionSchema,
});

/**
 * No `slug`, deliberately. It is in every shared link and every
 * `applicationSlug` filter, so renaming it would silently break all of them;
 * a slug sent anyway is dropped by the schema and never reaches the write.
 */
const updateApplicationSchema = z.object({
  applicationId: idSchema,
  name: nameSchema,
  description: descriptionSchema,
});

const deleteApplicationSchema = z.object({
  applicationId: idSchema,
  /**
   * The application's slug, retyped by the operator.
   *
   * An intent signal, exactly as the key revocation's retyped name is: a
   * valid session proves who is calling, not that they meant to destroy an
   * application and every line it ever logged. Only a person reading the page
   * can supply it.
   */
  confirmSlug: z
    .string()
    .trim()
    .min(1, "Type the application's slug exactly.")
    .max(MAX_ID_LENGTH, "Type the application's slug exactly."),
});

/** The "check the form" refusal, with the schema's per-field reasons. */
function invalidInput(error: z.ZodError): ApplicationActionResult {
  return {
    status: "error",
    message: "Check the details and try again.",
    fieldErrors: z.flattenError(error).fieldErrors,
  };
}

/**
 * Registers a new application, then opens its page.
 *
 * A slug another application already holds is reported against the slug
 * field. The unique index decides, not a prior lookup: a check-then-insert
 * would race a second admin creating the same slug, and the constraint is the
 * one answer both requests agree on.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - The submitted form. Entirely untrusted.
 * @returns A typed failure; on success it redirects to `/apps/<slug>` instead.
 */
export async function createApplicationAction(
  _previous: ApplicationActionResult,
  formData: FormData,
): Promise<ApplicationActionResult> {
  const caller = await requireAdminCaller();
  if (!caller.ok) return caller.refusal;

  const parsed = createApplicationSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) return invalidInput(parsed.error);

  let slug: string;
  try {
    const created = await prisma.application.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description ?? null,
      },
      select: { slug: true },
    });
    slug = created.slug;
  } catch (error) {
    if (isPrismaError(error, UNIQUE_CONSTRAINT_VIOLATION)) {
      return {
        status: "error",
        message: "Choose a different slug.",
        fieldErrors: {
          slug: ["Another application already uses this slug."],
        },
      };
    }
    throw error;
  }

  revalidatePath(APPLICATIONS_PATH);
  redirect(`${APPLICATIONS_PATH}/${encodeURIComponent(slug)}`);
}

/**
 * Renames an application or changes its description.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - The submitted form. Entirely untrusted.
 * @returns The saved name, or a typed failure.
 */
export async function updateApplicationAction(
  _previous: ApplicationActionResult,
  formData: FormData,
): Promise<ApplicationActionResult> {
  const caller = await requireAdminCaller();
  if (!caller.ok) return caller.refusal;

  const parsed = updateApplicationSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) return invalidInput(parsed.error);

  const { applicationId, name, description } = parsed.data;

  let slug: string;
  try {
    const updated = await prisma.application.update({
      where: { id: applicationId },
      data: {
        name,
        ...(description !== undefined && { description }),
      },
      select: { slug: true, name: true },
    });
    slug = updated.slug;
  } catch (error) {
    if (isPrismaError(error, RECORD_NOT_FOUND)) {
      return { status: "error", message: "That application no longer exists." };
    }
    throw error;
  }

  revalidatePath(APPLICATIONS_PATH);
  revalidatePath(`${APPLICATIONS_PATH}/${slug}`);

  return { status: "updated", name };
}

/**
 * Permanently deletes an application, its ingest keys and every log line it
 * has sent.
 *
 * The events are removed in bounded batches first (see
 * {@link purgeApplication}). When an application is too large to clear inside
 * one request, the batches already committed stay deleted and the admin is
 * told to run it again; the application itself is only deleted on the attempt
 * that finishes.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - The submitted form, including the retyped slug.
 * @returns A typed failure; on success it redirects to `/apps` instead.
 */
export async function deleteApplicationAction(
  _previous: ApplicationActionResult,
  formData: FormData,
): Promise<ApplicationActionResult> {
  const caller = await requireAdminCaller();
  if (!caller.ok) return caller.refusal;

  const parsed = deleteApplicationSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return {
      status: "error",
      message: "Type the application's slug to confirm.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const application = await prisma.application.findUnique({
    where: { id: parsed.data.applicationId },
    select: { id: true, slug: true },
  });
  if (application === null) {
    return { status: "error", message: "That application no longer exists." };
  }
  if (application.slug !== parsed.data.confirmSlug) {
    return {
      status: "error",
      message: "The slug you typed does not match this application.",
      fieldErrors: { confirmSlug: ["Type the application's slug exactly."] },
    };
  }

  const purge = await purgeApplication(application.id);

  if (!purge.complete) {
    // Some batches committed, so the page's own figures have changed even
    // though the application is still there.
    revalidatePath(`${APPLICATIONS_PATH}/${application.slug}`);

    return {
      status: "error",
      message:
        "This application has more log lines than one request can delete. The ones already removed stay removed — delete it again to carry on.",
    };
  }

  revalidatePath(APPLICATIONS_PATH);
  revalidatePath(`${APPLICATIONS_PATH}/${application.slug}`);
  redirect(APPLICATIONS_PATH);
}
