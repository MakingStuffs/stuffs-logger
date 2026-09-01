import { LoaderCircle } from "lucide-react";

import { Button } from "./button";
import type { ButtonProps } from "./button";

/** Props for {@link SubmitButton}. */
export interface SubmitButtonProps extends ButtonProps {
  /** Whether the form this button submits is currently in flight. */
  isPending: boolean;
}

/**
 * A form's submit control, with its pending state built in.
 *
 * Composes {@link Button} rather than restyling one, so a submit button is
 * indistinguishable from any other button of the same variant. While the
 * action is in flight the control disables itself — which is what stops a
 * double submission — and shows a spinner so the wait is visibly the app's
 * doing rather than a dead click.
 *
 * The spinner is hidden from assistive technology: the pending state is
 * already announced by the label the caller swaps in ("Creating…"), and a
 * second announcement of a decorative icon is noise.
 *
 * @example
 * <SubmitButton type="submit" size="sm" isPending={isPending}>
 *   {isPending ? "Creating…" : "Create key"}
 * </SubmitButton>
 */
export function SubmitButton({
  isPending,
  disabled,
  children,
  ...props
}: SubmitButtonProps) {
  return (
    <Button {...props} disabled={disabled === true || isPending}>
      {isPending ? (
        <LoaderCircle
          aria-hidden="true"
          className="size-4 motion-safe:animate-spin"
        />
      ) : null}
      {children}
    </Button>
  );
}
