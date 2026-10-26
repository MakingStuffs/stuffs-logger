"use client";

import { useActionState, useEffect, useState } from "react";

import type {
  ApiTokenAction,
  ApiTokenActionResult,
} from "@/lib/tokens/action-result";

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

/** Props for {@link RevokeApiTokenDialog}. */
export interface RevokeApiTokenDialogProps {
  /** The Server Action that revokes the token, passed down from the server. */
  action: ApiTokenAction;
  tokenId: string;
  tokenName: string;
}

/**
 * Revokes an API token, behind a typed confirmation.
 *
 * Revoking the token the scheduler presents stops the retention job, so the
 * dialog asks for the token's name rather than a single click — an INTENT
 * check that only a person reading the row can satisfy.
 */
export function RevokeApiTokenDialog({
  action,
  tokenId,
  tokenName,
}: RevokeApiTokenDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Revoke ${tokenName}`}>
          Revoke
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <RevokeForm
            action={action}
            tokenId={tokenId}
            tokenName={tokenName}
            onDone={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RevokeForm({
  action,
  tokenId,
  tokenName,
  onDone,
}: RevokeApiTokenDialogProps & { onDone: () => void }) {
  const [result, formAction, isPending] = useActionState(
    action,
    INITIAL_RESULT,
  );

  // The page revalidates itself on success, so the dialog only has to close.
  useEffect(() => {
    if (result.status === "revoked") onDone();
  }, [result.status, onDone]);

  const confirmErrors =
    result.status === "error" ? result.fieldErrors?.confirmName : undefined;
  const inputId = `confirm-token-${tokenId}`;
  const hintId = `confirm-token-hint-${tokenId}`;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Revoke this token?</DialogTitle>
        <DialogDescription>
          Anything presenting {tokenName} is refused immediately. If it is the
          retention job&rsquo;s CRON_SECRET, the job starts answering 401 until
          CRON_SECRET is replaced with a new token. This cannot be undone.
        </DialogDescription>
      </DialogHeader>

      <input type="hidden" name="tokenId" value={tokenId} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm leading-none font-medium">
          Type the token&rsquo;s name to confirm
        </label>
        <Input
          id={inputId}
          name="confirmName"
          autoComplete="off"
          required
          aria-describedby={hintId}
        />
        <p id={hintId} className="text-muted-foreground text-xs">
          {tokenName}
        </p>
        <FieldError id={`${inputId}-error`} messages={confirmErrors} />
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
          {isPending ? "Revoking…" : "Revoke token"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
