"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useState } from "react";

import type { ApplicationActionResult } from "@/lib/apps/application-actions";
import type { ApplicationSummary } from "@/lib/logs/dto";

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

import type { ApplicationAction } from "./application-action";
import { FieldError } from "./field-error";

const INITIAL_RESULT: ApplicationActionResult = { status: "idle" };

/** Props for {@link DeleteApplicationDialog}. */
export interface DeleteApplicationDialogProps {
  /** The Server Action that deletes the application. */
  action: ApplicationAction;
  application: Pick<ApplicationSummary, "id" | "slug" | "name">;
}

/**
 * Permanently deletes an application, behind a typed confirmation.
 *
 * The slug is retyped rather than the name because it is the one value that
 * is guaranteed unique and is shown verbatim on the page. Like the key
 * revocation's retyped name, it is an INTENT check: a valid session — or a
 * script running under one — already passes every framework protection, and
 * only a person reading the page can supply it.
 *
 * On success the action redirects to the list; there is no success state.
 */
export function DeleteApplicationDialog({
  action,
  application,
}: DeleteApplicationDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="size-4" aria-hidden="true" />
          Delete application
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <DeleteApplicationForm
            action={action}
            application={application}
            onCancel={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeleteApplicationForm({
  action,
  application,
  onCancel,
}: DeleteApplicationDialogProps & { onCancel: () => void }) {
  const [result, formAction, isPending] = useActionState(
    action,
    INITIAL_RESULT,
  );

  const confirmErrors =
    result.status === "error" ? result.fieldErrors?.confirmSlug : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Delete {application.name}?</DialogTitle>
        <DialogDescription>
          This permanently deletes the application, every ingest key it has and
          every log line it has ever sent. Anything still using its keys stops
          being able to log immediately. This cannot be undone.
        </DialogDescription>
      </DialogHeader>

      <input type="hidden" name="applicationId" value={application.id} />

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="confirm-delete-slug"
          className="text-sm leading-none font-medium"
        >
          Type the application&rsquo;s slug to confirm
        </label>
        <Input
          id="confirm-delete-slug"
          name="confirmSlug"
          autoComplete="off"
          spellCheck={false}
          required
          className="font-mono"
          aria-describedby={
            confirmErrors === undefined
              ? "confirm-delete-hint"
              : "confirm-delete-hint confirm-delete-error"
          }
        />
        <p id="confirm-delete-hint" className="text-muted-foreground text-xs">
          <code className="font-mono">{application.slug}</code>
        </p>
        <FieldError id="confirm-delete-error" messages={confirmErrors} />
      </div>

      {result.status === "error" && confirmErrors === undefined ? (
        <p role="alert" className="text-destructive text-sm">
          {result.message}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton
          type="submit"
          size="sm"
          variant="destructive"
          isPending={isPending}
        >
          {isPending ? "Deleting…" : "Delete permanently"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
