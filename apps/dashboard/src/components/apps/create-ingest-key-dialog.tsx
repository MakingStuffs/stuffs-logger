"use client";

import { Button } from "@journey-further/salient-ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@journey-further/salient-ui/ui/dialog";
import { Input } from "@journey-further/salient-ui/ui/input";
import { SubmitButton } from "@journey-further/salient-ui/ui/submit-button";
import { Textarea } from "@journey-further/salient-ui/ui/textarea";
import { KeyRound, TriangleAlert } from "lucide-react";
import { useActionState, useState } from "react";

import { createIngestKeyAction } from "@/lib/apps/actions";
import type { IngestKeyActionResult } from "@/lib/apps/actions";
import type { IngestKeyType } from "@/lib/ingest/keys";

import { CopyButton } from "./copy-button";

const INITIAL_RESULT: IngestKeyActionResult = { status: "idle" };

/**
 * Creates an ingest key, and shows it once.
 *
 * A client component because the plaintext of a new key exists only in the
 * action's response — it is never stored, so it can only ever live in this
 * component's state, and it disappears with the dialog.
 */
export function CreateIngestKeyDialog({
  applicationId,
  applicationName,
}: {
  applicationId: string;
  applicationName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound className="size-4" aria-hidden="true" />
          Create key
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-svh overflow-y-auto sm:max-w-lg">
        {/* Unmounted with the dialog, which is what discards the key from
            memory when it closes. */}
        {open ? (
          <CreateIngestKeyForm
            applicationId={applicationId}
            applicationName={applicationName}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateIngestKeyForm({
  applicationId,
  applicationName,
  onDone,
}: {
  applicationId: string;
  applicationName: string;
  onDone: () => void;
}) {
  const [result, formAction, isPending] = useActionState(
    createIngestKeyAction,
    INITIAL_RESULT,
  );
  const [type, setType] = useState<IngestKeyType>("PUBLIC");

  if (result.status === "created") {
    return <CreatedKey result={result} onDone={onDone} />;
  }

  const fieldErrors =
    result.status === "error" ? (result.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Create an ingest key</DialogTitle>
        <DialogDescription>
          A new credential for {applicationName}. The key is shown once, when it
          is created.
        </DialogDescription>
      </DialogHeader>

      <input type="hidden" name="applicationId" value={applicationId} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="key-name" className="text-sm leading-none font-medium">
          Name
        </label>
        <Input
          id="key-name"
          name="name"
          required
          maxLength={64}
          placeholder="e.g. Checkout — production"
          aria-describedby={
            fieldErrors.name === undefined ? undefined : "key-name-error"
          }
        />
        <FieldError id="key-name-error" messages={fieldErrors.name} />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm leading-none font-medium">
          Key type
        </legend>
        <KeyTypeOption
          value="PUBLIC"
          checked={type === "PUBLIC"}
          onChange={setType}
          title="Browser key"
          description="Safe to ship in browser JavaScript. Only works from the origins you list below."
        />
        <KeyTypeOption
          value="SECRET"
          checked={type === "SECRET"}
          onChange={setType}
          title="Server key"
          description="For Node and other server runtimes. Must be kept secret — it is not restricted by origin."
        />
      </fieldset>

      {type === "PUBLIC" ? (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="key-origins"
            className="text-sm leading-none font-medium"
          >
            Allowed origins
          </label>
          <Textarea
            id="key-origins"
            name="allowedOrigins"
            rows={4}
            placeholder={
              "https://www.example.com\nhttps://checkout.example.com"
            }
            aria-describedby="key-origins-hint key-origins-error"
          />
          <p id="key-origins-hint" className="text-muted-foreground text-xs">
            One per line. Scheme, host and port only — no paths and no trailing
            slash. This list is the only thing protecting a browser key.
          </p>
          <FieldError
            id="key-origins-error"
            messages={fieldErrors.allowedOrigins}
          />
        </div>
      ) : null}

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
          {isPending ? "Creating…" : "Create key"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

function CreatedKey({
  result,
  onDone,
}: {
  result: Extract<IngestKeyActionResult, { status: "created" }>;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Key created</DialogTitle>
        <DialogDescription>{result.keyName} is ready to use.</DialogDescription>
      </DialogHeader>

      {result.keyType === "SECRET" ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 flex items-start gap-2 rounded-sm border p-3 text-sm"
        >
          <TriangleAlert
            className="text-destructive mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>
            Copy this key now. Only a hash of it is stored, so it cannot be
            shown again — if you lose it you will have to create another.
          </span>
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">Ingest key</span>
        <code className="bg-muted rounded-sm p-3 font-mono text-xs break-all">
          {result.plaintext}
        </code>
        <CopyButton value={result.plaintext} label="the ingest key" />
      </div>

      <DialogFooter>
        <Button type="button" size="sm" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}

function KeyTypeOption({
  value,
  checked,
  onChange,
  title,
  description,
}: {
  value: IngestKeyType;
  checked: boolean;
  onChange: (value: IngestKeyType) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="hover:bg-muted/50 has-checked:border-primary flex cursor-pointer gap-3 rounded-sm border p-3 transition-colors">
      <input
        type="radio"
        name="type"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="accent-primary mt-1 size-4 shrink-0"
      />
      <span className="flex flex-col gap-1">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-muted-foreground text-xs">{description}</span>
      </span>
    </label>
  );
}

function FieldError({
  id,
  messages,
}: {
  id: string;
  messages: string[] | undefined;
}) {
  if (messages === undefined || messages.length === 0) return null;

  return (
    <p id={id} role="alert" className="text-destructive text-xs">
      {messages.join(" ")}
    </p>
  );
}
