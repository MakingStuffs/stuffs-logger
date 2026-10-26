"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { USER_ROLES } from "@/lib/auth/types";

import type { ActionError, UserActionResult } from "./action-result";
import { requireAdminCaller } from "./caller";
import { MAX_EMAIL_LENGTH, MAX_USER_ID_LENGTH } from "./constants";
import { USER_GUARD_MESSAGES } from "./guards";
import {
  changeUserRole,
  deactivateUser,
  reactivateUser,
  resetUserPassword,
} from "./lifecycle";
import type { LifecycleRefusal } from "./lifecycle";
import { createUserWithTemporaryPassword } from "./provisioning";
import { userEmailSchema, userNameSchema } from "./schemas";

/**
 * User-management mutations, for `/users`. ADMIN ONLY.
 *
 * Every action is a public HTTP endpoint and is written as one: it resolves
 * the caller from the request (`requireAdminCaller`), validates a closed
 * schema over the form, then acts. The ACTING user's id comes from that
 * session and nowhere else; the TARGET user's id comes from the form, is
 * validated as an id, and is then looked up — a form cannot name a role
 * outside `USER_ROLES` or an id that does not exist.
 *
 * Results are a discriminated union and nothing is thrown to the client for
 * an expected failure. The only plaintext secret any of these return is the
 * one-time temporary password the action itself just generated.
 *
 * A `"use server"` file may export only async functions, which is why the
 * result types live in `./action-result.ts`.
 */

/** Where the admin table lives, for revalidation. */
const USERS_PATH = "/users";

const userIdSchema = z.string().trim().min(1).max(MAX_USER_ID_LENGTH);

const createUserSchema = z.object({
  name: userNameSchema,
  email: userEmailSchema,
  role: z.enum(USER_ROLES),
});

const changeRoleSchema = z.object({
  userId: userIdSchema,
  role: z.enum(USER_ROLES),
});

/**
 * The target's address, retyped. An intent signal, not an identity one — see
 * `confirmsEmail` in `./guards.ts`.
 */
const confirmedTargetSchema = z.object({
  userId: userIdSchema,
  confirmEmail: z
    .string()
    .trim()
    .min(1, "Type the user's email address exactly.")
    .max(MAX_EMAIL_LENGTH, "Type the user's email address exactly."),
});

const targetSchema = z.object({ userId: userIdSchema });

const INVALID_INPUT: ActionError = {
  status: "error",
  message: "Check the details and try again.",
};

/** How each refusal from `./lifecycle.ts` is shown. */
function refusalResult(reason: LifecycleRefusal): ActionError {
  switch (reason) {
    case "NOT_FOUND":
      return { status: "error", message: "That user no longer exists." };
    case "CONFIRMATION_MISMATCH":
      return {
        status: "error",
        message: "The address you typed does not match this user.",
        fieldErrors: {
          confirmEmail: ["Type the user's email address exactly."],
        },
      };
    case "CONFLICT":
      return {
        status: "error",
        message:
          "Someone else changed users at the same moment. Reload the page and try again.",
      };
    case "SELF":
    case "LAST_ADMIN":
      return { status: "error", message: USER_GUARD_MESSAGES[reason] };
  }
}

/** Parses a form against a schema, or produces the field errors to show. */
function parseForm<Schema extends z.ZodType>(
  schema: Schema,
  formData: FormData,
): { ok: true; data: z.infer<Schema> } | { ok: false; result: ActionError } {
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (parsed.success) return { ok: true, data: parsed.data };

  return {
    ok: false,
    result: {
      ...INVALID_INPUT,
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    },
  };
}

/**
 * Adds a user with a generated temporary password.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - `name`, `email`, `role`. Entirely untrusted.
 * @returns The new user and their temporary password, shown once — or a typed
 *   failure, with a duplicate address as a field error on `email`.
 */
