"use client";

import { Pencil } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import type { ApplicationActionResult } from "@/lib/apps/application-actions";
import {
  MAX_APPLICATION_DESCRIPTION_LENGTH,
  MAX_APPLICATION_NAME_LENGTH,
} from "@/lib/apps/limits";
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
import { Textarea } from "../ui/textarea";

import type { ApplicationAction } from "./application-action";
import { describedBy, FieldError } from "./field-error";

const INITIAL_RESULT: ApplicationActionResult = { status: "idle" };

/** Props for {@link EditApplicationDialog}. */
export interface EditApplicationDialogProps {
  /** The Server Action that saves the changes. */
  action: ApplicationAction;
  application: Pick<ApplicationSummary, "id" | "slug" | "name" | "description">;
}

/**
 * Edits an application's name and description.
 *
 * The slug is shown but not offered for editing — and the action would drop
 * one if it were sent — because it is in every shared link and every
 * `applicationSlug` filter, and renaming it would quietly break all of them.
 */
export function EditApplicationDialog({
  action,
  application,
}: EditApplicationDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="size-4" aria-hidden="true" />
          Edit details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-svh overflow-y-auto sm:max-w-lg">
        {/* Mounted per opening, so the fields start from the saved values. */}
        {open ? (
          <EditApplicationForm
            action={action}
            application={application}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditApplicationForm({
  action,
  application,
  onDone,
}: EditApplicationDialogProps & { onDone: () => void }) {
  const [result, formAction, isPending] = useActionState(
    action,
    INITIAL_RESULT,
  );
  // Controlled, so a refused submission keeps the edits: React resets an
  // action form's uncontrolled fields once the action settles.
  const [name, setName] = useState(application.name);
  const [description, setDescription] = useState(application.description ?? "");

  // The action revalidates the page, so the header already shows the new
  // name; the dialog's only remaining job is to close.
  useEffect(() => {
    if (result.status === "updated") onDone();
  }, [result.status, onDone]);

  const fieldErrors =
    result.status === "error" ? (result.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Edit application</DialogTitle>
        <DialogDescription>
          Change how {application.name} is named and described in the dashboard.
        </DialogDescription>
      </DialogHeader>

      <input type="hidden" name="applicationId" value={application.id} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-name" className="text-sm leading-none font-medium">
          Name
        </label>
        <Input
          id="edit-name"
          name="name"
          required
          maxLength={MAX_APPLICATION_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-describedby={describedBy(
            undefined,
            "edit-name-error",
            fieldErrors.name,
          )}
        />
        <FieldError id="edit-name-error" messages={fieldErrors.name} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="edit-slug" className="text-sm leading-none font-medium">
          Slug
        </label>
        {/* Not named, so it is never submitted: the slug is not editable. */}
        <Input
          id="edit-slug"
          value={application.slug}
          readOnly
          className="text-muted-foreground font-mono"
          aria-describedby="edit-slug-hint"
        />
        <p id="edit-slug-hint" className="text-muted-foreground text-xs">
          The slug cannot be changed. It is part of every shared link to this
          application and of every log filter that names it.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="edit-description"
          className="text-sm leading-none font-medium"
        >
          Description <span className="text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id="edit-description"
          name="description"
          rows={3}
          maxLength={MAX_APPLICATION_DESCRIPTION_LENGTH}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          aria-describedby={describedBy(
            "edit-description-hint",
            "edit-description-error",
            fieldErrors.description,
          )}
        />
        <p id="edit-description-hint" className="text-muted-foreground text-xs">
          Up to {MAX_APPLICATION_DESCRIPTION_LENGTH} characters. Leave it empty
          to remove the description.
        </p>
        <FieldError
          id="edit-description-error"
          messages={fieldErrors.description}
        />
      </div>

      {result.status === "error" && result.fieldErrors === undefined ? (
        <p role="alert" className="text-destructive text-sm">
          {result.message}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton type="submit" size="sm" isPending={isPending}>
          {isPending ? "Saving…" : "Save changes"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
