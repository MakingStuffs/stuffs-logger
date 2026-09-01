"use client";

import { useActionState, useEffect, useState } from "react";

import { revokeIngestKeyAction } from "@/lib/apps/actions";
import type { IngestKeyActionResult } from "@/lib/apps/actions";

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

const INITIAL_RESULT: IngestKeyActionResult = { status: "idle" };

/**
 * Revokes an ingest key, behind a typed confirmation.
 *
 * Revoking a live key stops an application logging, so the dialog asks for the
 * key's name rather than a single click. That is an INTENT check, not an
 * identity one: a valid session — or a script running on this origin under one
 * — already satisfies every framework-level protection, and only a person
 * reading the row can retype what is in it.
 */
export function RevokeIngestKeyDialog({
  keyId,
  keyName,
}: {
  keyId: string;
  keyName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Revoke ${keyName}`}>
          Revoke
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <RevokeForm
            keyId={keyId}
            keyName={keyName}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RevokeForm({
  keyId,
  keyName,
  onDone,
}: {
  keyId: string;
  keyName: string;
  onDone: () => void;
}) {
  const [result, formAction, isPending] = useActionState(
    revokeIngestKeyAction,
    INITIAL_RESULT,
  );

  // The page revalidates itself on success, so the dialog's only remaining job
  // is to get out of the way.
  useEffect(() => {
    if (result.status === "revoked") onDone();
  }, [result.status, onDone]);

  const confirmErrors =
    result.status === "error" ? result.fieldErrors?.confirmName : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Revoke this key?</DialogTitle>
        <DialogDescription>
          Anything still using {keyName} will stop being able to send logs
          immediately. This cannot be undone — you would need to create a new
          key and redeploy.
        </DialogDescription>
      </DialogHeader>

      <input type="hidden" name="keyId" value={keyId} />

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`confirm-${keyId}`}
          className="text-sm leading-none font-medium"
        >
          Type the key&rsquo;s name to confirm
        </label>
        <Input
          id={`confirm-${keyId}`}
          name="confirmName"
          autoComplete="off"
          required
          aria-describedby={`confirm-hint-${keyId}`}
        />
        <p
          id={`confirm-hint-${keyId}`}
          className="text-muted-foreground text-xs"
        >
          {keyName}
        </p>
        {confirmErrors === undefined ? null : (
          <p role="alert" className="text-destructive text-xs">
            {confirmErrors.join(" ")}
          </p>
        )}
      </div>

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
          variant="destructive"
          isPending={isPending}
        >
          {isPending ? "Revoking…" : "Revoke key"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