export async function createUserAction(
  _previous: UserActionResult,
  formData: FormData,
): Promise<UserActionResult> {
  const caller = await requireAdminCaller();
  if (!caller.ok) return { status: "error", message: caller.message };

  const parsed = parseForm(createUserSchema, formData);
  if (!parsed.ok) return parsed.result;

  const outcome = await createUserWithTemporaryPassword(parsed.data);
  if (outcome.status === "email_taken") {
    return {
      status: "error",
      message: "Someone already has that email address.",
      fieldErrors: {
        email: ["A user with this email address already exists."],
      },
    };
  }

  revalidatePath(USERS_PATH);

  return {
    status: "created",
    name: parsed.data.name,
    email: outcome.email,
    temporaryPassword: outcome.temporaryPassword,
  };
}

/**
 * Changes a user's role.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - `userId`, `role`. Entirely untrusted.
 * @returns Confirmation, or a typed failure (self, last admin, not found).
 */
export async function changeUserRoleAction(
  _previous: UserActionResult,
  formData: FormData,
): Promise<UserActionResult> {
  const caller = await requireAdminCaller();
  if (!caller.ok) return { status: "error", message: caller.message };

  const parsed = parseForm(changeRoleSchema, formData);
  if (!parsed.ok) return parsed.result;

  const outcome = await changeUserRole(
    caller.session.user.id,
    parsed.data.userId,
    parsed.data.role,
  );
  if (!outcome.ok) return refusalResult(outcome.reason);

  revalidatePath(USERS_PATH);

  const roleName =
    parsed.data.role === "ADMIN" ? "an administrator" : "a member";
  return {
    status: "updated",
    message: outcome.changed
      ? `${outcome.target.email} is now ${roleName}.`
      : `${outcome.target.email} is already ${roleName}.`,
  };
}

/**
 * Deactivates a user and ends their sessions, behind a typed confirmation.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - `userId`, `confirmEmail`. Entirely untrusted.
 * @returns Confirmation, or a typed failure.
 */
export async function deactivateUserAction(
  _previous: UserActionResult,
  formData: FormData,
): Promise<UserActionResult> {
  const caller = await requireAdminCaller();
  if (!caller.ok) return { status: "error", message: caller.message };

  const parsed = parseForm(confirmedTargetSchema, formData);
  if (!parsed.ok) return parsed.result;

  const outcome = await deactivateUser(
    caller.session.user.id,
    parsed.data.userId,
    parsed.data.confirmEmail,
  );
  if (!outcome.ok) return refusalResult(outcome.reason);

  revalidatePath(USERS_PATH);

  return {
    status: "updated",
    message: `${outcome.target.email} has been deactivated and signed out.`,
  };
}

/**
 * Reactivates a user.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - `userId`. Entirely untrusted.
 * @returns Confirmation, or a typed failure.
 */
export async function reactivateUserAction(
  _previous: UserActionResult,
  formData: FormData,
): Promise<UserActionResult> {
  const caller = await requireAdminCaller();
  if (!caller.ok) return { status: "error", message: caller.message };

  const parsed = parseForm(targetSchema, formData);
  if (!parsed.ok) return parsed.result;

  const outcome = await reactivateUser(parsed.data.userId);
  if (!outcome.ok) return refusalResult(outcome.reason);

  revalidatePath(USERS_PATH);

  return {
    status: "updated",
    message: `${outcome.target.email} can sign in again.`,
  };
}

/**
 * Issues a user a new temporary password — or, for a Google-only user, adds
 * one — and ends their sessions, behind a typed confirmation.
 *
 * @param _previous - The previous result, supplied by `useActionState`.
 * @param formData - `userId`, `confirmEmail`. Entirely untrusted.
 * @returns The temporary password, shown once, or a typed failure.
 */
export async function resetUserPasswordAction(
  _previous: UserActionResult,
  formData: FormData,
): Promise<UserActionResult> {
  const caller = await requireAdminCaller();
  if (!caller.ok) return { status: "error", message: caller.message };

  const parsed = parseForm(confirmedTargetSchema, formData);
  if (!parsed.ok) return parsed.result;

  const outcome = await resetUserPassword(
    caller.session.user.id,
    parsed.data.userId,
    parsed.data.confirmEmail,
  );
  if (!outcome.ok) return refusalResult(outcome.reason);

  revalidatePath(USERS_PATH);

  return {
    status: "password_issued",
    email: outcome.target.email,
    mode: outcome.issued.mode,
    temporaryPassword: outcome.issued.temporaryPassword,
  };
}
