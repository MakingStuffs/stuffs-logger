"use client";

import { KeyRound, TriangleAlert } from "lucide-react";
import { useActionState, useState } from "react";

import type {
  ApiTokenAction,
  ApiTokenActionResult,
} from "@/lib/tokens/action-result";
import { MAX_API_TOKEN_NAME_LENGTH } from "@/lib/tokens/constants";

import { CopyButton } from "../apps/copy-button";
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

const INITIAL_RESULT: ApiTokenActionResult = { status: "idle" };

/** Props for {@link CreateApiTokenDialog}. */
export interface CreateApiTokenDialogProps {
  /** The Server Action that mints the token, passed down from the server. */
  action: ApiTokenAction;
}

/**
 * Mints an API token, and shows it once.
 *
 * A client component because the raw token exists only in the action's
 * response — only its digest is stored — so it can live nowhere but this
 * component's state, and it is discarded when the dialog closes.
 */
export function CreateApiTokenDialog({ action }: CreateApiTokenDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound className="size-4" aria-hidden="true" />
          Create token
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-svh overflow-y-auto sm:max-w-lg">
        {/* Unmounted with the dialog, which is what drops the raw token from
            memory when it closes. */}
        {open ? (
          <CreateApiTokenForm action={action} onDone={() => setOpen(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateApiTokenForm({
  action,
  onDone,
}: CreateApiTokenDialogProps & { onDone: () => void }) {
  const [result, formAction, isPending] = useActionState(
    action,
    INITIAL_RESULT,
  );

  if (result.status === "created") {
    return <CreatedToken result={result} onDone={onDone} />;
  }

  const fieldErrors =
    result.status === "error" ? (result.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Create an API token</DialogTitle>
        <DialogDescription>
          A credential for a machine caller such as the retention job. The token
          is shown once, when it is created.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="api-token-name"
          className="text-sm leading-none font-medium"
        >
          Name
        </label>
        <Input
          id="api-token-name"
          name="name"
          required
          maxLength={MAX_API_TOKEN_NAME_LENGTH}
          placeholder="e.g. Retention cron — production"
          aria-describedby={
            fieldErrors.name === undefined ? undefined : "api-token-name-error"
          }
        />
        <FieldError id="api-token-name-error" messages={fieldErrors.name} />
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
          {isPending ? "Creating…" : "Create token"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

function CreatedToken({
  result,
  onDone,
}: {
  result: Extract<ApiTokenActionResult, { status: "created" }>;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Token created</DialogTitle>
        <DialogDescription>
          {result.tokenName} is ready to use.
        </DialogDescription>
      </DialogHeader>

      <p
        role="alert"
        className="border-destructive/40 bg-destructive/5 flex items-start gap-2 rounded-sm border p-3 text-sm"
      >
        <TriangleAlert
          className="text-destructive mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <span>
          Set this as CRON_SECRET for the retention job. It cannot be shown
          again.
        </span>
      </p>

      <div className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">API token</span>
        <code className="bg-muted rounded-sm p-3 font-mono text-xs break-all">
          {result.token}
        </code>
        <CopyButton value={result.token} label="the API token" />
      </div>

      <DialogFooter>
        <Button type="button" size="sm" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}
