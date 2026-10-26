"use client";

import { Plus } from "lucide-react";
import { useActionState, useState } from "react";

import type { ApplicationActionResult } from "@/lib/apps/application-actions";
import {
  MAX_APPLICATION_DESCRIPTION_LENGTH,
  MAX_APPLICATION_NAME_LENGTH,
  MAX_APPLICATION_SLUG_LENGTH,
} from "@/lib/apps/limits";
import { suggestSlug } from "@/lib/apps/slug";

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

/** Props for {@link CreateApplicationDialog}. */
export interface CreateApplicationDialogProps {
  /** The Server Action that registers the application. */
  action: ApplicationAction;
}

/**
 * Registers a new application.
 *
 * On success the action redirects to the new application's page, so this
 * dialog never renders a success state of its own — the navigation replaces
 * the page it lives on.
 */
export function CreateApplicationDialog({
  action,
}: CreateApplicationDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="size-4" aria-hidden="true" />
          New application
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-svh overflow-y-auto sm:max-w-lg">
        {/* Unmounted on close, so reopening starts from a blank form. */}
        {open ? (
          <CreateApplicationForm
            action={action}
            onCancel={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateApplicationForm({
  action,
  onCancel,
}: CreateApplicationDialogProps & { onCancel: () => void }) {
  const [result, formAction, isPending] = useActionState(
    action,
    INITIAL_RESULT,
  );

  // Controlled, so a refused submission keeps what was typed: React resets an
  // action form's uncontrolled fields once the action settles.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // The slug follows the name until the admin edits it; from then on it is
  // theirs, even when emptied, so clearing it to retype never brings the
  // suggestion back underneath what they are typing.
  const [customSlug, setCustomSlug] = useState<string | null>(null);
  const slug = customSlug ?? suggestSlug(name);

  const fieldErrors =
    result.status === "error" ? (result.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Create an application</DialogTitle>
        <DialogDescription>
          Register something that will send logs. Once it exists, create an
          ingest key for it to send them with.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="app-name" className="text-sm leading-none font-medium">
          Name
        </label>
        <Input
          id="app-name"
          name="name"
          required
          maxLength={MAX_APPLICATION_NAME_LENGTH}
          placeholder="e.g. Checkout"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-describedby={describedBy(
            undefined,
            "app-name-error",
            fieldErrors.name,
          )}
        />
        <FieldError id="app-name-error" messages={fieldErrors.name} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="app-slug" className="text-sm leading-none font-medium">
          Slug
        </label>
        <Input
          id="app-slug"
          name="slug"
          required
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_APPLICATION_SLUG_LENGTH}
          className="font-mono"
          placeholder="e.g. checkout"
          value={slug}
          onChange={(event) => setCustomSlug(event.target.value)}
          aria-describedby={describedBy(
            "app-slug-hint",
            "app-slug-error",
            fieldErrors.slug,
          )}
        />
        <p id="app-slug-hint" className="text-muted-foreground text-xs">
          Lowercase letters, numbers and hyphens. It appears in this
          application&rsquo;s URL and in every shared log filter, so it cannot
          be changed later.
        </p>
        <FieldError id="app-slug-error" messages={fieldErrors.slug} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="app-description"
          className="text-sm leading-none font-medium"
        >
          Description <span className="text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id="app-description"
          name="description"
          rows={3}
          maxLength={MAX_APPLICATION_DESCRIPTION_LENGTH}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          aria-describedby={describedBy(
            "app-description-hint",
            "app-description-error",
            fieldErrors.description,
          )}
        />
        <p id="app-description-hint" className="text-muted-foreground text-xs">
          Up to {MAX_APPLICATION_DESCRIPTION_LENGTH} characters, shown on the
          application&rsquo;s card.
        </p>
        <FieldError
          id="app-description-error"
          messages={fieldErrors.description}
        />
      </div>

      {result.status === "error" && result.fieldErrors === undefined ? (
        <p role="alert" className="text-destructive text-sm">
          {result.message}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton type="submit" size="sm" isPending={isPending}>
          {isPending ? "Creating…" : "Create application"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
