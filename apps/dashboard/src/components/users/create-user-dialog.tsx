"use client";

import { UserPlus } from "lucide-react";
import { useActionState, useState } from "react";

import type { UserAction, UserActionResult } from "@/lib/users/action-result";
import { MAX_EMAIL_LENGTH, MAX_USER_NAME_LENGTH } from "@/lib/users/constants";

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
import { formControlVariants } from "../ui/form-control-variants";
import { Input } from "../ui/input";
import { SubmitButton } from "../ui/submit-button";
import { cn } from "../ui/utils";

import { FieldError } from "./field-error";
import { TemporaryPasswordNotice } from "./temporary-password-notice";

const INITIAL_RESULT: UserActionResult = { status: "idle" };

/**
 * Adds a user, and shows their temporary password once.
 *
 * Takes the action as a PROP: this is a client component, and importing a
 * `"use server"` module from this side of the boundary would compile a second
 * copy of the database client and the auth instance into the bundle. The
 * server component that renders this imports the action and hands it down.
 */
export function CreateUserDialog({ action }: { action: UserAction }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus className="size-4" aria-hidden="true" />
          Add user
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-svh overflow-y-auto sm:max-w-lg">
        {/* Unmounted with the dialog, which is what discards the temporary
            password from memory when it closes. */}
        {open ? (
          <CreateUserForm action={action} onDone={() => setOpen(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateUserForm({
  action,
  onDone,
}: {
  action: UserAction;
  onDone: () => void;
}) {
  const [result, formAction, isPending] = useActionState(
    action,
    INITIAL_RESULT,
  );

  if (result.status === "created") {
    return (
      <div className="flex flex-col gap-5">
        <DialogHeader>
          <DialogTitle>User added</DialogTitle>
          <DialogDescription>
            {result.name} can now sign in as {result.email}.
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

  const fieldErrors =
    result.status === "error" ? (result.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Add a user</DialogTitle>
        <DialogDescription>
          They get a temporary password, shown to you once, to sign in with.
          There is no invitation email.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="new-user-name"
          className="text-sm leading-none font-medium"
        >
          Name
        </label>
        <Input
          id="new-user-name"
          name="name"
          required
          maxLength={MAX_USER_NAME_LENGTH}
          autoComplete="off"
          aria-invalid={fieldErrors.name === undefined ? undefined : true}
          aria-describedby="new-user-name-error"
        />
        <FieldError id="new-user-name-error" messages={fieldErrors.name} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="new-user-email"
          className="text-sm leading-none font-medium"
        >
          Email
        </label>
        <Input
          id="new-user-email"
          name="email"
          type="email"
          required
          maxLength={MAX_EMAIL_LENGTH}
          autoComplete="off"
          aria-invalid={fieldErrors.email === undefined ? undefined : true}
          aria-describedby="new-user-email-error"
        />
        <FieldError id="new-user-email-error" messages={fieldErrors.email} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="new-user-role"
          className="text-sm leading-none font-medium"
        >
          Role
        </label>
        <select
          id="new-user-role"
          name="role"
          defaultValue="MEMBER"
          className={cn(formControlVariants(), "cursor-pointer")}
          aria-describedby="new-user-role-hint new-user-role-error"
        >
          <option value="MEMBER">Member</option>
          <option value="ADMIN">Administrator</option>
        </select>
        <p id="new-user-role-hint" className="text-muted-foreground text-xs">
          Members read every application&rsquo;s logs. Administrators also
          manage applications, keys, tokens and users.
        </p>
        <FieldError id="new-user-role-error" messages={fieldErrors.role} />
      </div>

      {result.status === "error" ? (
        <p role="alert" className="text-destructive text-sm">
          {result.message}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton type="submit" size="sm" isPending={isPending}>
          {isPending ? "Adding…" : "Add user"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
