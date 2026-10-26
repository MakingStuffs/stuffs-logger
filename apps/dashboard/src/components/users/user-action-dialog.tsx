"use client";

import { useActionState, useEffect, useState } from "react";

import type { UserAction, UserActionResult } from "@/lib/users/action-result";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SubmitButton } from "../ui/submit-button";

import { FieldError } from "./field-error";
import { TemporaryPasswordNotice } from "./temporary-password-notice";

const INITIAL_RESULT: UserActionResult = { status: "idle" };

/** Props for {@link UserActionDialog}. */
export interface UserActionDialogProps {
  /** The Server Action to submit, handed down from a server component. */
  action: UserAction;
  /** The target user. Sent as `userId`; the action looks it up again. */
  userId: string;
  /** The target's address — shown, and what a confirmation must retype. */
  userEmail: string;
  /** The trigger button's visible text, e.g. "Deactivate". */
  triggerLabel: string;
  title: string;
  description: string;
  submitLabel: string;
  pendingLabel: string;
  /** Extra fields the action needs, e.g. `{ role: "ADMIN" }`. */
  hiddenFields?: Readonly<Record<string, string>>;
  /**
   * Ask for the user's email address to be retyped. For the operations that
   * lock someone out or replace their credential.
   */
  requireEmailConfirmation?: boolean;
  /** Style the submit control as destructive. */
  destructive?: boolean;
}

/**
 * One per-user admin operation, behind a dialog.
 *
 * Shared by role changes, deactivation, reactivation and password resets, so
 * every one of them handles pending state, refusals and the typed
 * confirmation identically. A `password_issued` result switches the dialog
 * to the one-time password; any other success closes it and lets the
 * revalidated table show the new state.
 *
 * The trigger's accessible name includes the address — "Deactivate
 * bo@example.com" — so a screen reader (and an e2e locator) can tell one
 * row's control from the next.
 */
export function UserActionDialog(props: UserActionDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`${props.triggerLabel} ${props.userEmail}`}
        >
          {props.triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {/* Unmounted on close, discarding any password it was holding. */}
        {open ? (
          <UserActionForm {...props} onDone={() => setOpen(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function UserActionForm({
  action,
  userId,
  userEmail,
  title,
  description,
  submitLabel,
  pendingLabel,
  hiddenFields = {},
  requireEmailConfirmation = false,
  destructive = false,
  onDone,
}: UserActionDialogProps & { onDone: () => void }) {
  const [result, formAction, isPending] = useActionState(
    action,
    INITIAL_RESULT,
  );

  useEffect(() => {
    if (result.status === "updated") onDone();
  }, [result.status, onDone]);

  if (result.status === "password_issued") {
    return (
      <div className="flex flex-col gap-5">
        <DialogHeader>
          <DialogTitle>
            {result.mode === "added" ? "Password added" : "Password reset"}
          </DialogTitle>
          <DialogDescription>
            {result.email} has been signed out everywhere and can now sign in
            with this password.
          </DialogDescription>
        </DialogHeader>
        <TemporaryPasswordNotice
          email={result.email}
          password={result.temporaryPassword}
        />
        <DialogFooter>
          <Button type="button" size="sm" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }

  const confirmErrors =
    result.status === "error" ? result.fieldErrors?.confirmEmail : undefined;
  const confirmId = `confirm-email-${userId}`;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <input type="hidden" name="userId" value={userId} />
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {requireEmailConfirmation ? (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={confirmId}
            className="text-sm leading-none font-medium"
          >
            Type the user&rsquo;s email address to confirm
          </label>
          <Input
            id={confirmId}
            name="confirmEmail"
            autoComplete="off"
            required
            aria-invalid={confirmErrors === undefined ? undefined : true}
            aria-describedby={`${confirmId}-hint ${confirmId}-error`}
          />
          <p id={`${confirmId}-hint`} className="text-muted-foreground text-xs">
            {userEmail}
          </p>
          <FieldError id={`${confirmId}-error`} messages={confirmErrors} />
        </div>
      ) : null}

      {result.status === "error" && confirmErrors === undefined ? (
        <p role="alert" className="text-destructive text-sm">
          {result.message}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton
          type="submit"
          size="sm"
          variant={destructive ? "destructive" : "default"}
          isPending={isPending}
        >
          {isPending ? pendingLabel : submitLabel}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
