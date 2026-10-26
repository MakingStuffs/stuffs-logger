"use client";

import { useActionState } from "react";

import type {
  AccountAction,
  AccountActionResult,
} from "@/lib/users/action-result";

import { SubmitButton } from "../ui/submit-button";

const INITIAL_RESULT: AccountActionResult = { status: "idle" };

/**
 * Sign out every other browser and device, keeping this one.
 *
 * The action arrives as a prop, like every action in this app's client
 * components.
 */
export function RevokeOtherSessionsForm({ action }: { action: AccountAction }) {
  const [result, formAction, isPending] = useActionState(
    action,
    INITIAL_RESULT,
  );

  return (
    <form action={formAction} className="flex flex-col items-start gap-3">
      <SubmitButton
        type="submit"
        size="sm"
        variant="outline"
        isPending={isPending}
      >
        {isPending ? "Signing out…" : "Sign out other sessions"}
      </SubmitButton>
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
    </form>
  );
}
