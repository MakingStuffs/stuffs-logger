"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "./utils";

/**
 * A modal dialog.
 *
 * Built on Radix rather than hand-rolled, because the hard parts of a modal
 * are the invisible ones: focus is trapped while it is open and restored to
 * the trigger when it closes, the rest of the page is hidden from assistive
 * technology, Escape dismisses, and the title and description are wired to
 * `aria-labelledby`/`aria-describedby` automatically.
 *
 * Entrance and exit are opacity and transform only — no property that forces
 * layout — and both are gated behind `motion-safe`.
 */
export const Dialog = DialogPrimitive.Root;

/** The control that opens the dialog. Use `asChild` to keep it a real button. */
export const DialogTrigger = DialogPrimitive.Trigger;

/** Renders the dialog at the end of `<body>`, clear of any stacking context. */
export const DialogPortal = DialogPrimitive.Portal;

/** A control that closes the dialog. */
export const DialogClose = DialogPrimitive.Close;

/** The dimmed backdrop behind the dialog. */
export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/55",
        "motion-safe:data-[state=open]:animate-fade-in motion-safe:data-[state=closed]:animate-fade-out",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The dialog's panel.
 *
 * Renders its own close button so every dialog has a visible dismissal, not
 * only Escape and the backdrop.
 */
export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-card text-card-foreground fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg",
          "-translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-6",
          "motion-safe:data-[state=open]:animate-dialog-in motion-safe:data-[state=closed]:animate-dialog-out",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/40 absolute top-3 right-3 inline-flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none motion-reduce:transition-none">
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/** The title block at the top of a dialog. */
export function DialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-8 text-left", className)}
      {...props}
    />
  );
}

/** The action row at the bottom of a dialog. */
export function DialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

/** The dialog's accessible name. Every dialog must have one. */
export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base leading-none font-semibold", className)}
      {...props}
    />
  );
}

/** The dialog's accessible description. */
export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}
