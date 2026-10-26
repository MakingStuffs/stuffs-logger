"use client";

import { useActionState } from "react";

import type {
  AccountAction,
  AccountActionResult,
} from "@/lib/users/action-result";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/lib/users/constants";

import { Input } from "../ui/input";
import { SubmitButton } from "../ui/submit-button";
import { FieldError } from "../users/field-error";

const INITIAL_RESULT: AccountActionResult = { status: "idle" };

/**
 * Change your own password.
 *
 * Takes the action as a prop — see `CreateUserDialog` for why a client
 * component never imports a `"use server"` module.
 *
 * The `minLength`/`maxLength` attributes are a courtesy copy of the action's
 * own limits (from the same constants); the action's check is the one that
 * counts. The fields are uncontrolled and the form re-renders from the
 * action's result, so no password is ever held in React state.
 */
export function ChangePasswordForm({ action }: { action: AccountAction }) {
  const [result, formAction, isPending] = useActionState(
    action,
    INITIAL_RESULT,
  );

  const fieldErrors =
    result.status === "error" ? (result.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <PasswordField
        id="current-password"
        name="currentPassword"
        label="Current password"
        autoComplete="current-password"
        errors={fieldErrors.currentPassword}
      />
      <PasswordField
        id="new-password"
        name="newPassword"
        label="New password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        errors={fieldErrors.newPassword}
      />
      <PasswordField
        id="confirm-password"
        name="confirmPassword"
        label="Confirm new password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        errors={fieldErrors.confirmPassword}
      />

      {result.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {result.message}
        </p>
      ) : null}
      {result.status === "success" ? (
        <p role="status" className="text-sm">
          {result.message}
        </p>
      ) : null}

      <div>
        <SubmitButton type="submit" size="sm" isPending={isPending}>
          {isPending ? "Changing…" : "Change password"}
        </SubmitButton>
      </div>
    </form>
  );
}

function PasswordField({
  id,
  name,
  label,
  autoComplete,
  minLength,
  hint,
  errors,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  hint?: string;
  errors: string[] | undefined;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm leading-none font-medium">
        {label}
      </label>
      <Input
        id={id}
        name={name}
        type="password"
        required
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={MAX_PASSWORD_LENGTH}
        aria-invalid={errors === undefined ? undefined : true}
        aria-describedby={hint === undefined ? errorId : `${hintId} ${errorId}`}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      <FieldError id={errorId} messages={errors} />
    </div>
  );
}
